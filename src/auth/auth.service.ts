import { Injectable, ForbiddenException, NotFoundException, UnauthorizedException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User, SystemRole, UserStatus } from '../users/user.entity';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthService implements OnModuleInit {
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    const isSecure = this.configService.get<string>('SMTP_SECURE') === 'true';
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST', 'mail.globals.one'),
      port: Number(this.configService.get<number>('SMTP_PORT', 587)),
      secure: isSecure,
      auth: {
        user: this.configService.get<string>('SMTP_USER', 'bnitech@globals.one'),
        pass: this.configService.get<string>('SMTP_PASS', 'GzgBCHmksTD7ysF'),
      },
      tls: {
        rejectUnauthorized: false, // soporte para certificados personalizados
      },
    });
  }

  async onModuleInit() {
    // Si no hay ningún SUPER_ADMIN, no auto-creamos para que la plataforma permita al usuario crear el primer root
    const rootCount = await this.userRepository.count({ where: { systemRole: SystemRole.SUPER_ADMIN } });
    console.log(`[BNI Colab] Conteo de usuarios SUPER_ADMIN registrados: ${rootCount}`);
  }

  // Comprobar si existe al menos un usuario root en la plataforma
  async checkRootStatus(): Promise<{ hasRoot: boolean }> {
    const count = await this.userRepository.count({ where: { systemRole: SystemRole.SUPER_ADMIN } });
    return { hasRoot: count > 0 };
  }

  // Crear el primer Root Admin si la plataforma no cuenta con uno
  async setupFirstRoot(dto: { email: string; name?: string }): Promise<{ message: string; user: any; accessToken: string }> {
    const count = await this.userRepository.count({ where: { systemRole: SystemRole.SUPER_ADMIN } });
    if (count > 0) {
      throw new ForbiddenException('La plataforma ya cuenta con un Administrador Root registrado.');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new BadRequestException('El correo electrónico es requerido.');
    }

    let user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
    if (user) {
      user.name = dto.name || user.name;
      user.systemRole = SystemRole.SUPER_ADMIN;
      user.status = UserStatus.ACTIVE;
      user.metadata = { ...user.metadata, isFirstRoot: true, setupAt: new Date().toISOString() };
    } else {
      user = this.userRepository.create({
        email: normalizedEmail,
        name: dto.name || 'Super Administrador Root',
        systemRole: SystemRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        metadata: { isFirstRoot: true, setupAt: new Date().toISOString() },
      });
    }

    const savedUser = await this.userRepository.save(user);

    const sessionPayload = {
      sub: savedUser.id,
      email: savedUser.email,
      systemRole: savedUser.systemRole,
    };
    const accessToken = this.jwtService.sign(sessionPayload, { expiresIn: '30d' });

    return {
      message: 'Administrador Root creado exitosamente. Acceso concedido.',
      user: {
        id: savedUser.id,
        email: savedUser.email,
        name: savedUser.name,
        systemRole: savedUser.systemRole,
      },
      accessToken,
    };
  }

  async requestMagicLink(email: string): Promise<{ message: string; magicUrl?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user) {
      throw new ForbiddenException(
        'El correo ingresado no está registrado en el sistema. Solicita acceso al Administrador Root.',
      );
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Tu cuenta ha sido desactivada por el Administrador.');
    }

    const payload = { sub: user.id, email: user.email, type: 'MAGIC_LINK' };
    const magicToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4322');
    const magicUrl = `${frontendUrl}/auth/verify?token=${magicToken}`;

    // Enviar correo con la plantilla Branded Global S1 (Rojo, Blanco, Negro)
    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM', 'BNI Colab <bnitech@globals.one>'),
        to: user.email,
        subject: '🚀 Tu Enlace Mágico de Acceso a BNI Colab',
        html: `
          <div style="background-color: #0A0A0A; padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #ffffff;">
            <div style="max-width: 550px; margin: 0 auto; background: #141414; border-radius: 16px; padding: 32px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.8);">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-block; background: #CF142B; color: #FFFFFF; font-weight: 800; font-size: 24px; padding: 8px 18px; border-radius: 12px;">
                  BNI Colab
                </div>
              </div>
              <h2 style="color: #FFFFFF; margin-top: 0; font-size: 22px; font-weight: bold; text-align: center;">Acceso Seguro</h2>
              <p style="color: #E5E5E5; font-size: 15px; line-height: 1.6;">Hola <strong>${user.name || user.email}</strong>,</p>
              <p style="color: #E5E5E5; font-size: 15px; line-height: 1.6;">Haz clic en el siguiente botón para ingresar a la plataforma colaborativa de proyectos y equipos:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${magicUrl}" style="background-color: #CF142B; color: #ffffff; padding: 14px 30px; text-decoration: none; font-size: 15px; font-weight: bold; border-radius: 10px; display: inline-block; box-shadow: 0 4px 15px rgba(207,20,43,0.5);">
                  Ingresar a BNI Colab
                </a>
              </div>
              <p style="color: #A3A3A3; font-size: 13px; text-align: center;">Este enlace expira en 15 minutos.</p>
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 25px 0;" />
              <p style="color: #737373; font-size: 12px; text-align: center;">Si no solicitaste este acceso, puedes ignorar este mensaje.</p>
            </div>
          </div>
        `,
      });
      console.log(`[AuthService] Correo enviado a ${user.email} con éxito`);
    } catch (error) {
      console.warn('[Nodemailer Warning] Error enviando correo de magic link:', error);
    }

    return { 
      message: 'Enlace mágico enviado exitosamente a tu correo electrónico.',
      magicUrl: process.env.NODE_ENV !== 'production' || !process.env.SMTP_PASS ? magicUrl : undefined 
    };
  }

  async verifyMagicLink(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'MAGIC_LINK') {
        throw new UnauthorizedException('Tipo de token inválido.');
      }

      const user = await this.userRepository.findOne({ where: { id: payload.sub } });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado.');
      }

      if (user.status === UserStatus.INVITED) {
        user.status = UserStatus.ACTIVE;
        await this.userRepository.save(user);
      }

      const sessionPayload = {
        sub: user.id,
        email: user.email,
        systemRole: user.systemRole,
      };

      const accessToken = this.jwtService.sign(sessionPayload, { expiresIn: '30d' });

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
          status: user.status,
          metadata: user.metadata,
        },
      };
    } catch (err) {
      throw new UnauthorizedException('El enlace mágico es inválido o ha expirado.');
    }
  }

  // Google OAuth Login / Token Verification
  async loginWithGoogleToken(tokenData: { email: string; name?: string }): Promise<{ accessToken: string; user: any }> {
    const normalizedEmail = tokenData.email.trim().toLowerCase();
    let user = await this.userRepository.findOne({ where: { email: normalizedEmail } });

    if (!user) {
      // Check if there are zero users in the platform. If so, make them Super Admin!
      const totalUsers = await this.userRepository.count();
      if (totalUsers === 0) {
        user = this.userRepository.create({
          email: normalizedEmail,
          name: tokenData.name || 'Root Super Admin',
          systemRole: SystemRole.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
          metadata: { provider: 'google', isFirstRoot: true },
        });
        await this.userRepository.save(user);
      } else {
        throw new ForbiddenException(
          'El correo de Google no está pre-registrado en el sistema. Solicita acceso al Administrador Root.',
        );
      }
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Tu cuenta ha sido desactivada por el Administrador.');
    }

    if (user.status === UserStatus.INVITED) {
      user.status = UserStatus.ACTIVE;
      await this.userRepository.save(user);
    }

    const sessionPayload = {
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    };
    const accessToken = this.jwtService.sign(sessionPayload, { expiresIn: '30d' });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        systemRole: user.systemRole,
        status: user.status,
      },
    };
  }

  async preRegisterUser(dto: { email: string; name?: string; systemRole?: SystemRole; metadata?: Record<string, any> }) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    let user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
    if (user) {
      user.name = dto.name || user.name;
      user.systemRole = dto.systemRole || user.systemRole;
      user.metadata = { ...user.metadata, ...dto.metadata };
    } else {
      user = this.userRepository.create({
        email: normalizedEmail,
        name: dto.name || normalizedEmail.split('@')[0],
        systemRole: dto.systemRole || SystemRole.USER,
        status: UserStatus.INVITED,
        metadata: dto.metadata || {},
      });
    }
    return this.userRepository.save(user);
  }

  async getAllUsers() {
    return this.userRepository.find({ order: { createdAt: 'DESC' } });
  }

  async getCurrentUser(userId: string) {
    return this.userRepository.findOne({ where: { id: userId } });
  }

  async updateProfile(userId: string, dto: { name?: string; metadata?: Record<string, any> }) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.metadata !== undefined) user.metadata = { ...user.metadata, ...dto.metadata };
    return this.userRepository.save(user);
  }
}
