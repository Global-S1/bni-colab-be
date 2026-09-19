import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Document } from './document.entity';
import { ProjectsService } from '../projects/projects.service';
import { User } from '../users/user.entity';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private s3Client: S3Client;

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async generateUploadPresignedUrl(fileName: string, mimeType: string) {
    const bucket = this.configService.get<string>('AWS_S3_BUCKET', 'guest-files.bnitech.online');
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `projects/documents/${Date.now()}_${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });
    const publicUrl = bucket.includes(".") ? `https://s3.amazonaws.com/${bucket}/${key}` : `https://${bucket}.s3.amazonaws.com/${key}`;

    return { uploadUrl, publicUrl, key };
  }

  async uploadDirectBuffer(
    uploadedBy: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    dto: { projectId: string; description?: string; name?: string },
  ) {
    await this.projectsService.getProjectById(dto.projectId, uploadedBy);

    const bucket = this.configService.get<string>('AWS_S3_BUCKET', 'guest-files.bnitech.online');
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${Date.now()}_${sanitizedName}`;

    // Always write file buffer to local disk as guaranteed backup/local storage
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const localFilePath = path.join(uploadsDir, filename);
    fs.writeFileSync(localFilePath, file.buffer);

    const backendUrl = this.configService.get<string>('PUBLIC_BACKEND_URL', 'http://localhost:3002');
    let publicUrl = `${backendUrl}/api/v1/documents/files/${filename}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: `projects/documents/${filename}`,
        Body: file.buffer,
        ContentType: file.mimetype,
      });
      await this.s3Client.send(command);
      publicUrl = bucket.includes(".") ? `https://s3.amazonaws.com/${bucket}/projects/documents/${filename}` : `https://${bucket}.s3.amazonaws.com/projects/documents/${filename}`;
    } catch (err) {
      this.logger.warn('S3 upload fallback: usando almacenamiento local servido en NestJS backend', err);
    }

    const doc = this.documentRepository.create({
      projectId: dto.projectId,
      name: dto.name || file.originalname,
      description: dto.description,
      fileUrl: publicUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      richContent: { notes: '', links: [] },
      uploadedBy,
      metadata: { key: filename, originalName: file.originalname },
    });

    const saved = await this.documentRepository.save(doc);
    const uploader = await this.userRepository.findOne({ where: { id: uploadedBy } });
    return {
      ...saved,
      uploader: uploader ? { id: uploader.id, name: uploader.name, email: uploader.email } : null,
    };
  }

  async createDocument(
    uploadedBy: string,
    dto: {
      projectId: string;
      name: string;
      description?: string;
      fileUrl: string;
      fileSize?: number;
      mimeType?: string;
      richContent?: any;
      metadata?: any;
    },
  ) {
    await this.projectsService.getProjectById(dto.projectId, uploadedBy);

    const doc = this.documentRepository.create({
      projectId: dto.projectId,
      name: dto.name,
      description: dto.description,
      fileUrl: dto.fileUrl,
      fileSize: dto.fileSize,
      mimeType: dto.mimeType,
      richContent: dto.richContent || { notes: '', links: [] },
      uploadedBy,
      metadata: dto.metadata || {},
    });
    const saved = await this.documentRepository.save(doc);
    const uploader = await this.userRepository.findOne({ where: { id: uploadedBy } });
    return {
      ...saved,
      uploader: uploader ? { id: uploader.id, name: uploader.name, email: uploader.email } : null,
    };
  }

  async getDocumentsForProject(projectId: string, userId: string) {
    await this.projectsService.getProjectById(projectId, userId);
    const docs = await this.documentRepository.find({
      where: { projectId },
      order: { uploadedAt: 'DESC' },
    });

    const uploaderIds = Array.from(new Set(docs.map((d) => d.uploadedBy).filter(Boolean)));
    const users = uploaderIds.length > 0 ? await this.userRepository.find({ where: { id: In(uploaderIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));

    return docs.map((d) => ({
      ...d,
      uploader: d.uploadedBy ? userMap.get(d.uploadedBy) || { id: d.uploadedBy, name: 'Usuario', email: '' } : null,
    }));
  }

  async deleteDocument(documentId: string, userId: string) {
    const doc = await this.documentRepository.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException('Documento no encontrado');
    }
    await this.projectsService.getProjectById(doc.projectId, userId);
    await this.documentRepository.remove(doc);
    return { message: 'Documento eliminado correctamente' };
  }
}
