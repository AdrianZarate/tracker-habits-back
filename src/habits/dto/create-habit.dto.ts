import { IsString, MinLength } from 'class-validator';

export class CreateHabitDto {
  @IsString()
  @MinLength(3)
  title: string;
}
