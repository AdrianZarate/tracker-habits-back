import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

import { Request } from 'express';
import { User } from '../entities/user.entity';

type AuthenticatedRequest = Request & { user?: User };

export const GetUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user)
      throw new InternalServerErrorException('User not found in request');

    return data ? user[data] : user;
  },
);
