import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

import { Model } from 'mongoose';

import { User } from './entities/user.entity';
import { GoogleAuthDto } from './dto';
import { JwtPayload } from './interfaces';
import { isValidTimeZone } from '../common/calendar';

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

  async googleAuth({ idToken, timeZone }: GoogleAuthDto) {
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      throw new BadRequestException('Zona horaria IANA no válida');
    }

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
      throw new UnauthorizedException(
        'No se pudo obtener la información del usuario de Google',
      );
    }

    const { sub: googleId, email, name: fullName = '', picture = '' } = payload;

    let user = await this.userModel.findOne({ googleId }).lean().exec();

    if (!user) {
      const created = await this.userModel.create({
        googleId,
        email,
        fullName,
        picture,
        timeZone: timeZone ?? 'UTC',
      });
      user = (await this.userModel.findById(created._id).lean().exec())!;
    } else if (user.timeZone === undefined) {
      // The missing-field predicate makes the first assignment win atomically.
      const assigned = await this.userModel
        .findOneAndUpdate(
          { _id: user._id, timeZone: { $exists: false } },
          { $set: { timeZone: timeZone ?? 'UTC' } },
          { new: true },
        )
        .lean()
        .exec();
      user =
        assigned ?? (await this.userModel.findById(user._id).lean().exec())!;
    }

    return {
      fullName: user.fullName,
      email: user.email,
      picture: user.picture,
      timeZone: user.timeZone ?? 'UTC',
      token: this.getJwtToken({ id: user._id.toHexString() }),
    };
  }

  async checkAuthStatus(
    user: Pick<User, '_id' | 'email' | 'fullName' | 'roles'>,
  ) {
    // JWT validation projects public fields only; fetch just the calendar field.
    const account = await this.userModel
      .findById(user._id)
      .select('timeZone')
      .lean()
      .exec();
    return {
      ...user,
      timeZone: account?.timeZone ?? 'UTC',
      token: this.getJwtToken({ id: user._id.toHexString() }),
    };
  }

  private getJwtToken(payload: JwtPayload) {
    return this.jwtService.sign(payload);
  }
}
