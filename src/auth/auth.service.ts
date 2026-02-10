import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';

import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { User } from './entities/user.entity';
import { CreateUserDto } from './dto';
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
      const createdUser = await this.userModel.create({
        ...userData,
        password: bcrypt.hashSync(password, 10),
      });

      return {
        ...createdUser.toObject(),
        token: this.getJwtToken({ id: createdUser._id.toHexString() }),
      };
    } catch (error) {
      this.handleExceptions(error);
    }
  }
  // findAll() {
  //   return `This action returns all auth`;
  // }
  // findOne(id: number) {
  //   return `This action returns a #${id} auth`;
  // }
  // update(id: number, updateAuthDto: UpdateAuthDto) {
  //   return `This action updates a #${id} auth`;
  // }
  // remove(id: number) {
  //   return `This action removes a #${id} auth`;
  // }
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
