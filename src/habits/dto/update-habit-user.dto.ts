import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { trimPersonalText } from './personal-habit-metadata.dto';
import { HabitConfigurationDto } from './habit-configuration.dto';

export class UpdateHabitUserDto extends HabitConfigurationDto {
  @Transform(trimPersonalText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;
}
