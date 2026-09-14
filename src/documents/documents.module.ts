import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './document.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { ProjectsModule } from '../projects/projects.module';
import { ConfigModule } from '@nestjs/config';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Document, User]), ProjectsModule, ConfigModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
