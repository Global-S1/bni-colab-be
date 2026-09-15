import { Controller, Post, Get, Patch, Body, Query, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SuperAdminGuard } from './superadmin.guard';
import { SystemRole } from '../users/user.entity';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Verificar si la plataforma cuenta con al menos un usuario root
  @Get('root-status')
  async checkRootStatus() {
    return this.authService.checkRootStatus();
  }

  // Configurar el primer Root Admin si la plataforma no cuenta con uno
  @Post('setup-first-root')
  async setupFirstRoot(@Body() body: { email: string; name?: string }) {
    return this.authService.setupFirstRoot(body);
  }

  @Post('register')
  async registerUser(@Body() body: { email: string; name?: string }) {
    return this.authService.registerNewUser(body);
  }

  @Post('magic-link')
  async requestMagicLink(@Body() body: { email: string }) {
    return this.authService.requestMagicLink(body.email);
  }

  @Get('verify')
  async verifyMagicLink(@Query('token') token: string) {
    return this.authService.verifyMagicLink(token);
  }

  @Post('google')
  async loginWithGoogle(@Body() body: { email: string; name?: string }) {
    return this.authService.loginWithGoogleToken(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
    return this.authService.getCurrentUser(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(@Request() req, @Body() body: { name?: string; metadata?: any }) {
    return this.authService.updateProfile(req.user.userId, body);
  }

  // Rutas exclusivas del Super Admin (Root)
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('admin/users')
  async preRegisterUser(@Body() body: { email: string; name?: string; systemRole?: SystemRole; metadata?: any }) {
    return this.authService.preRegisterUser(body);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('admin/users')
  async getAllUsers() {
    return this.authService.getAllUsers();
  }
}
