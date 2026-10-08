import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { User } from '../entities/user.entity';
import { JwtStrategy } from './jwt.strategy';

const id = new Types.ObjectId('000000000000000000000001');

describe('JWT public account projection', () => {
  const model = { findById: jest.fn() };
  let strategy: JwtStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: getModelToken(User.name), useValue: model },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'test-secret' },
        },
      ],
    }).compile();
    strategy = module.get(JwtStrategy);
  });

  it.each(['Asia/Tokyo', 'America/Los_Angeles', undefined])(
    'passes persisted zone %s to authenticated handlers without private fields',
    async (timeZone) => {
      const stored = {
        _id: id,
        email: 'fixture@example.test',
        fullName: 'Fixture',
        roles: ['user'],
        googleId: 'private-fixture',
        picture: 'private-picture',
        ...(timeZone === undefined ? {} : { timeZone }),
      };
      let fields: string[] = [];
      const query = {
        select: jest.fn(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn(() =>
          Promise.resolve(
            Object.fromEntries(
              Object.entries(stored).filter(([key]) => fields.includes(key)),
            ),
          ),
        ),
      };
      query.select.mockImplementation((projection: string) => {
        fields = projection.split(' ');
        return query;
      });
      model.findById.mockReturnValue(query);
      const result = await strategy.validate({ id: id.toHexString() });
      expect(query.select).toHaveBeenCalledWith(
        '_id email fullName roles timeZone',
      );
      expect(result.timeZone).toBe(timeZone);
      expect(result).not.toHaveProperty('googleId');
      expect(result).not.toHaveProperty('picture');
      expect(model.findById).toHaveBeenCalledWith(id.toHexString());
    },
  );

  it('rejects a token whose account no longer exists', async () => {
    model.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(
      strategy.validate({ id: id.toHexString() }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
