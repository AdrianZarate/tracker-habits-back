import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { User, UserSchema } from './entities/user.entity';

const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({ verifyIdToken })),
}));

const id = new Types.ObjectId('000000000000000000000001');
const profile = {
  sub: 'google-fixture',
  email: 'fixture@example.test',
  name: 'Fixture',
  picture: 'fixture.png',
};
const record = (timeZone?: string) => ({
  _id: id,
  googleId: profile.sub,
  email: profile.email,
  fullName: profile.name,
  picture: profile.picture,
  roles: ['user'],
  ...(timeZone === undefined ? {} : { timeZone }),
});
const query = (value: ReturnType<typeof record> | null) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('Google account timezone', () => {
  let service: AuthService;
  const model = {
    findOne: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const sign = jest.fn().mockReturnValue('fixture-jwt');

  beforeEach(async () => {
    jest.clearAllMocks();
    verifyIdToken.mockResolvedValue({ getPayload: () => profile });
    model.findOne.mockReturnValue(query(record('UTC')));
    model.findById.mockReturnValue(query(record('UTC')));
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: model },
        { provide: JwtService, useValue: { sign } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'fixture-client-id' },
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it.each(['Asia/Tokyo', undefined])(
    'assigns new account zone %s or UTC',
    async (timeZone) => {
      const expected = timeZone ?? 'UTC';
      model.findOne.mockReturnValue(query(null));
      model.create.mockResolvedValue(record(expected));
      model.findById.mockReturnValue(query(record(expected)));
      expect(
        await service.googleAuth({ idToken: 'fixture-google-token', timeZone }),
      ).toEqual({
        fullName: profile.name,
        email: profile.email,
        picture: profile.picture,
        token: 'fixture-jwt',
        timeZone: expected,
      });
      expect(model.create).toHaveBeenCalledWith({
        googleId: profile.sub,
        email: profile.email,
        fullName: profile.name,
        picture: profile.picture,
        timeZone: expected,
      });
      expect(sign).toHaveBeenCalledWith({ id: id.toHexString() });
      expect(verifyIdToken).toHaveBeenCalledWith({
        idToken: 'fixture-google-token',
        audience: 'fixture-client-id',
      });
    },
  );

  it.each(['Asia/Tokyo', undefined])(
    'atomically assigns legacy zone %s or UTC',
    async (timeZone) => {
      model.findOne.mockReturnValue(query(record()));
      model.findOneAndUpdate.mockReturnValue(query(record(timeZone ?? 'UTC')));
      const result = await service.googleAuth({
        idToken: 'fixture-google-token',
        timeZone,
      });
      expect(result.timeZone).toBe(timeZone ?? 'UTC');
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, timeZone: { $exists: false } },
        { $set: { timeZone: timeZone ?? 'UTC' } },
        { returnDocument: 'after' },
      );
    },
  );

  it('preserves existing zone when a later device supplies another', async () => {
    model.findOne.mockReturnValue(query(record('America/New_York')));
    expect(
      (
        await service.googleAuth({
          idToken: 'fixture-google-token',
          timeZone: 'Asia/Tokyo',
        })
      ).timeZone,
    ).toBe('America/New_York');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });

  it.each(['Mars/Olympus', '', '+01:00'])(
    'rejects supplied invalid zone %s even on an existing account',
    async (timeZone) => {
      await expect(
        service.googleAuth({ idToken: 'fixture-google-token', timeZone }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('rejects a supplied null zone despite optional DTO validation', async () => {
    const dto = Object.assign(new GoogleAuthDto(), {
      idToken: 'fixture-google-token',
      timeZone: null,
    });
    await expect(service.googleAuth(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps invalid Google tokens unauthorized', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid fixture token'));
    await expect(
      service.googleAuth({ idToken: 'invalid-fixture' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('keeps incomplete Google profiles unauthorized', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: profile.sub }),
    });
    await expect(
      service.googleAuth({ idToken: 'fixture-google-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows only the first concurrent legacy assignment', async () => {
    model.findOne.mockReturnValue(query(record()));
    let persisted = record();
    model.findOneAndUpdate.mockImplementation(
      (_filter: unknown, update: { $set: { timeZone: string } }) => {
        const assigned = persisted.timeZone === undefined;
        if (assigned) persisted = record(update.$set.timeZone);
        return query(assigned ? persisted : null);
      },
    );
    model.findById.mockImplementation(() => query(persisted));
    const results = await Promise.all([
      service.googleAuth({ idToken: 'first-fixture', timeZone: 'Asia/Tokyo' }),
      service.googleAuth({
        idToken: 'second-fixture',
        timeZone: 'America/New_York',
      }),
    ]);
    expect(results.map((result) => result.timeZone)).toEqual([
      'Asia/Tokyo',
      'Asia/Tokyo',
    ]);
    expect(persisted.timeZone).toBe('Asia/Tokyo');
  });

  it.each(['Asia/Tokyo', undefined])(
    'reads zone %s for the JWT-projected check-status user',
    async (timeZone) => {
      const projected = {
        _id: id,
        fullName: profile.name,
        email: profile.email,
        roles: ['user'],
      };
      const stored = query(record(timeZone));
      model.findById.mockReturnValue(stored);
      const result = await service.checkAuthStatus(projected);
      expect(result).toEqual({
        ...projected,
        token: 'fixture-jwt',
        timeZone: timeZone ?? 'UTC',
      });
      expect(result).not.toHaveProperty('googleId');
      expect(result).not.toHaveProperty('picture');
      expect(model.findById).toHaveBeenCalledWith(id);
      expect(stored.select).toHaveBeenCalledWith('timeZone');
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('validates optional DTO strings and leaves legacy schema values missing', async () => {
    const dto = Object.assign(new GoogleAuthDto(), {
      idToken: 'fixture-google-token',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(
      await validate(Object.assign(dto, { timeZone: 42 })),
    ).not.toHaveLength(0);
    expect(UserSchema.path('timeZone')).toBeDefined();
    expect(UserSchema.path('timeZone').options.default).toBeUndefined();
  });
});
