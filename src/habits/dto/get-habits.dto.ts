import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { HABIT_STATUSES } from '../entities/habit-user.entity';
import type { HabitStatus } from '../entities/habit-user.entity';

export class GetHabitsDto {
  @ApiPropertyOptional({ enum: [...HABIT_STATUSES, 'all'], default: 'active' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn([...HABIT_STATUSES, 'all'])
  status?: HabitStatus | 'all';
}
