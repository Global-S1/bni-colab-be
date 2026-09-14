import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SystemRole } from '../users/user.entity';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.systemRole !== SystemRole.SUPER_ADMIN) {
      throw new ForbiddenException('Acceso denegado. Se requieren permisos de Super Administrador (Root).');
    }
    return true;
  }
}
