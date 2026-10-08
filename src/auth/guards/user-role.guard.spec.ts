import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { META_ROLES } from '../decorators';
import { User } from '../entities/user.entity';
import { UserRoleGuard } from './user-role.guard';

function context(roles?: string[], user?: Pick<User, 'fullName' | 'roles'>) {
  const handler = () => undefined;
  if (roles !== undefined) Reflect.defineMetadata(META_ROLES, roles, handler);
  return new ExecutionContextHost([{ user }], undefined, handler);
}

function account(roles: string[]) {
  return { fullName: 'Fixture', roles };
}

describe('UserRoleGuard', () => {
  const guard = new UserRoleGuard(new Reflector());

  it.each([{ roles: undefined }, { roles: [] }])(
    'allows unrestricted metadata $roles without a user',
    ({ roles }) => {
      expect(guard.canActivate(context(roles))).toBe(true);
    },
  );

  it('requires a user for restricted handlers', () => {
    expect(() => guard.canActivate(context(['admin']))).toThrow(
      BadRequestException,
    );
  });

  it('allows any matching role, not just the first', () => {
    expect(
      guard.canActivate(context(['admin', 'user'], account(['guest', 'user']))),
    ).toBe(true);
  });

  it.each([{ roles: [] }, { roles: ['guest'] }])(
    'forbids nonmatching roles $roles with the existing message',
    ({ roles }) => {
      expect(() =>
        guard.canActivate(context(['admin', 'user'], account(roles))),
      ).toThrow(
        new ForbiddenException('User Fixture need a valid role: [admin,user]'),
      );
    },
  );
});
