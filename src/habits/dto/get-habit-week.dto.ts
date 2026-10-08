import {
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isoWeekDates } from '../configuration/habit-week';

@ValidatorConstraint({ name: 'supportedHabitWeek', async: false })
export class SupportedHabitWeek implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      isoWeekDates(value);
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'date must be a real YYYY-MM-DD with a full ISO week in years 0001..9999';
  }
}

export class GetHabitWeekDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Validate(SupportedHabitWeek)
  date?: string;
}
