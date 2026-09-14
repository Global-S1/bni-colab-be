import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Meeting } from './meeting.entity';
import { TeamMember } from '../teams/team-member.entity';
import { Team } from '../teams/team.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

export interface CreateMeetingDto {
  title: string;
  description?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  meetingUrl?: string;
  location?: string;
  teamId: string;
  projectId?: string;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(Meeting)
    private readonly meetingRepository: Repository<Meeting>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
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

  async create(userId: string, dto: CreateMeetingDto) {
    const team = await this.teamRepository.findOne({ where: { id: dto.teamId } });
    if (!team) {
      throw new NotFoundException('Equipo no encontrado');
    }

    let project: Project | null = null;
    if (dto.projectId) {
      project = await this.projectRepository.findOne({ where: { id: dto.projectId } });
    }

    const creator = await this.userRepository.findOne({ where: { id: userId } });

    const meeting = this.meetingRepository.create({
      title: dto.title,
      description: dto.description,
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      meetingUrl: dto.meetingUrl,
      location: dto.location,
      teamId: dto.teamId,
      projectId: dto.projectId || undefined,
      createdById: userId,
    });

    const saved = await this.meetingRepository.save(meeting);

    // Asynchronously send notification emails with .ics and calendar links to all team members
    this.notifyMembers(saved, team, project, creator).catch((err) => {
      this.logger.error('Error enviando invitaciones de reunión por correo', err);
    });

    return saved;
  }

  async findAllForUser(userId: string) {
    // Find all teams user belongs to
    const memberships = await this.teamMemberRepository.find({ where: { userId } });
    const teamIds = memberships.map((m) => m.teamId);

    if (teamIds.length === 0) {
      return [];
    }

    return this.meetingRepository.find({
      where: { teamId: In(teamIds) },
      order: { startTime: 'ASC' },
    });
  }

  async findByTeam(teamId: string) {
    return this.meetingRepository.find({
      where: { teamId },
      order: { startTime: 'ASC' },
    });
  }

  async findByProject(projectId: string) {
    return this.meetingRepository.find({
      where: { projectId },
      order: { startTime: 'ASC' },
    });
  }

  async delete(meetingId: string, userId: string) {
    const meeting = await this.meetingRepository.findOne({ where: { id: meetingId } });
    if (!meeting) {
      throw new NotFoundException('Reunión no encontrada');
    }
    return this.meetingRepository.remove(meeting);
  }

  private async notifyMembers(meeting: Meeting, team: Team, project: Project | null, creator: User | null) {
    const memberships = await this.teamMemberRepository.find({ where: { teamId: team.id } });
    const memberIds = memberships.map((m) => m.userId);
    if (memberIds.length === 0) return;

    const users = await this.userRepository.find({ where: { id: In(memberIds) } });

    const startDate = new Date(meeting.startTime);
    const endDate = new Date(meeting.endTime);

    const formatICSDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const startICS = formatICSDate(startDate);
    const endICS = formatICSDate(endDate);
    const nowICS = formatICSDate(new Date());

    const titleEscaped = meeting.title.replace(/,/g, '\\,').replace(/;/g, '\\;');
    const descEscaped = (meeting.description || `Reunión de equipo: ${team.name}`).replace(/\n/g, '\\n').replace(/,/g, '\\,');
    const locationEscaped = (meeting.meetingUrl || meeting.location || 'Enlace en plataforma BNI Colab').replace(/,/g, '\\,');

    // Generate standard RFC 5545 iCalendar content
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BNI Colab//Calendario de Equipos//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:meeting-${meeting.id}@globals1.com`,
      `DTSTAMP:${nowICS}`,
      `DTSTART:${startICS}`,
      `DTEND:${endICS}`,
      `SUMMARY:${titleEscaped}`,
      `DESCRIPTION:${descEscaped}`,
      `LOCATION:${locationEscaped}`,
      `ORGANIZER;CN=${creator?.name || 'BNI Colab'}:mailto:${creator?.email || 'noreply@globals1.com'}`,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    // Build Google Calendar Web Link
    const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      meeting.title,
    )}&dates=${startICS}/${endICS}&details=${encodeURIComponent(
      (meeting.description || '') + (meeting.meetingUrl ? `\n\nLink: ${meeting.meetingUrl}` : ''),
    )}&location=${encodeURIComponent(meeting.meetingUrl || meeting.location || '')}`;

    // Build Outlook Live Link
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(
      meeting.title,
    )}&startdt=${encodeURIComponent(startDate.toISOString())}&enddt=${encodeURIComponent(
      endDate.toISOString(),
    )}&body=${encodeURIComponent(
      (meeting.description || '') + (meeting.meetingUrl ? `\n\nLink: ${meeting.meetingUrl}` : ''),
    )}&location=${encodeURIComponent(meeting.meetingUrl || meeting.location || '')}`;

    const prettyDate = startDate.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const prettyStartTime = startDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const prettyEndTime = endDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    for (const user of users) {
      if (!user.email) continue;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8F9FA; margin: 0; padding: 20px; color: #1f2937; }
            .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .header { background: #121117; padding: 24px; text-align: center; border-bottom: 3px solid #D40000; }
            .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px; }
            .header p { color: #9ca3af; margin: 4px 0 0 0; font-size: 13px; }
            .content { padding: 32px 28px; }
            .badge { display: inline-block; background: #fee2e2; color: #D40000; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
            .title { font-size: 22px; font-weight: 800; color: #111827; margin: 0 0 16px 0; }
            .detail-box { background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 18px; margin-bottom: 24px; }
            .detail-row { display: flex; margin-bottom: 10px; font-size: 14px; }
            .detail-label { font-weight: 600; color: #4b5563; width: 90px; flex-shrink: 0; }
            .detail-value { color: #111827; font-weight: 500; }
            .btn-group { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0; }
            .btn { display: inline-block; padding: 12px 20px; border-radius: 10px; font-size: 13px; font-weight: 700; text-decoration: none; text-align: center; }
            .btn-primary { background: #D40000; color: #ffffff !important; }
            .btn-secondary { background: #ffffff; color: #374151 !important; border: 1px solid #d1d5db; }
            .footer { background: #fafafa; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #f3f4f6; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>BNI TECH COLAB</h1>
              <p>Convocatoria de Reunión de Equipo</p>
            </div>
            <div class="content">
              <span class="badge">${team.name} ${project ? `&bull; ${project.name}` : ''}</span>
              <h2 class="title">${meeting.title}</h2>

              <div class="detail-box">
                <div class="detail-row">
                  <span class="detail-label">📅 Fecha:</span>
                  <span class="detail-value" style="text-transform: capitalize;">${prettyDate}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">⏰ Horario:</span>
                  <span class="detail-value">${prettyStartTime} - ${prettyEndTime}</span>
                </div>
                ${
                  meeting.meetingUrl
                    ? `<div class="detail-row">
                        <span class="detail-label">🔗 Enlace:</span>
                        <span class="detail-value"><a href="${meeting.meetingUrl}" style="color: #D40000; text-decoration: underline;" target="_blank">${meeting.meetingUrl}</a></span>
                      </div>`
                    : ''
                }
                ${
                  meeting.location
                    ? `<div class="detail-row">
                        <span class="detail-label">📍 Lugar:</span>
                        <span class="detail-value">${meeting.location}</span>
                      </div>`
                    : ''
                }
                ${
                  meeting.description
                    ? `<div class="detail-row" style="margin-bottom: 0;">
                        <span class="detail-label">📝 Detalle:</span>
                        <span class="detail-value">${meeting.description}</span>
                      </div>`
                    : ''
                }
              </div>

              <p style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #374151;">Agrega esta reunión a tu calendario con 1 clic:</p>
              
              <div class="btn-group">
                <a href="${gCalUrl}" target="_blank" class="btn btn-primary">➕ Google Calendar</a>
                <a href="${outlookUrl}" target="_blank" class="btn btn-secondary">➕ Outlook / 365</a>
              </div>

              <p style="font-size: 12px; color: #6b7280; line-height: 1.5; margin-top: 18px;">
                Tambi&eacute;n hemos adjuntado el archivo <strong>invitacion.ics</strong> compatible con Apple Calendar, Thunderbird y clientes de correo de escritorio.
              </p>
            </div>
            <div class="footer">
              Enviado autom&aacute;ticamente por BNI Colab &bull; Global S1<br>
              Organizador: ${creator?.name || 'Administrador del Equipo'}
            </div>
          </div>
        </body>
        </html>
      `;

      try {
        await this.transporter.sendMail({
          from: this.configService.get<string>('SMTP_FROM', 'BNI Colab <bnitech@globals.one>'),
          to: user.email,
          subject: `📅 Invitación: ${meeting.title} - ${team.name}`,
          html,
          icalEvent: {
            filename: 'invitacion.ics',
            method: 'REQUEST',
            content: icsContent,
          },
        });
        this.logger.log(`Invitación de reunión enviada a ${user.email}`);
      } catch (err) {
        this.logger.error(`Error enviando correo de reunión a ${user.email}`, err);
      }
    }
  }
}
