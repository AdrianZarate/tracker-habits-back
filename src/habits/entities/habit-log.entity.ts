import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../auth/entities/user.entity';
import { Habit } from './habit.entity';
import {
  isValidConfiguration,
  isValidConfigurationDate,
} from '../configuration/habit-configuration';
import type { ResolvedConfiguration } from '../configuration/habit-configuration';

function isValidSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const snapshot = value as Record<string, unknown>;
  return (
    Object.keys(snapshot).every((key) =>
      ['configuration', 'revisionId', 'effectiveFrom'].includes(key),
    ) &&
    isValidConfiguration(snapshot.configuration) &&
    (!Object.prototype.hasOwnProperty.call(snapshot, 'revisionId') ||
      (typeof snapshot.revisionId === 'string' &&
        /^[a-f0-9]{24}$/.test(snapshot.revisionId))) &&
    (!Object.prototype.hasOwnProperty.call(snapshot, 'effectiveFrom') ||
      isValidConfigurationDate(snapshot.effectiveFrom))
  );
}

@Schema()
export class HabitLog extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: User;

  @Prop({ type: Types.ObjectId, ref: 'Habit', required: true })
  habitId: Habit;

  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Boolean, default: true })
  completed: boolean;

  // Mixed prevents Mongoose from accepting numeric strings by casting them.
  @Prop({
    type: MongooseSchema.Types.Mixed,
    validate: (value: unknown) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1e9,
  })
  amount?: number;

  // No default/backfill. The service sets this only via $setOnInsert.
  @Prop({
    type: MongooseSchema.Types.Mixed,
    immutable: true,
    validate: isValidSnapshot,
  })
  configurationSnapshot?: ResolvedConfiguration;
}

export const HabitLogSchema = SchemaFactory.createForClass(HabitLog);

HabitLogSchema.index({ userId: 1, habitId: 1, date: 1 }, { unique: true });
