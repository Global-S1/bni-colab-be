import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MeetingsService, CreateMeetingDto } from './meetings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/v1/meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  async create(@Request() req, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.create(req.user.userId, dto);
  }

  @Put(':id')
  async update(@Request() req, @Param('id') id: string, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.update(id, req.user.userId, dto);
  }

  @Get()
  async findAll(@Request() req, @Query('teamId') teamId?: string, @Query('projectId') projectId?: string) {
    if (projectId) {
      return this.meetingsService.findByProject(projectId);
    }
    if (teamId) {
      return this.meetingsService.findByTeam(teamId);
    }
    return this.meetingsService.findAllForUser(req.user.userId);
  }

  @Delete(':id')
  async delete(@Request() req, @Param('id') id: string) {
    return this.meetingsService.delete(id, req.user.userId);
  }
}
