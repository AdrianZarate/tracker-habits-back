import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export const trimPersonalText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Omission preserves metadata; a trimmed empty string clears it. Null is invalid. */
export class PersonalHabitMetadataDto {
  @Transform(trimPersonalText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(80)
  category?: string;

  @Transform(trimPersonalText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^(#[0-9a-fA-F]{6})?$/)
  color?: string;

  @Transform(trimPersonalText)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  icon?: string;
}
