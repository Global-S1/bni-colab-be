import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task, TaskStatus, TaskPriority } from './task.entity';
import { TaskAttachment } from './task-attachment.entity';
import { TaskComment } from './task-comment.entity';
import { TaskHistory } from './task-history.entity';
import { ProjectsService } from '../projects/projects.service';
import { User } from '../users/user.entity';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class TasksService {
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(TaskAttachment)
    private readonly attachmentRepository: Repository<TaskAttachment>,
    @InjectRepository(TaskComment)
    private readonly commentRepository: Repository<TaskComment>,
    @InjectRepository(TaskHistory)
    private readonly historyRepository: Repository<TaskHistory>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST', 'mail.globals.one'),
      port: Number(this.configService.get<number>('SMTP_PORT', 587)),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER', 'bnitech@globals.one'),
        pass: this.configService.get<string>('SMTP_PASS', 'GzgBCHmksTD7ysF'),
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  private generateTaskCode(title: string, count: number): string {
    const words = title.trim().split(/\s+/).filter(Boolean);
    let prefix = words.length >= 2
      ? words.map((w) => w[0]).join('').substring(0, 4).toUpperCase()
      : (words[0] || 'TAR').substring(0, 3).toUpperCase();
    prefix = prefix.replace(/[^A-Z0-9]/g, '');
    if (prefix.length < 2) prefix = (prefix + 'TR').substring(0, 2);
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  async createTask(
    reporterId: string,
    dto: {
      projectId: string;
      title: string;
      description?: string;
      richContent?: any;
      priority?: TaskPriority;
      assigneeId?: string;
      dueDate?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    },
  ) {
    await this.projectsService.getProjectById(dto.projectId, reporterId);
    const totalTasks = await this.taskRepository.count();
    const code = this.generateTaskCode(dto.title, totalTasks);

    const task = this.taskRepository.create({
      projectId: dto.projectId,
      title: dto.title,
      code,
      description: dto.description,
      richContent: dto.richContent || { text: '', images: [], links: [] },
      priority: dto.priority || TaskPriority.MEDIUM,
      assigneeId: dto.assigneeId,
      reporterId,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      tags: dto.tags || [],
      metadata: dto.metadata || {},
    });

    const savedTask = await this.taskRepository.save(task);

    // Record creation history
    await this.historyRepository.save(
      this.historyRepository.create({
        taskId: savedTask.id,
        userId: reporterId,
        action: 'CREATED',
        changes: { task: { from: null, to: savedTask.title } },
      }),
    );

    // Send email notification to assignee
    if (dto.assigneeId) {
      this.notifyAssignee(savedTask, dto.assigneeId);
    }

    return savedTask;
  }

  async getTasksForProject(
    projectId: string,
    userId: string,
    filters?: { assigneeId?: string; status?: TaskStatus; priority?: TaskPriority; search?: string },
  ) {
    await this.projectsService.getProjectById(projectId, userId);

    const query = this.taskRepository.createQueryBuilder('task').where('task.projectId = :projectId', { projectId });

    if (filters?.assigneeId) {
      query.andWhere('task.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    }
    if (filters?.status) {
      query.andWhere('task.status = :status', { status: filters.status });
    }
    if (filters?.priority) {
      query.andWhere('task.priority = :priority', { priority: filters.priority });
    }
    if (filters?.search) {
      query.andWhere('(task.title ILIKE :search OR task.description ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    const tasks = await query.orderBy('task.createdAt', 'DESC').getMany();

    // Fallback code for legacy tasks
    for (let i = 0; i < tasks.length; i++) {
      if (!tasks[i].code) {
        tasks[i].code = this.generateTaskCode(tasks[i].title, i);
        await this.taskRepository.save(tasks[i]);
      }
    }

    // Attach reporter and assignee summary
    const userIds = Array.from(new Set(tasks.flatMap((t) => [t.reporterId, t.assigneeId].filter(Boolean) as string[])));
    const users = userIds.length > 0 ? await this.userRepository.find({ where: { id: In(userIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));

    return tasks.map((t) => ({
      ...t,
      reporter: t.reporterId ? userMap.get(t.reporterId) : null,
      assignee: t.assigneeId ? userMap.get(t.assigneeId) : null,
    }));
  }

  async getTaskById(taskId: string, userId: string) {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }
    await this.projectsService.getProjectById(task.projectId, userId);

    if (!task.code) {
      const total = await this.taskRepository.count();
      task.code = this.generateTaskCode(task.title, total);
      await this.taskRepository.save(task);
    }

    // Fetch reporter, assignee, comments, and history
    const userIds = Array.from(new Set([task.reporterId, task.assigneeId].filter(Boolean) as string[]));
    const [comments, history, attachments] = await Promise.all([
      this.commentRepository.find({ where: { taskId }, order: { createdAt: 'ASC' } }),
      this.historyRepository.find({ where: { taskId }, order: { createdAt: 'DESC' } }),
      this.attachmentRepository.find({ where: { taskId }, order: { uploadedAt: 'DESC' } }),
    ]);

    comments.forEach((c) => userIds.push(c.userId));
    history.forEach((h) => userIds.push(h.userId));

    const uniqueUserIds = Array.from(new Set(userIds));
    const users = uniqueUserIds.length > 0 ? await this.userRepository.find({ where: { id: In(uniqueUserIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));

    return {
      ...task,
      reporter: task.reporterId ? userMap.get(task.reporterId) : null,
      assignee: task.assigneeId ? userMap.get(task.assigneeId) : null,
      comments: comments.map((c) => ({
        ...c,
        user: userMap.get(c.userId) || { id: c.userId, name: 'Usuario', email: '' },
      })),
      history: history.map((h) => ({
        ...h,
        user: userMap.get(h.userId) || { id: h.userId, name: 'Usuario', email: '' },
      })),
      attachments,
    };
  }

  async updateTask(
    taskId: string,
    userId: string,
    dto: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string;
      dueDate?: string;
      tags?: string[];
      richContent?: any;
      metadata?: any;
    },
  ) {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }
    await this.projectsService.getProjectById(task.projectId, userId);

    const previousAssignee = task.assigneeId;
    const changes: Record<string, { from: any; to: any }> = {};

    if (dto.title !== undefined && dto.title !== task.title) {
      changes.title = { from: task.title, to: dto.title };
      task.title = dto.title;
    }
    if (dto.description !== undefined && dto.description !== task.description) {
      changes.description = { from: task.description, to: dto.description };
      task.description = dto.description;
    }
    if (dto.status !== undefined && dto.status !== task.status) {
      changes.status = { from: task.status, to: dto.status };
      task.status = dto.status;
    }
    if (dto.priority !== undefined && dto.priority !== task.priority) {
      changes.priority = { from: task.priority, to: dto.priority };
      task.priority = dto.priority;
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId) {
      changes.assigneeId = { from: task.assigneeId, to: dto.assigneeId };
      task.assigneeId = dto.assigneeId;
    }
    if (dto.dueDate !== undefined) {
      const newDue = dto.dueDate ? new Date(dto.dueDate) : null;
      changes.dueDate = { from: task.dueDate, to: newDue };
      task.dueDate = newDue;
    }
    if (dto.tags !== undefined) {
      changes.tags = { from: task.tags, to: dto.tags };
      task.tags = dto.tags;
    }
    if (dto.richContent !== undefined) {
      task.richContent = dto.richContent;
    }
    if (dto.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...dto.metadata };
    }

    const updatedTask = await this.taskRepository.save(task);

    // Save history entry if there are changes
    if (Object.keys(changes).length > 0) {
      await this.historyRepository.save(
        this.historyRepository.create({
          taskId,
          userId,
          action: changes.status ? 'STATUS_CHANGE' : 'UPDATED',
          changes,
        }),
      );
    }

    if (dto.assigneeId && dto.assigneeId !== previousAssignee) {
      this.notifyAssignee(updatedTask, dto.assigneeId);
    }

    return this.getTaskById(taskId, userId);
  }

  async addComment(taskId: string, userId: string, content: string) {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }
    await this.projectsService.getProjectById(task.projectId, userId);

    const comment = this.commentRepository.create({
      taskId,
      userId,
      content,
    });
    const savedComment = await this.commentRepository.save(comment);

    // Record history
    await this.historyRepository.save(
      this.historyRepository.create({
        taskId,
        userId,
        action: 'COMMENT_ADDED',
        changes: { comment: { from: null, to: content.substring(0, 50) + (content.length > 50 ? '...' : '') } },
      }),
    );

    const user = await this.userRepository.findOne({ where: { id: userId } });

    // Asynchronously notify users mentioned with @
    this.notifyMentionedUsers(user, task, content).catch((err) => {
      console.warn('Error notificando menciones por correo', err);
    });

    return {
      ...savedComment,
      user: user ? { id: user.id, name: user.name, email: user.email } : { id: userId, name: 'Usuario', email: '' },
    };
  }

  private async notifyMentionedUsers(commenter: User | null, task: Task, content: string) {
    const matches = content.match(/@[\w.-]+/g);
    if (!matches || matches.length === 0) return;

    const queryTerms = matches.map((m) => m.substring(1).toLowerCase());
    const allUsers = await this.userRepository.find();

    const mentionedUsers = allUsers.filter((u) => {
      const uEmail = u.email.toLowerCase();
      const uName = (u.name || '').toLowerCase();
      return queryTerms.some((term) => uEmail.includes(term) || (uName && uName.includes(term)));
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4322');

    for (const mentioned of mentionedUsers) {
      if (mentioned.id === commenter?.id || !mentioned.email) continue;
      try {
        await this.transporter.sendMail({
          from: this.configService.get<string>('SMTP_FROM', 'BNI Colab <bnitech@globals.one>'),
          to: mentioned.email,
          subject: `💬 Te han mencionado en la tarea: ${task.code || ''} ${task.title}`,
          html: `
            <div style="background-color: #0B132B; padding: 30px; font-family: sans-serif; color: #ffffff;">
              <div style="max-width: 550px; margin: 0 auto; background: #1C2541; padding: 25px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <h2 style="color: #D40000; margin-top: 0;">Mención en Tarea</h2>
                <p>Hola <strong>${mentioned.name || mentioned.email}</strong>,</p>
                <p><strong>${commenter?.name || commenter?.email || 'Un miembro'}</strong> te ha mencionado en un comentario de la tarea <strong>[${task.code || 'TAR'}] ${task.title}</strong>:</p>
                <blockquote style="background: rgba(255,255,255,0.05); border-left: 3px solid #D40000; padding: 12px; margin: 15px 0; color: #E0E1DD;">
                  "${content}"
                </blockquote>
                <div style="text-align: center; margin-top: 20px;">
                  <a href="${frontendUrl}/tasks/${task.id}" style="background-color: #D40000; color: #ffffff; padding: 10px 20px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">
                    Ver Tarea
                  </a>
                </div>
              </div>
            </div>
          `,
        });
      } catch (err) {
        console.warn('Error enviando correo de mención', err);
      }
    }
  }

  async addAttachment(taskId: string, userId: string, dto: { fileName: string; fileUrl: string; mimeType?: string; fileSize?: number; metadata?: any }) {
    await this.getTaskById(taskId, userId);
    const attachment = this.attachmentRepository.create({
      taskId,
      fileName: dto.fileName,
      fileUrl: dto.fileUrl,
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      metadata: dto.metadata || {},
    });
    return this.attachmentRepository.save(attachment);
  }

  private async notifyAssignee(task: Task, assigneeId: string) {
    try {
      const assignee = await this.userRepository.findOne({ where: { id: assigneeId } });
      if (!assignee || !assignee.email) return;

      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM', 'BNITECH Colab <bnitech@globals.one>'),
        to: assignee.email,
        subject: `📋 Te han asignado una tarea en BNITECH Colab: ${task.title}`,
        html: `
          <div style="background-color: #0B132B; padding: 40px 20px; font-family: sans-serif; color: #ffffff;">
            <div style="max-width: 550px; margin: 0 auto; background: #1C2541; border-radius: 16px; padding: 32px; border: 1px solid rgba(255,255,255,0.1);">
              <h2 style="color: #FFD166; margin-top: 0;">Nueva Tarea Asignada</h2>
              <p>Hola <strong>${assignee.name || assignee.email}</strong>,</p>
              <p>Se te ha asignado la siguiente tarea:</p>
              <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; margin: 15px 0;">
                <h3 style="color: #CF142B; margin: 0 0 8px 0;">${task.title}</h3>
                <p style="margin: 0; color: #E0E1DD; font-size: 14px;">${task.description || 'Sin descripción'}</p>
                <p style="margin-top: 8px; font-size: 12px; color: #8D99AE;">Prioridad: <strong>${task.priority}</strong></p>
              </div>
            </div>
          </div>
        `,
      });
    } catch (err) {
      console.warn('[TasksService] Could not send email notification to assignee', err);
    }
  }
}
