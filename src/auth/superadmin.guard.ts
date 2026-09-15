import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, SystemRole } from '../users/user.entity';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.userId) {
      throw new ForbiddenException('Acceso denegado. Se requiere una sesión válida en el sistema.');
    }

    // Consulta directa a la base de datos para verificar que el usuario sea SUPER_ADMIN activo
    const dbUser = await this.userRepository.findOne({ where: { id: user.userId } });

    if (!dbUser || dbUser.systemRole !== SystemRole.SUPER_ADMIN) {
      throw new ForbiddenException('Acceso denegado. Se requieren permisos de Super Administrador (Root).');
    }

    return true;
  }
}
