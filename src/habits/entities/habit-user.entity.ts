import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../auth/entities/user.entity';
import { Habit } from './habit.entity';
import {
  ConfigurationRevision,
  isValidConfiguration,
  isValidConfigurationDate,
} from '../configuration/habit-configuration';

const ConfigurationRevisionSchema = new MongooseSchema(
  {
    revisionId: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
    effectiveFrom: {
      type: String,
      required: true,
      validate: isValidConfigurationDate,
    },
    // Mixed preserves discriminator fields for the shared strict validator, not casting.
    configuration: {
      type: MongooseSchema.Types.Mixed,
      required: true,
      validate: isValidConfiguration,
    },
  },
  { _id: false, strict: 'throw' },
);

@Schema()
export class HabitUser extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Habit.name,
    required: true,
  })
  habitId: Types.ObjectId;

  // No title default: legacy associations fall back to the shared catalog.
  @Prop({ trim: true, minlength: 3, maxlength: 200 })
  title?: string;

  @Prop({ trim: true, maxlength: 80 })
  category?: string;

  @Prop({ match: /^#[0-9a-fA-F]{6}$/ })
  color?: string;

  @Prop({ trim: true, maxlength: 64 })
  icon?: string;

  // No default/backfill: legacy rows resolve daily checkbox for every date.
  @Prop({ type: [ConfigurationRevisionSchema], default: undefined })
  configurationRevisions?: ConfigurationRevision[];

  @Prop({ default: true })
  active: boolean;
}

export const HabitUserSchema = SchemaFactory.createForClass(HabitUser);

// Índice compuesto para las queries más frecuentes
HabitUserSchema.index({ userId: 1, habitId: 1 }, { unique: true });
HabitUserSchema.index({ userId: 1, active: 1 });
