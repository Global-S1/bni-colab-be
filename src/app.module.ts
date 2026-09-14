import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { User } from './users/user.entity';
import { Team } from './teams/team.entity';
import { TeamMember } from './teams/team-member.entity';
import { Project } from './projects/project.entity';
import { Task } from './tasks/task.entity';
import { TaskAttachment } from './tasks/task-attachment.entity';
import { TaskComment } from './tasks/task-comment.entity';
import { TaskHistory } from './tasks/task-history.entity';
import { Document } from './documents/document.entity';
import { Meeting } from './meetings/meeting.entity';

import { AuthModule } from './auth/auth.module';
import { TeamsModule } from './teams/teams.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MeetingsModule } from './meetings/meetings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<number>('DB_PORT', 5432)),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'bni_colab'),
        entities: [
          User,
          Team,
          TeamMember,
          Project,
          Task,
          TaskAttachment,
          TaskComment,
          TaskHistory,
          Document,
          Meeting,
        ],
        synchronize: true, // TypeORM auto-sync schema
      }),
    }),
    AuthModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
    DocumentsModule,
    NotificationsModule,
    MeetingsModule,
  ],
})
export class AppModule {}
