import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Project, ProjectStatus } from './project.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { TeamsService } from '../teams/teams.service';
import { User } from '../users/user.entity';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly teamsService: TeamsService,
  ) {}

  private generateProjectCode(name: string, count: number): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    let prefix = words.length >= 2
      ? words.map((w) => w[0]).join('').substring(0, 4).toUpperCase()
      : (words[0] || 'PRJ').substring(0, 3).toUpperCase();
    prefix = prefix.replace(/[^A-Z0-9]/g, '');
    if (prefix.length < 2) prefix = (prefix + 'PR').substring(0, 2);
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  async createProject(
    userId: string,
    dto: { teamId: string; name: string; description?: string; richContent?: any; metadata?: Record<string, any> },
  ) {
    await this.teamsService.getTeamById(dto.teamId, userId);
    const totalProjects = await this.projectRepository.count();
    const code = this.generateProjectCode(dto.name, totalProjects);

    const project = this.projectRepository.create({
      teamId: dto.teamId,
      name: dto.name,
      code,
      description: dto.description,
      richContent: dto.richContent || { text: '', images: [], links: [] },
      createdBy: userId,
      metadata: dto.metadata || {},
    });
    return this.projectRepository.save(project);
  }

  async findAllProjectsForUser(userId: string) {
    const teams = await this.teamsService.findAllTeamsForUser(userId);
    if (!teams.length) return [];
    const teamIds = teams.map((t) => t.id);
    const teamMap = new Map(teams.map((t) => [t.id, t]));

    const projects = await this.projectRepository.find({
      where: { teamId: In(teamIds) },
      order: { createdAt: 'DESC' },
    });

    for (let i = 0; i < projects.length; i++) {
      if (!projects[i].code) {
        projects[i].code = this.generateProjectCode(projects[i].name, i);
        await this.projectRepository.save(projects[i]);
      }
    }

    const enrichedProjects = await Promise.all(
      projects.map(async (project) => {
        const totalTasks = await this.taskRepository.count({ where: { projectId: project.id } });
        const completedTasks = await this.taskRepository.count({
          where: { projectId: project.id, status: TaskStatus.DONE },
        });
        const team = teamMap.get(project.teamId);
        return {
          ...project,
          teamName: team?.name || 'Equipo',
          teamCode: team?.code || 'EQ',
          taskCount: totalTasks,
          completedTaskCount: completedTasks,
        };
      }),
    );

    return enrichedProjects;
  }

  async getProjectsForTeam(teamId: string, userId: string) {
    await this.teamsService.getTeamById(teamId, userId);
    const projects = await this.projectRepository.find({
      where: { teamId },
      order: { createdAt: 'DESC' },
    });

    for (let i = 0; i < projects.length; i++) {
      if (!projects[i].code) {
        projects[i].code = this.generateProjectCode(projects[i].name, i);
        await this.projectRepository.save(projects[i]);
      }
    }
    return projects;
  }

  async getProjectById(projectId: string, userId: string) {
    const project = await this.projectRepository.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }
    await this.teamsService.getTeamById(project.teamId, userId);
    if (!project.code) {
      const total = await this.projectRepository.count();
      project.code = this.generateProjectCode(project.name, total);
      await this.projectRepository.save(project);
    }
    return project;
  }

  async updateProject(
    projectId: string,
    userId: string,
    dto: { name?: string; description?: string; status?: ProjectStatus; richContent?: any; metadata?: any },
  ) {
    const project = await this.getProjectById(projectId, userId);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.status !== undefined) project.status = dto.status;
    if (dto.richContent !== undefined) project.richContent = dto.richContent;
    if (dto.metadata !== undefined) project.metadata = { ...project.metadata, ...dto.metadata };

    return this.projectRepository.save(project);
  }

  async exportToExcel(projectId: string, userId: string, res: Response) {
    const project = await this.getProjectById(projectId, userId);
    const tasks = await this.taskRepository.find({ where: { projectId }, order: { createdAt: 'ASC' } });
    const users = await this.userRepository.find();
    const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Proyecto - ${project.name}`);

    // Header styling
    worksheet.columns = [
      { header: 'Título de Tarea', key: 'title', width: 30 },
      { header: 'Estado', key: 'status', width: 15 },
      { header: 'Prioridad', key: 'priority', width: 15 },
      { header: 'Asignado a', key: 'assignee', width: 25 },
      { header: 'Fecha Vencimiento', key: 'dueDate', width: 20 },
      { header: 'Etiquetas', key: 'tags', width: 20 },
      { header: 'Descripción', key: 'description', width: 40 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'CF142B' }, // BNI Red
    };

    tasks.forEach((t) => {
      worksheet.addRow({
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assigneeId ? userMap.get(t.assigneeId) || 'Desconocido' : 'Sin asignar',
        dueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Sin fecha',
        tags: Array.isArray(t.tags) ? t.tags.join(', ') : '',
        description: t.description || '',
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Proyecto_${project.name.replace(/\s+/g, '_')}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  }
}
