import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/auth/entities/user.entity';
import { Habit } from './habit.entity';

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
}

export const HabitLogSchema = SchemaFactory.createForClass(HabitLog);

HabitLogSchema.index({ userId: 1, habitId: 1, date: 1 }, { unique: true });
