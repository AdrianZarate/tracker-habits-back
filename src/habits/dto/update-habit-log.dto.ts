import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Explicit replacement progress and/or a note for an account calendar date. */
export class UpdateHabitLogDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 1e9 })
  // Run validation on empty payloads as well: at least one field is required.
  @ValidateIf(
    (dto: UpdateHabitLogDto, value: unknown) =>
      value !== undefined ||
      [dto.amount, dto.completed, dto.note].every(
        (field) => field === undefined,
      ),
  )
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1e9)
  amount?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(2000)
  note?: string;
}
