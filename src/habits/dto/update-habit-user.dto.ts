import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import {
  PersonalHabitMetadataDto,
  trimPersonalText,
} from './personal-habit-metadata.dto';

export class UpdateHabitUserDto extends PersonalHabitMetadataDto {
  @Transform(trimPersonalText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;
}
