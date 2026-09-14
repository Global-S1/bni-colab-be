import { Controller, Post, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TeamType } from './team.entity';
import { TeamMemberRole } from './team-member.entity';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  async createTeam(
    @Request() req,
    @Body() body: { name: string; description?: string; type?: TeamType; metadata?: any },
  ) {
    return this.teamsService.createTeam(req.user.userId, body);
  }

  @Get()
  async findAllTeams(@Request() req) {
    return this.teamsService.findAllTeamsForUser(req.user.userId);
  }

  @Get(':id')
  async getTeamById(@Request() req, @Param('id') id: string) {
    return this.teamsService.getTeamById(id, req.user.userId);
  }

  @Post(':id/join')
  async joinPublicTeam(@Request() req, @Param('id') id: string) {
    return this.teamsService.joinPublicTeam(id, req.user.userId);
  }

  @Post(':id/invite')
  async inviteMember(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { email: string; role?: TeamMemberRole },
  ) {
    return this.teamsService.inviteMember(id, req.user.userId, body.email, body.role);
  }

  @Get(':id/members')
  async getMembers(@Request() req, @Param('id') id: string) {
    return this.teamsService.getMembers(id, req.user.userId);
  }
}
