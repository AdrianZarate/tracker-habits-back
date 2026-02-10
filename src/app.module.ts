import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envConfig } from './config/env.config';
import { joiValidationSchema } from './config/joi.validation';
import { MongooseModule } from '@nestjs/mongoose';

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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
