import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserSchema } from './entities/user.entity';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  imports: [
    MongooseModule.forFeature([{ name: 'User', schema: UserSchema }]),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: { expiresIn: '2h' },
        };
      },
    }),
  ],
  exports: [MongooseModule, JwtModule],
})
export class AuthModule {}
