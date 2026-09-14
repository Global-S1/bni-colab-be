import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TaskStatus, TaskPriority } from './task.entity';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async createTask(
    @Request() req,
    @Body()
    body: {
      projectId: string;
      title: string;
      description?: string;
      richContent?: any;
      priority?: TaskPriority;
      assigneeId?: string;
      dueDate?: string;
      tags?: string[];
      metadata?: any;
    },
  ) {
    return this.tasksService.createTask(req.user.userId, body);
  }

  @Get('project/:projectId')
  async getTasksForProject(
    @Request() req,
    @Param('projectId') projectId: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('search') search?: string,
  ) {
    return this.tasksService.getTasksForProject(projectId, req.user.userId, { assigneeId, status, priority, search });
  }

  @Get(':id')
  async getTaskById(@Request() req, @Param('id') id: string) {
    return this.tasksService.getTaskById(id, req.user.userId);
  }

  @Patch(':id')
  async updateTask(
    @Request() req,
    @Param('id') id: string,
    @Body()
    body: {
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
    return this.tasksService.updateTask(id, req.user.userId, body);
  }

  @Post(':id/comments')
  async addComment(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.tasksService.addComment(id, req.user.userId, body.content);
  }

  @Post(':id/attachments')
  async addAttachment(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { fileName: string; fileUrl: string; mimeType?: string; fileSize?: number; metadata?: any },
  ) {
    return this.tasksService.addAttachment(id, req.user.userId, body);
  }
}
