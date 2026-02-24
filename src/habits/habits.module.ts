import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from 'src/auth/auth.module';
import { CommonModule } from 'src/common/common.module';

import { HabitsService } from './habits.service';
import { HabitsController } from './habits.controller';
import { HabitLogSchema, HabitSchema, HabitUserSchema } from './entities';

@Module({
  controllers: [HabitsController],
  providers: [HabitsService],
  imports: [
    MongooseModule.forFeature([
      { name: 'Habit', schema: HabitSchema },
      { name: 'HabitUser', schema: HabitUserSchema },
      { name: 'HabitLog', schema: HabitLogSchema },
    ]),
    AuthModule,
    CommonModule,
  ],
  exports: [MongooseModule],
})
export class HabitsModule {}
