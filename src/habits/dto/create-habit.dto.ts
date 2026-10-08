import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  PersonalHabitMetadataDto,
  trimPersonalText,
} from './personal-habit-metadata.dto';

export class CreateHabitDto extends PersonalHabitMetadataDto {
  @Transform(trimPersonalText)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;
}
