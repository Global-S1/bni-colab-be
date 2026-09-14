import { Controller, Post, Get, Patch, Param, Body, UseGuards, Request, Res } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectStatus } from './project.entity';
import { Response } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async createProject(
    @Request() req,
    @Body() body: { teamId: string; name: string; description?: string; richContent?: any; metadata?: any },
  ) {
    return this.projectsService.createProject(req.user.userId, body);
  }

  @Get()
  async getAllProjectsForUser(@Request() req) {
    return this.projectsService.findAllProjectsForUser(req.user.userId);
  }

  @Get('team/:teamId')
  async getProjectsForTeam(@Request() req, @Param('teamId') teamId: string) {
    return this.projectsService.getProjectsForTeam(teamId, req.user.userId);
  }

  @Get(':id')
  async getProjectById(@Request() req, @Param('id') id: string) {
    return this.projectsService.getProjectById(id, req.user.userId);
  }

  @Patch(':id')
  async updateProject(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; status?: ProjectStatus; richContent?: any; metadata?: any },
  ) {
    return this.projectsService.updateProject(id, req.user.userId, body);
  }

  @Get(':id/export-excel')
  async exportToExcel(@Request() req, @Param('id') id: string, @Res() res: Response) {
    return this.projectsService.exportToExcel(id, req.user.userId, res);
  }
}
