import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api/v1/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('files/:filename(*)')
  async serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Archivo no encontrado');
    }
    return res.sendFile(filePath);
  }

  @UseGuards(JwtAuthGuard)
  @Post('presigned-url')
  async generatePresignedUrl(@Body() body: { fileName: string; mimeType: string }) {
    if (!body.fileName) {
      throw new BadRequestException('fileName es requerido');
    }
    return this.documentsService.generateUploadPresignedUrl(body.fileName, body.mimeType);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  }))
  async uploadFile(
    @Request() req,
    @UploadedFile() file: any,
    @Body() body: { projectId: string; name?: string; description?: string },
  ) {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId es requerido');
    }
    return this.documentsService.uploadDirectBuffer(req.user.userId, file, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createDocument(
    @Request() req,
    @Body()
    body: {
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
    return this.documentsService.createDocument(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('project/:projectId')
  async getDocumentsForProject(@Request() req, @Param('projectId') projectId: string) {
    return this.documentsService.getDocumentsForProject(projectId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteDocument(@Request() req, @Param('id') id: string) {
    return this.documentsService.deleteDocument(id, req.user.userId);
  }
}
