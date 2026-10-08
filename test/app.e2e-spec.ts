import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Auth, GetUser } from '../src/auth/decorators';
import { User } from '../src/auth/entities/user.entity';
import { UserRoleGuard } from '../src/auth/guards/user-role.guard';
import { ValidRoles } from '../src/auth/interfaces';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { CommonService } from '../src/common/common.service';
import { HabitsController } from '../src/habits/habits.controller';
import { HabitsService } from '../src/habits/habits.service';

// E2e config has no src alias mapping. These forward REAL exports, not stubs.
jest.mock(
  'src/auth/decorators',
  () =>
    jest.requireActual<typeof import('../src/auth/decorators')>(
      '../src/auth/decorators',
    ),
  { virtual: true },
);
jest.mock(
  'src/auth/entities/user.entity',
  () =>
    jest.requireActual<typeof import('../src/auth/entities/user.entity')>(
      '../src/auth/entities/user.entity',
    ),
  { virtual: true },
);
jest.mock(
  'src/common/pipes/parse-mongo-id.pipe',
  () =>
    jest.requireActual<
      typeof import('../src/common/pipes/parse-mongo-id.pipe')
    >('../src/common/pipes/parse-mongo-id.pipe'),
  { virtual: true },
);

@Controller('_test')
class SecurityFixtureController {
  @Get('identity')
  @Auth()
  identity(@GetUser() user: User) {
    return { id: user._id, timeZone: user.timeZone, roles: user.roles };
  }

  @Get('admin')
  @Auth(ValidRoles.admin)
  admin() {
    return { allowed: true };
  }
}

type Row = Record<string, unknown>;
const secret = 'fixed-synthetic-http-test-secret';
const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));
const [owner, other, admin, owned, inactive, foreign, missing] = [
  1, 2, 3, 10, 11, 12, 13,
].map(id);
const anchor = (day: string) => new Date(`${day}T00:00:00.000Z`);
const scalar = (value: unknown) =>
  value instanceof Types.ObjectId
    ? value.toHexString()
    : value instanceof Date
      ? value.getTime()
      : value;
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const path = (habit = owned, suffix = '') =>
  `/habits/${habit.toHexString()}${suffix}`;
// Doubles interpret service-supplied filters, never decide access by URL.
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (
      key === 'date' &&
      value &&
      typeof value === 'object' &&
      '$gte' in value &&
      '$lte' in value
    ) {
      return (
        row.date instanceof Date &&
        value.$gte instanceof Date &&
        value.$lte instanceof Date &&
        row.date >= value.$gte &&
        row.date <= value.$lte
      );
    }
    return scalar(row[key]) === scalar(value);
  });
}
const executable = (value: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
});
const log = (
  n: number,
  userId: Types.ObjectId,
  habitId: Types.ObjectId,
  day: string,
): Row => ({ _id: id(n), userId, habitId, date: anchor(day), completed: true });

describe('Isolated HTTP security and habit contracts', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let associations: Row[], logs: Row[];
  const catalog = [
    { _id: owned, title: 'Read daily', slug: 'read-daily' },
    { _id: inactive, title: 'Walk daily', slug: 'walk-daily' },
    { _id: foreign, title: 'Private habit', slug: 'private-habit' },
  ];
  const users = [owner, other, admin].map((_id, index) => ({
    _id,
    fullName: ['Owner', 'Other', 'Admin'][index],
    email: 'synthetic@example.invalid',
    roles: [index === 2 ? 'admin' : 'user'],
    timeZone: index === 0 ? 'America/Los_Angeles' : 'UTC',
  }));
  const select = jest.fn((projection: string, user: Row | undefined) => ({
    lean: () => ({
      exec: () =>
        Promise.resolve(
          user
            ? Object.fromEntries(
                projection.split(' ').map((key) => [key, user[key]]),
              )
            : null,
        ),
    }),
  }));
  const userModel = {
    findById: jest.fn((userId: string) => ({
      select: (projection: string) =>
        select(
          projection,
          users.find((user) => scalar(user._id) === userId),
        ),
    })),
  };
  const habitModel = {
    findOne: jest.fn((filter: Row) => ({
      lean: () =>
        Promise.resolve(catalog.find((row) => matches(row, filter)) ?? null),
    })),
  };
  const associationModel = {
    findOne: jest.fn((filter: Row) => ({
      lean: () =>
        Promise.resolve(
          associations.find((row) => matches(row, filter)) ?? null,
        ),
    })),
    findOneAndUpdate: jest.fn((filter: Row, update: Row, options: Row) => {
      void options;
      const row = associations.find((row) => matches(row, filter));
      if (row) Object.assign(row, update);
      return executable(row ?? null);
    }),
  };
  const logModel = {
    findOne: jest.fn((filter: Row) => ({
      lean: () =>
        Promise.resolve(logs.find((row) => matches(row, filter)) ?? null),
    })),
    find: jest.fn((filter: Row) =>
      executable(logs.filter((row) => matches(row, filter))),
    ),
    findOneAndUpdate: jest.fn((filter: Row, update: Row, options: Row) => {
      let row = logs.find((row) => matches(row, filter));
      if (!row && options.upsert) {
        row = { _id: id(30), ...filter, ...(update.$setOnInsert as Row) };
        logs.push(row);
      }
      if (row) Object.assign(row, update.$set);
      return executable(row ?? null);
    }),
    deleteOne: jest.fn((filter: Row) => {
      const before = logs.length;
      logs = logs.filter((row) => !matches(row, filter));
      return Promise.resolve({
        acknowledged: true,
        deletedCount: before - logs.length,
      });
    }),
    aggregate: jest.fn((pipeline: { $match?: Row }[]) =>
      Promise.resolve(
        logs
          .filter((row) => matches(row, pipeline[0].$match ?? {}))
          .map((row) => {
            const habit = catalog.find(
              (habit) => scalar(habit._id) === scalar(row.habitId),
            )!;
            return {
              _id: row._id,
              habitId: row.habitId,
              title: habit.title,
              slug: habit.slug,
              date: row.date,
              completed: row.completed,
              ...(row.amount !== undefined ? { amount: row.amount } : {}),
              ...(row.configurationSnapshot !== undefined
                ? { configurationSnapshot: row.configurationSnapshot }
                : {}),
            };
          })
          .sort((a, b) => Number(scalar(b.date)) - Number(scalar(a.date))),
      ),
    ),
  };
  const token = (user = owner, claims: Row = {}) =>
    jwt.sign({ id: user.toHexString(), ...claims });
  const send = (
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    bearer = token(),
  ) =>
    request(app.getHttpServer())
      [method](url)
      .set('Authorization', `Bearer ${bearer}`);
  const scope = (habitId = owned) => ({ userId: owner, habitId });
  const range = (habitId: Types.ObjectId, start: string, end: string) => ({
    ...scope(habitId),
    date: { $gte: anchor(start), $lte: anchor(end) },
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret }),
      ],
      controllers: [HabitsController, SecurityFixtureController],
      providers: [
        HabitsService,
        CommonService,
        JwtStrategy,
        UserRoleGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService(
            { JWT_SECRET: secret },
            { skipProcessEnv: true },
          ),
        },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken('Habit'), useValue: habitModel },
        { provide: getModelToken('HabitUser'), useValue: associationModel },
        { provide: getModelToken('HabitLog'), useValue: logModel },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
    jwt = module.get(JwtService);
    // Fake only the clock/calendar; HTTP scheduling remains real.
    jest.useFakeTimers({
      now: new Date('2025-04-01T00:30:00Z'),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
        'queueMicrotask',
      ],
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    associations = [
      { userId: owner, habitId: owned, active: true },
      { userId: owner, habitId: inactive, active: false },
      { userId: other, habitId: foreign, active: true },
    ];
    logs = [
      log(20, owner, owned, '2025-03-01'),
      log(21, owner, owned, '2025-03-31'),
      log(22, owner, inactive, '2024-02-29'),
      log(23, other, foreign, '2025-03-31'),
      log(24, owner, owned, '2025-04-01'),
    ];
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['missing', 'malformed', 'expired', 'wrong-secret', 'unknown-user'])(
    'rejects %s JWT before habit lookup',
    async (kind) => {
      const bearer = {
        missing: '',
        malformed: 'not-a-jwt',
        expired: token(owner, { exp: Math.floor(Date.now() / 1000) - 1 }),
        'wrong-secret': jwt.sign(
          { id: owner.toHexString() },
          { secret: 'different-synthetic-secret' },
        ),
        'unknown-user': token(id(99)),
      }[kind];
      const req = request(app.getHttpServer()).get(path());
      if (kind !== 'missing') req.set('Authorization', `Bearer ${bearer}`);
      const response = await req.expect(401);
      expect(response.body).toMatchObject({ statusCode: 401 });
      expect(associationModel.findOne).not.toHaveBeenCalled();
      expect(habitModel.findOne).not.toHaveBeenCalled();
      if (kind !== 'unknown-user')
        expect(userModel.findById).not.toHaveBeenCalled();
      else
        expect(userModel.findById).toHaveBeenCalledWith(id(99).toHexString());
    },
  );

  it('uses persisted identity/timezone, not forged signed claims', async () => {
    const forged = token(owner, { timeZone: 'Asia/Tokyo', roles: ['admin'] });
    await send('get', '/_test/identity', forged)
      .expect(200)
      .expect({
        id: owner.toHexString(),
        timeZone: 'America/Los_Angeles',
        roles: ['user'],
      });
    expect(userModel.findById).toHaveBeenCalledWith(owner.toHexString());
    expect(select).toHaveBeenCalledWith(
      '_id email fullName roles timeZone',
      users[0],
    );
  });

  it('runs real roles guard: regular user 403, administrator 200', async () => {
    await send('get', '/_test/admin').expect(403);
    await send('get', '/_test/admin', token(admin))
      .expect(200)
      .expect({ allowed: true });
  });

  it('routes static /habits/logs before ID and excludes other owners', async () => {
    const response = await send('get', '/habits/logs').expect(200);
    const expected = [logs[4], logs[1], logs[0], logs[2]].map((row) => {
      const habit = catalog.find(
        (habit) => scalar(habit._id) === scalar(row.habitId),
      )!;
      return {
        _id: row._id,
        habitId: row.habitId,
        title: habit.title,
        slug: habit.slug,
        date: row.date,
        completed: row.completed,
      };
    });
    expect(response.body).toEqual(json(expected));
    expect(logModel.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { userId: owner },
    });
    expect(associationModel.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [owned, true, catalog[0]],
    [inactive, false, catalog[1]],
  ] as const)(
    'reads owned %s including inactive associations',
    async (habitId, active, habit) => {
      await send('get', path(habitId)).expect(200).expect({
        habitId: habitId.toHexString(),
        title: habit.title,
        slug: habit.slug,
        active,
      });
      expect(associationModel.findOne).toHaveBeenCalledWith(scope(habitId));
      expect(habitModel.findOne).toHaveBeenCalledWith({ _id: habitId });
    },
  );

  it('returns identical 404 bodies for missing and non-owned detail', async () => {
    const absent = await send('get', path(missing)).expect(404);
    const nonowner = await send('get', path(foreign)).expect(404);
    expect(absent.body).toEqual({
      message: 'Habit not found for this user',
      error: 'Not Found',
      statusCode: 404,
    });
    expect(nonowner.body).toEqual(absent.body);
    expect(habitModel.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['get', ''],
    ['patch', ''],
    ['post', '/complete'],
    ['delete', '/incomplete'],
    ['get', '/logs'],
  ] as const)('rejects malformed ID on %s %s', async (method, suffix) => {
    await send(method, `/habits/bad${suffix}`).expect(400);
    expect(associationModel.findOne).not.toHaveBeenCalled();
    expect(associationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logModel.find).not.toHaveBeenCalled();
    expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logModel.deleteOne).not.toHaveBeenCalled();
  });

  it.each([foreign, inactive])(
    'denies completion without active ownership: %s',
    async (habitId) => {
      const before = json(logs);
      await send('post', path(habitId, '/complete')).expect(404);
      expect(associationModel.findOne).toHaveBeenCalledWith({
        ...scope(habitId),
        active: true,
      });
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(json(logs)).toEqual(before);
    },
  );

  it('denies foreign deactivation, permits idempotent owned deactivation', async () => {
    await send('patch', path(foreign)).expect(404);
    expect(associationModel.findOneAndUpdate).toHaveBeenCalledWith(
      scope(foreign),
      { active: false },
      { returnDocument: 'after' },
    );
    expect(associations[2].active).toBe(true);
    for (let n = 0; n < 2; n++) {
      await send('patch', path())
        .expect(200)
        .expect(json({ ...scope(), active: false }));
    }
  });

  it('foreign undo is a no-op, never deletes another owner’s log', async () => {
    const before = json(logs);
    await send('delete', path(foreign, '/incomplete'))
      .expect(200)
      .expect({ acknowledged: true, deletedCount: 0 });
    expect(logModel.deleteOne).toHaveBeenCalledWith({
      ...scope(foreign),
      date: anchor('2025-03-31'),
    });
    expect(json(logs)).toEqual(before);
  });

  it('complete reuses local day; undo leaves historical anchors untouched', async () => {
    for (let n = 0; n < 2; n++) {
      await send('post', path(owned, '/complete'))
        .expect(201)
        .expect(json(log(21, owner, owned, '2025-03-31')));
    }
    expect(logModel.findOneAndUpdate).toHaveBeenCalledWith(
      { ...scope(), date: anchor('2025-03-31'), _id: id(21) },
      { $set: { completed: true } },
      { returnDocument: 'after', runValidators: true },
    );
    expect(logs).toHaveLength(5);
    await send('delete', path(owned, '/incomplete'))
      .expect(200)
      .expect({ acknowledged: true, deletedCount: 1 });
    expect(logs.map((row) => row.date)).toEqual([
      anchor('2025-03-01'),
      anchor('2024-02-29'),
      anchor('2025-03-31'),
      anchor('2025-04-01'),
    ]);
  });

  it('inserts UTC current-day completion for a different account', async () => {
    const configurationSnapshot = {
      configuration: {
        schedule: { kind: 'daily' },
        goal: { kind: 'checkbox' },
      },
    };
    await send('post', path(foreign, '/complete'), token(other))
      .expect(201)
      .expect(
        json({
          ...log(30, other, foreign, '2025-04-01'),
          configurationSnapshot,
        }),
      );
    expect(logModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: other, habitId: foreign, date: anchor('2025-04-01') },
      { $setOnInsert: { completed: true, configurationSnapshot } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
  });

  it('records measured totals, retains the original snapshot, and exposes optional log fields', async () => {
    const snapshot = {
      revisionId: id(40).toHexString(),
      effectiveFrom: '2025-03-01',
      configuration: {
        schedule: { kind: 'weekly', timesPerWeek: 3 },
        goal: { kind: 'quantity', target: 20, unit: 'pages' },
      },
    };
    associations[0].configurationRevisions = [snapshot];
    await send('delete', path(owned, '/incomplete')).expect(200);
    for (const [amount, completed] of [
      [10, false],
      [20, true],
      [0, false],
    ]) {
      const response = await send('post', path(owned, '/complete'))
        .send({ amount })
        .expect(201);
      expect(response.body).toMatchObject({
        amount,
        completed,
        configurationSnapshot: snapshot,
      });
    }
    associations[0].configurationRevisions = [];
    const before = json(logs);
    await send('post', path(owned, '/complete')).expect(400);
    expect(json(logs)).toEqual(before);
    const response = await send('post', path(owned, '/complete'))
      .send({ amount: 15 })
      .expect(201);
    expect(response.body).toMatchObject({
      amount: 15,
      completed: false,
      configurationSnapshot: snapshot,
    });
    const history = await send('get', path(owned, '/logs')).expect(200);
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 15,
          configurationSnapshot: snapshot,
        }),
      ]),
    );
    const all = await send('get', '/habits/logs').expect(200);
    expect(all.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 15,
          configurationSnapshot: snapshot,
        }),
      ]),
    );
  });

  it.each([
    { amount: null },
    { amount: '1' },
    { amount: -1 },
    { amount: 1e9 + 1 },
    { amount: 0 },
    { completed: true },
    { configurationSnapshot: {} },
  ])(
    'rejects malformed completion or checkbox amounts %j without changing records',
    async (body) => {
      const before = json(logs);
      await send('post', path(owned, '/complete')).send(body).expect(400);
      expect(json(logs)).toEqual(before);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { title: 'ab' },
    { title: 42 },
    {},
    { title: 'Valid title', userId: other.toHexString() },
  ])('rejects invalid/create extra fields: %j', async (body) => {
    await send('post', '/habits').send(body).expect(400);
    expect(associationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    'startDate=oops',
    'startDate=2025-02-30',
    'startDate=0000-01-01',
    'startDate=',
    'startDate=2025-03-01T00:00:00Z',
    'endDate=2025-02-29',
    'startDate=2025-03-31&endDate=2025-03-01',
    'userId=someone',
    'timeZone=UTC',
  ])('rejects invalid/unsupported query %s before log query', async (query) => {
    await send('get', path(owned, `/logs?${query}`)).expect(400);
    expect(logModel.find).not.toHaveBeenCalled();
  });

  it('uses each account’s month, including both March bounds for owner', async () => {
    await send('get', path(owned, '/logs'))
      .expect(200)
      .expect(json([logs[0], logs[1]]));
    expect(logModel.find).toHaveBeenCalledWith(
      range(owned, '2025-03-01', '2025-03-31'),
    );
    await send('get', path(foreign, '/logs'), token(other))
      .expect(200)
      .expect([]);
    expect(logModel.find).toHaveBeenLastCalledWith({
      userId: other,
      habitId: foreign,
      date: { $gte: anchor('2025-04-01'), $lte: anchor('2025-04-30') },
    });
  });

  it('reads inactive leap-day history unchanged with inclusive labels', async () => {
    const url = path(inactive, '/logs?startDate=2024-02-29&endDate=2024-02-29');
    await send('get', url)
      .expect(200)
      .expect(json([logs[2]]));
    expect(logModel.find).toHaveBeenCalledWith(
      range(inactive, '2024-02-29', '2024-02-29'),
    );
  });

  it('returns no foreign history, even with explicit dates', async () => {
    const url = path(foreign, '/logs?startDate=2025-03-01&endDate=2025-03-31');
    await send('get', url).expect(200).expect([]);
    expect(logModel.find).toHaveBeenCalledWith(
      range(foreign, '2025-03-01', '2025-03-31'),
    );
  });
});
