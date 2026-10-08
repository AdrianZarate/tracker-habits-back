import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

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

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB'),
        dbName: 'habit-tracker',
      }),
    }),

    AuthModule,

    HabitsModule,

    CommonModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
