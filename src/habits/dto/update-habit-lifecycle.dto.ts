import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { HABIT_STATUSES } from '../entities/habit-user.entity';
import type { HabitStatus } from '../entities/habit-user.entity';

export class UpdateHabitLifecycleDto {
  @ApiProperty({ enum: HABIT_STATUSES })
  @IsIn(HABIT_STATUSES)
  status: HabitStatus;
}
