import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User } from '../entities/user.entity';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,

    configService: ConfigService,
  ) {
    super({
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'), // Así falla al iniciar la app si falta el secret
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // se extrae el token de jwt del header de la peticion
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const { id } = payload;

    const user = await this.userModel
      .findById(id)
      .select('_id email fullName roles')
      .lean()
      .exec();

    if (!user) throw new UnauthorizedException('Token not valid');

    return user;
  }
}
