import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';

import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { User } from './entities/user.entity';
import { CreateUserDto, LoginUserDto } from './dto';
import { JwtPayload } from './interfaces';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,

    private readonly jwtService: JwtService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const { password, ...userData } = createUserDto;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const createdUser = await this.userModel.create({
        ...userData,
        password: hashedPassword,
      });

      const { email, fullName } = createdUser;

      return {
        fullName,
        email,
        token: this.getJwtToken({ id: createdUser._id.toHexString() }),
      };
    } catch (error) {
      this.handleExceptions(error);
    }
  }

  async login(loginUserDto: LoginUserDto) {
    const { email, password } = loginUserDto;

    const user = await this.userModel
      .findOne({
        email,
      })
      .lean()
      .exec();

    if (!user)
      throw new UnauthorizedException('Credentials are not valid (email)');

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword)
      throw new UnauthorizedException('Credentials are not valid (password)');

    return {
      fullName: user.fullName,
      token: this.getJwtToken({ id: user._id.toHexString() }),
    };
  }

  checkAuthStatus(user: User) {
    return { ...user, token: this.getJwtToken({ id: user._id.toHexString() }) };
  }

  private handleExceptions(error: any) {
    if (error.code === 11000) {
      throw new BadRequestException(
        `User exists in db ${JSON.stringify(error.keyValue)}`,
      );
    }
    throw new InternalServerErrorException(
      `Can't create User - Check server logs`,
    );
  }

  private getJwtToken(payload: JwtPayload) {
    const token = this.jwtService.sign(payload);

    return token;
  }
}
