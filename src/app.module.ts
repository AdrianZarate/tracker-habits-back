import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { envConfig } from './config/env.config';
import { joiValidationSchema } from './config/joi.validation';
import { HabitsModule } from './habits/habits.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [envConfig],
      validationSchema: joiValidationSchema,
    }),

    MongooseModule.forRoot(process.env.MONGODB!, {
      dbName: 'habit-tracker',
    }),

    AuthModule,

    HabitsModule,

    CommonModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
