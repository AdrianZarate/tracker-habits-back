import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Habit extends Document {
  @Prop({ unique: true, index: true })
  title: string;

  @Prop({ unique: true, index: true })
  slug: string;
}

export const HabitSchema = SchemaFactory.createForClass(Habit);
