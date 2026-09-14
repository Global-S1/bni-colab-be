import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, Not, In } from 'typeorm';
import { Task, TaskStatus } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

  // Recordatorios automáticos diarios a las 8:00 AM
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyTaskReminders() {
    this.logger.log('Ejecutando Cron Job: Recordatorios diarios de tareas pendientes...');

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const pendingTasks = await this.taskRepository.find({
      where: {
        status: Not(TaskStatus.DONE),
        dueDate: LessThanOrEqual(endOfToday),
      },
    });

    if (pendingTasks.length === 0) {
      this.logger.log('No hay tareas pendientes ni por vencer para el día de hoy.');
      return;
    }

    // Group tasks by assignee
    const tasksByAssignee = new Map<string, Task[]>();
    pendingTasks.forEach((task) => {
      if (task.assigneeId) {
        const list = tasksByAssignee.get(task.assigneeId) || [];
        list.push(task);
        tasksByAssignee.set(task.assigneeId, list);
      }
    });

    const assigneeIds = Array.from(tasksByAssignee.keys());
    if (assigneeIds.length === 0) return;

    const assignees = await this.userRepository.find({ where: { id: In(assigneeIds) } });

    for (const assignee of assignees) {
      const userTasks = tasksByAssignee.get(assignee.id) || [];
      if (userTasks.length === 0) continue;

      const tasksHtml = userTasks
        .map(
          (t) => `
          <li style="margin-bottom: 8px;">
            <strong>${t.title}</strong> — Prioridad: <span style="color: #FFD166;">${t.priority}</span>
            <br><small style="color: #8D99AE;">Vence: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Hoy'}</small>
          </li>
        `,
        )
        .join('');

      try {
        await this.transporter.sendMail({
          from: this.configService.get<string>('SMTP_FROM', 'BNI Colab <noreply@globals1.com>'),
          to: assignee.email,
          subject: `⏰ BNI Colab: Tienes ${userTasks.length} tarea(s) por vencer hoy`,
          html: `
            <div style="background-color: #0B132B; padding: 30px; font-family: sans-serif; color: #ffffff;">
              <div style="max-width: 500px; margin: 0 auto; background: #1C2541; padding: 25px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <h2 style="color: #CF142B; margin-top: 0;">Recordatorio Diario de Tareas</h2>
                <p>Hola <strong>${assignee.name || assignee.email}</strong>,</p>
                <p>Tienes las siguientes tareas pendientes o por vencer:</p>
                <ul style="color: #E0E1DD;">${tasksHtml}</ul>
                <p style="font-size: 12px; color: #8D99AE; text-align: center; margin-top: 20px;">BNI Colab — Plataforma de Colaboración de Equipos</p>
              </div>
            </div>
          `,
        });
        this.logger.log(`Recordatorio enviado exitosamente a ${assignee.email}`);
      } catch (err) {
        this.logger.error(`Error enviando correo de recordatorio a ${assignee.email}`, err);
      }
    }
  }
}
