import { Transform } from 'class-transformer';
import {
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PersonalHabitMetadataDto } from './personal-habit-metadata.dto';
import type { HabitConfiguration } from '../configuration/habit-configuration';
import {
  isValidConfiguration,
  parseConfiguration,
} from '../configuration/habit-configuration';

@ValidatorConstraint({ name: 'completeHabitConfiguration', async: false })
export class CompleteHabitConfiguration implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidConfiguration(value);
  }

  defaultMessage(): string {
    return 'configuration must contain a valid complete schedule and goal bundle';
  }
}

/** Configuration is optional, but null/partial bundles are never patches. */
export class HabitConfigurationDto extends PersonalHabitMetadataDto {
  @Transform(({ value }: { value: unknown }) =>
    isValidConfiguration(value) ? parseConfiguration(value) : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Validate(CompleteHabitConfiguration)
  configuration?: HabitConfiguration;
}
