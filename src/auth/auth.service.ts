import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

import { Model } from 'mongoose';

import { User } from './entities/user.entity';
import { GoogleAuthDto } from './dto';
import { JwtPayload } from './interfaces';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,

    private readonly jwtService: JwtService,

    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async googleAuth({ idToken }: GoogleAuthDto) {
    const ticket = await this.googleClient
      .verifyIdToken({
        idToken,
        audience: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      })
      .catch(() => {
        throw new UnauthorizedException('Google token no válido');
      });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new UnauthorizedException('No se pudo obtener la información del usuario de Google');
    }

    const { sub: googleId, email, name: fullName = '', picture = '' } = payload;

    let user = await this.userModel.findOne({ googleId }).lean().exec();

    if (!user) {
      user = await this.userModel.create({ googleId, email, fullName, picture });
      user = (await this.userModel.findById(user._id).lean().exec())!;
    }

    return {
      fullName: user.fullName,
      email: user.email,
      picture: user.picture,
      token: this.getJwtToken({ id: (user._id as any).toHexString() }),
    };
  }

  checkAuthStatus(user: User) {
    return { ...user, token: this.getJwtToken({ id: user._id.toHexString() }) };
  }

  private getJwtToken(payload: JwtPayload) {
    return this.jwtService.sign(payload);
  }
}

