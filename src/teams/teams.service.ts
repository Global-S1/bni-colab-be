import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Team, TeamType } from './team.entity';
import { TeamMember, TeamMemberRole } from './team-member.entity';
import { User } from '../users/user.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private generateTeamCode(name: string, count: number): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    let prefix = words.length >= 2
      ? words.map((w) => w[0]).join('').substring(0, 4).toUpperCase()
      : (words[0] || 'EQ').substring(0, 3).toUpperCase();
    prefix = prefix.replace(/[^A-Z0-9]/g, '');
    if (prefix.length < 2) prefix = (prefix + 'EQ').substring(0, 2);
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  async createTeam(
    userId: string,
    dto: { name: string; description?: string; type?: TeamType; metadata?: Record<string, any> },
  ) {
    const totalTeams = await this.teamRepository.count();
    const code = this.generateTeamCode(dto.name, totalTeams);

    const team = this.teamRepository.create({
      name: dto.name,
      code,
      description: dto.description,
      type: dto.type || TeamType.PUBLIC,
      createdBy: userId,
      metadata: dto.metadata || {},
    });
    const savedTeam = await this.teamRepository.save(team);

    // Create OWNER membership
    const ownerMember = this.memberRepository.create({
      teamId: savedTeam.id,
      userId: userId,
      role: TeamMemberRole.OWNER,
    });
    await this.memberRepository.save(ownerMember);

    return savedTeam;
  }

  async findAllTeamsForUser(userId: string) {
    const userMemberships = await this.memberRepository.find({ where: { userId } });
    const joinedTeamIds = userMemberships.map((m) => m.teamId);

    // Public teams OR teams user is a member of
    const teams = await this.teamRepository.find({
      order: { createdAt: 'DESC' },
    });

    // Fallback code for legacy teams
    for (let i = 0; i < teams.length; i++) {
      if (!teams[i].code) {
        teams[i].code = this.generateTeamCode(teams[i].name, i);
        await this.teamRepository.save(teams[i]);
      }
    }

    return teams.filter((team) => team.type === TeamType.PUBLIC || joinedTeamIds.includes(team.id));
  }

  async getTeamById(teamId: string, userId: string) {
    const team = await this.teamRepository.findOne({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Equipo no encontrado');
    }

    if (team.type === TeamType.PRIVATE) {
      const membership = await this.memberRepository.findOne({ where: { teamId, userId } });
      if (!membership) {
        throw new ForbiddenException('Este equipo es privado. Solo los miembros autorizados pueden ver sus detalles.');
      }
    }

    return team;
  }

  async joinPublicTeam(teamId: string, userId: string) {
    const team = await this.teamRepository.findOne({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Equipo no encontrado');
    }

    if (team.type !== TeamType.PUBLIC) {
      throw new ForbiddenException('No puedes unirte directamente a un equipo privado sin una invitación.');
    }

    const existing = await this.memberRepository.findOne({ where: { teamId, userId } });
    if (existing) {
      throw new ConflictException('Ya eres miembro de este equipo.');
    }

    const member = this.memberRepository.create({
      teamId,
      userId,
      role: TeamMemberRole.MEMBER,
    });
    return this.memberRepository.save(member);
  }

  async inviteMember(teamId: string, currentUserId: string, targetEmail: string, role: TeamMemberRole = TeamMemberRole.MEMBER) {
    const currentMember = await this.memberRepository.findOne({ where: { teamId, userId: currentUserId } });
    if (!currentMember || ![TeamMemberRole.OWNER, TeamMemberRole.ADMIN].includes(currentMember.role)) {
      throw new ForbiddenException('Solo los Propietarios y Administradores del equipo pueden invitar miembros.');
    }

    const targetUser = await this.userRepository.findOne({ where: { email: targetEmail.trim().toLowerCase() } });
    if (!targetUser) {
      throw new NotFoundException('El usuario con el correo especificado no está registrado en la plataforma.');
    }

    const existing = await this.memberRepository.findOne({ where: { teamId, userId: targetUser.id } });
    if (existing) {
      throw new ConflictException('El usuario ya pertenece a este equipo.');
    }

    const member = this.memberRepository.create({
      teamId,
      userId: targetUser.id,
      role,
    });
    return this.memberRepository.save(member);
  }

  async getMembers(teamId: string, currentUserId: string) {
    await this.getTeamById(teamId, currentUserId); // Check permissions
    const memberships = await this.memberRepository.find({ where: { teamId } });
    const userIds = memberships.map((m) => m.userId);

    const users = await this.userRepository.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return memberships.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      user: userMap.get(m.userId) || { id: m.userId, name: 'Usuario Desconocido', email: '' },
    }));
  }
}
