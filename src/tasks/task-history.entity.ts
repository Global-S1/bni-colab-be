import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('task_history')
export class TaskHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  taskId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  action: string; // e.g., 'STATUS_CHANGE', 'UPDATED', 'COMMENT_ADDED', 'REASSIGNED'

  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, { from: any; to: any }>;

  @CreateDateColumn()
  createdAt: Date;
}
