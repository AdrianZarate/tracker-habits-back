import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trimPersonalText } from './personal-habit-metadata.dto';
import { HabitConfigurationDto } from './habit-configuration.dto';

export class CreateHabitDto extends HabitConfigurationDto {
  @Transform(trimPersonalText)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;
}
