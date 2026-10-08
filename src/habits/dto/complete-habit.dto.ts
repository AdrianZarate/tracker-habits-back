import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, Max, Min, ValidateIf } from 'class-validator';

/** A replacement daily total; omission is compatible only with checkbox goals. */
export class CompleteHabitDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1e9 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1e9)
  amount?: number;
}
