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
    if (value && typeof value === 'object' && '$ne' in value)
      return scalar(row[key]) !== scalar(value.$ne);
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
const pauseUpdate = [
  {
    $set: {
      status: {
        $cond: [{ $eq: ['$status', 'archived'] }, 'archived', 'paused'],
      },
      active: false,
    },
  },
];
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
    findOneAndUpdate: jest.fn((filter: Row) =>
      Promise.resolve(catalog.find((row) => matches(row, filter))),
    ),
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
    findOneAndUpdate: jest.fn(
      (filter: Row, update: Row | Row[], options: Row) => {
        let row = associations.find((row) => matches(row, filter));
        if (!row && options.upsert) {
          // Model the unique owner/habit key, including an excluded archive.
          if (
            associations.some((existing) =>
              matches(existing, {
                userId: filter.userId,
                habitId: filter.habitId,
              }),
            )
          )
            return Promise.reject(
              Object.assign(new Error('Duplicate association'), {
                code: 11000,
              }),
            );
          row = {
            userId: filter.userId,
            habitId: filter.habitId,
            ...((update as Row).$setOnInsert as Row),
          };
          associations.push(row);
        }
        if (row) {
          if (Array.isArray(update)) {
            expect(update).toEqual(pauseUpdate);
            Object.assign(row, {
              status: row.status === 'archived' ? 'archived' : 'paused',
              active: false,
            });
          } else {
            Object.assign(row, update.$set);
            for (const key of Object.keys((update.$unset as Row) ?? {}))
              delete row[key];
          }
        }
        const result = executable(row ?? null);
        return { ...result, toObject: () => ({ ...row }) };
      },
    ),
    aggregate: jest.fn((pipeline: { $match?: Row; $addFields?: Row }[]) => {
      let rows = associations.map((row) => ({ ...row }));
      for (const stage of pipeline) {
        if (stage.$match)
          rows = rows.filter((row) => matches(row, stage.$match!));
        if (stage.$addFields)
          rows = rows.map((row) => ({
            ...row,
            status: row.status ?? (row.active === true ? 'active' : 'paused'),
          }));
      }
      return Promise.resolve(
        rows.map((row) => {
          const habit = catalog.find(
            (habit) => scalar(habit._id) === scalar(row.habitId),
          )!;
          return { ...row, title: row.title ?? habit.title, slug: habit.slug };
        }),
      );
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
      if (row) {
        Object.assign(row, update.$set);
        for (const key of Object.keys((update.$unset as Row) ?? {}))
          delete row[key];
      }
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
              ...(row.manualCompletion !== undefined
                ? { manualCompletion: row.manualCompletion }
                : {}),
              ...(row.amount !== undefined ? { amount: row.amount } : {}),
              ...(row.note !== undefined ? { note: row.note } : {}),
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

  describe('manual daily check', () => {
    const original = {
      revisionId: id(50).toHexString(),
      effectiveFrom: '2025-03-01',
      configuration: {
        schedule: { kind: 'weekdays', days: [7] },
        goal: { kind: 'quantity', target: 20, unit: 'pages' },
      },
    };

    it('preserves measured history and supports notes, calculated progress and today undo', async () => {
      associations[0].configurationRevisions = [original];
      Object.assign(logs[1], {
        amount: 2,
        note: 'Original',
        configurationSnapshot: original,
      });
      const before = json(logs);
      const todayBefore = { ...logs[1] };
      const first = await send('post', path(owned, '/check')).expect(201);
      expect(first.body).toEqual(
        json({ ...todayBefore, completed: true, manualCompletion: true }),
      );
      const repeat = await send('post', path(owned, '/check'))
        .send({})
        .expect(201);
      expect(repeat.body).toEqual(first.body);
      expect(json(logs.filter((row) => row !== logs[1]))).toEqual(
        (before as Row[]).filter((row) => row._id !== id(21).toHexString()),
      );
      const history = await send('get', path(owned, '/logs')).expect(200);
      expect(history.body).toEqual(expect.arrayContaining([first.body]));
      const week = await send('get', path(owned, '/week')).expect(200);
      expect((week.body as { days: Row[] }).days[0]).toMatchObject({
        date: '2025-03-31',
        manualCompletion: true,
        amount: 2,
        note: 'Original',
      });
      const summary = await send('get', '/habits/logs').expect(200);
      expect(summary.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: id(21).toHexString(),
            manualCompletion: true,
          }),
        ]),
      );
      const notes = await send('patch', path(owned, '/logs/2025-03-31'))
        .send({ note: 'Changed' })
        .expect(200);
      expect(notes.body).toMatchObject({ manualCompletion: true, amount: 2 });
      const progress = await send('post', path(owned, '/complete'))
        .send({ amount: 3 })
        .expect(201);
      expect(progress.body).toMatchObject({ amount: 3, completed: false });
      expect(progress.body).not.toHaveProperty('manualCompletion');
      await send('post', path(owned, '/check')).expect(201);
      await send('delete', path(owned, '/incomplete')).expect(200);
      expect(
        logs.some((row) =>
          matches(row, { ...scope(), date: anchor('2025-03-31') }),
        ),
      ).toBe(false);
      const inserted = await send('post', path(owned, '/check')).expect(201);
      expect(inserted.body).toMatchObject({
        date: '2025-03-31T00:00:00.000Z',
        completed: true,
        manualCompletion: true,
        configurationSnapshot: original,
      });
      expect(inserted.body).not.toHaveProperty('amount');
      expect(inserted.body).not.toHaveProperty('note');
      await send('post', path(owned, '/complete')).expect(400);
      const correction = await send('patch', path(owned, '/logs/2025-03-31'))
        .send({ amount: 1 })
        .expect(200);
      expect(correction.body).not.toHaveProperty('manualCompletion');
    });

    it.each([inactive, foreign, missing])(
      'rejects non-active or non-owned habit %s',
      async (habit) => {
        await send('post', path(habit, '/check')).expect(404);
        expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each(['paused', 'archived'])(
      'rejects %s despite stale active=true',
      async (status) => {
        associations[0].status = status;
        await send('post', path(owned, '/check')).expect(404);
        expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([
      { amount: 20 },
      { completed: true },
      { manualCompletion: true },
      { date: '2025-04-02' },
      [],
    ])('rejects nonempty or invalid body %j', async (body) => {
      await send('post', path(owned, '/check')).send(body).expect(400);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('requires authentication and a valid Mongo ID; exposes no date-specific check', async () => {
      await request(app.getHttpServer())
        .post(path(owned, '/check'))
        .expect(401);
      await send('post', '/habits/bad/check').expect(400);
      await send('post', path(owned, '/check/2025-04-02')).expect(404);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it.each(['active', 'paused', 'archived'])(
      'sets %s idempotently and retains history',
      async (status) => {
        const before = json(logs);
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await send('patch', path(owned, '/lifecycle'))
            .send({ status })
            .expect(200);
          expect(response.body).toMatchObject({
            status,
            active: status === 'active',
          });
        }
        expect(json(logs)).toEqual(before);
      },
    );

    it('retains original snapshots, pending definitions and inactive history through archive/edit/restore', async () => {
      const configuration = {
        schedule: { kind: 'daily' },
        goal: { kind: 'quantity', target: 20, unit: 'pages' },
      };
      const original = {
        revisionId: id(50).toHexString(),
        effectiveFrom: '2025-03-01',
        configuration,
      };
      const pending = { ...original, effectiveFrom: '2025-04-01' };
      associations[0].configurationRevisions = [original, pending];
      Object.assign(logs[0], {
        configurationSnapshot: original,
        amount: 15,
        note: 'Original goal',
      });
      const before = json(logs);
      await send('patch', path(owned, '/lifecycle'))
        .send({ status: 'archived' })
        .expect(200);
      const edited = await send('patch', path(owned, '/definition'))
        .send({ title: 'Personal archive', color: '#123abc' })
        .expect(200);
      expect(edited.body).toMatchObject({
        status: 'archived',
        active: false,
        title: 'Personal archive',
        configuration,
        pendingConfiguration: pending,
      });
      const history = await send(
        'get',
        path(owned, '/logs?startDate=2025-03-01&endDate=2025-04-01'),
      ).expect(200);
      expect(history.body).toEqual(
        json(logs.filter((row) => matches(row, scope()))),
      );
      await send('get', path(owned, '/week')).expect(200);
      await send('patch', path(owned, '/lifecycle'))
        .send({ status: 'active' })
        .expect(200);
      expect(json(logs)).toEqual(before);
      expect(associations[0].configurationRevisions).toEqual([
        original,
        pending,
      ]);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(logModel.deleteOne).not.toHaveBeenCalled();
    });

    it('never lets the old pause endpoint downgrade an archive', async () => {
      await send('patch', path(owned, '/lifecycle'))
        .send({ status: 'archived' })
        .expect(200);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await send('patch', path()).expect(200);
        expect(response.body).toMatchObject({
          status: 'archived',
          active: false,
        });
      }
    });

    it('requires explicit restore for archived POST and preserves configuration on paused POST', async () => {
      const configurationRevisions = [
        {
          revisionId: id(50).toHexString(),
          effectiveFrom: '2025-03-01',
          configuration: {
            schedule: { kind: 'daily' },
            goal: { kind: 'checkbox' },
          },
        },
      ];
      Object.assign(associations[0], {
        status: 'archived',
        active: false,
        configurationRevisions,
      });
      const before = json(associations);
      const rejected = await send('post', '/habits')
        .send({ title: 'Read daily' })
        .expect(409);
      expect((rejected.body as Row).message).toContain(
        'explicit restore required',
      );
      expect(json(associations)).toEqual(before);
      await send('patch', path(owned, '/lifecycle'))
        .send({ status: 'paused' })
        .expect(200);
      const response = await send('post', '/habits')
        .send({
          title: 'Read daily',
          configuration: {
            schedule: { kind: 'weekly', timesPerWeek: 2 },
            goal: { kind: 'checkbox' },
          },
        })
        .expect(201);
      expect(response.body).toMatchObject({
        status: 'active',
        active: true,
        configuration: configurationRevisions[0].configuration,
      });
      expect(associations[0].configurationRevisions).toEqual(
        configurationRevisions,
      );
    });

    it.each([undefined, 'active', 'paused', 'archived', 'all'])(
      'filters list by %s with legacy fallback and owner isolation',
      async (status) => {
        associations.push({
          userId: owner,
          habitId: foreign,
          status: 'archived',
          active: true,
          title: 'Personal archive',
          color: '#123abc',
        });
        const response = await send(
          'get',
          `/habits${status ? `?status=${status}` : ''}`,
        ).expect(200);
        const rows = response.body as Row[];
        const expected =
          status === 'all'
            ? ['active', 'paused', 'archived']
            : [status ?? 'active'];
        expect(rows.map((row) => row.status)).toEqual(expected);
        expect(
          rows.every((row) => row.active === (row.status === 'active')),
        ).toBe(true);
        if (status === 'archived')
          expect(rows[0]).toMatchObject({
            title: 'Personal archive',
            color: '#123abc',
          });
      },
    );

    it.each(['status=deleted', 'status=active&status=paused', 'active=true'])(
      'rejects invalid list query %s',
      async (query) => {
        await send('get', `/habits?${query}`).expect(400);
      },
    );

    it.each([foreign, missing])(
      'hides unowned lifecycle IDs %s',
      async (habit) => {
        await send('patch', path(habit, '/lifecycle'))
          .send({ status: 'archived' })
          .expect(404);
      },
    );

    it.each([
      {},
      { status: null },
      { status: 'deleted' },
      { status: 'paused', active: false },
    ])('rejects invalid lifecycle payload %j', async (body) => {
      await send('patch', path(owned, '/lifecycle')).send(body).expect(400);
    });

    it('requires authentication for lifecycle writes', async () => {
      await request(app.getHttpServer())
        .patch(path(owned, '/lifecycle'))
        .send({ status: 'paused' })
        .expect(401);
    });

    it.each(['paused', 'archived'])(
      'blocks new progress for inconsistent %s rows but permits existing correction',
      async (status) => {
        Object.assign(associations[0], { status, active: true });
        const before = json(logs);
        await send('post', path(owned, '/complete')).expect(404);
        await send('post', path(owned, '/complete'))
          .send({ amount: 5 })
          .expect(404);
        await send('patch', path(owned, '/logs/2025-03-30'))
          .send({ completed: true })
          .expect(404);
        expect(json(logs)).toEqual(before);
        await send('patch', path(owned, '/logs/2025-03-31'))
          .send({ completed: false })
          .expect(200);
        await send('get', path()).expect(200);
        await send('get', path(owned, '/week')).expect(200);
      },
    );
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

  it('reads seven account-date labels by default without writes', async () => {
    const before = json(logs);
    const response = await send('get', path(owned, '/week')).expect(200);
    const body = response.body as { date: string; days: Row[] };
    expect(body).toMatchObject({
      habitId: owned.toHexString(),
      date: '2025-03-31',
      weekStart: '2025-03-31',
      weekEnd: '2025-04-06',
      configuration: {
        schedule: { kind: 'daily' },
        goal: { kind: 'checkbox' },
      },
      scheduledOnDate: true,
      completedDays: 2,
    });
    expect(body.days).toHaveLength(7);
    expect(body.days[0]).toEqual({
      date: '2025-03-31',
      scheduled: true,
      completed: true,
      configurationSnapshot: {
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      },
    });
    expect(body).not.toHaveProperty('weeklyTarget');
    expect(logModel.find).toHaveBeenCalledWith(
      range(owned, '2025-03-31', '2025-04-06'),
    );
    expect(json(logs)).toEqual(before);
    expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(associationModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['0001-01-01', '9999-12-26', '2021-01-01'])(
    'reads supported early/late years and cross-year weeks: %s',
    async (date) => {
      const response = await send(
        'get',
        path(owned, `/week?date=${date}`),
      ).expect(200);
      const body = response.body as { date: string; days: Row[] };
      expect(body.date).toBe(date);
      expect(body.days).toHaveLength(7);
    },
  );

  it('uses original selected-date quota and stored booleans, preserving optional gaps', async () => {
    const configuration = {
      schedule: { kind: 'weekly', timesPerWeek: 2 },
      goal: { kind: 'quantity', target: 50, unit: 'pages' },
    };
    associations[0].configurationRevisions = [
      {
        revisionId: 'new',
        effectiveFrom: '2025-03-31',
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      },
    ];
    logs[1].configurationSnapshot = { revisionId: 'original', configuration };
    logs[1].amount = 0; // Stored completion, not the mismatching goal, is authority.
    logs[1].note = 'Original note';
    logs[4].completed = false;
    logs[4].amount = 1000;
    const response = await send(
      'get',
      path(owned, '/week?date=2025-03-31'),
    ).expect(200);
    const body = response.body as { days: Row[] };
    expect(body).toMatchObject({
      configuration,
      weeklyTarget: 2,
      weeklyCompleted: false,
      completedDays: 1,
    });
    expect(body.days[0]).toMatchObject({
      amount: 0,
      note: 'Original note',
      completed: true,
    });
    expect(body.days[1]).toMatchObject({
      amount: 1000,
      completed: false,
    });
    expect(body.days[2]).not.toHaveProperty('amount');
    expect(body.days[2]).not.toHaveProperty('note');
    const alternate = await send(
      'get',
      path(owned, '/week?date=2025-04-01'),
    ).expect(200);
    expect(alternate.body).not.toHaveProperty('weeklyTarget');
    expect(alternate.body).not.toHaveProperty('weeklyCompleted');
    expect(alternate.body).toMatchObject({ completedDays: 1, days: body.days });
  });

  it('reads inactive-owned weeks but hides missing and foreign associations identically', async () => {
    await send('get', path(inactive, '/week?date=2024-02-29')).expect(200);
    const a = await send('get', path(foreign, '/week')).expect(404);
    const b = await send('get', path(missing, '/week')).expect(404);
    expect(a.body).toEqual(b.body);
    await send('get', path(owned, '/week'), token(other)).expect(404);
  });

  it.each([
    '2025-02-29',
    '0000-01-01',
    '9999-12-31',
    '2025-04-01T00:00:00Z',
    '',
    'null',
  ])('rejects unsupported weekly date %s', async (date) => {
    await send(
      'get',
      path(owned, `/week?date=${encodeURIComponent(date)}`),
    ).expect(400);
    expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects repeated query values, unknown fields, malformed IDs and absent authentication', async () => {
    await send(
      'get',
      path(owned, '/week?date=2025-03-31&date=2025-04-01'),
    ).expect(400);
    await send('get', path(owned, '/week?extra=true')).expect(400);
    await send('get', '/habits/bad/week').expect(400);
    await request(app.getHttpServer()).get(path(owned, '/week')).expect(401);
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
      await send('get', path(habitId))
        .expect(200)
        .expect({
          habitId: habitId.toHexString(),
          title: habit.title,
          slug: habit.slug,
          active,
          status: active ? 'active' : 'paused',
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
      expect(associationModel.findOne).toHaveBeenCalledWith(scope(habitId));
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(json(logs)).toEqual(before);
    },
  );

  it('denies foreign deactivation, permits idempotent owned deactivation', async () => {
    await send('patch', path(foreign)).expect(404);
    expect(associationModel.findOneAndUpdate).toHaveBeenCalledWith(
      scope(foreign),
      pauseUpdate,
      { returnDocument: 'after' },
    );
    expect(associations[2].active).toBe(true);
    for (let n = 0; n < 2; n++) {
      await send('patch', path())
        .expect(200)
        .expect(json({ ...scope(), active: false, status: 'paused' }));
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
      { $set: { completed: true }, $unset: { manualCompletion: 1 } },
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

  describe('historical record corrections', () => {
    const correction = (habit = owned, day = '2025-03-31') =>
      path(habit, `/logs/${day}`);
    const snapshot = {
      revisionId: id(40).toHexString(),
      effectiveFrom: '2025-03-01',
      configuration: {
        schedule: { kind: 'daily' },
        goal: { kind: 'quantity', target: 20, unit: 'pages' },
      },
    };
    const correctedWithoutNote = (row: Row) => {
      const copy = { ...row };
      delete copy.note;
      return copy;
    };

    it('corrects using the original goal and preserves it through notes-only edits and reloads', async () => {
      Object.assign(logs[1], {
        amount: 25,
        configurationSnapshot: snapshot,
      });
      associations[0].configurationRevisions = [
        {
          ...snapshot,
          configuration: {
            ...snapshot.configuration,
            goal: { kind: 'quantity', target: 5, unit: 'pages' },
          },
        },
      ];
      const response = await send('patch', correction())
        .send({ amount: 15, note: '  Revised total  ' })
        .expect(200);
      expect(response.body).toMatchObject({
        amount: 15,
        completed: false,
        note: 'Revised total',
        configurationSnapshot: snapshot,
      });
      const corrected = response.body as Row;
      associations[0].active = false;
      const noted = await send('patch', correction())
        .send({ note: '  Context only  ' })
        .expect(200);
      expect(noted.body).toEqual({ ...corrected, note: 'Context only' });
      const history = await send('get', path(owned, '/logs')).expect(200);
      expect(history.body).toContainEqual({
        ...corrected,
        note: 'Context only',
      });
      const all = await send('get', '/habits/logs').expect(200);
      expect(all.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            note: 'Context only',
            amount: 15,
            completed: false,
          }),
        ]),
      );
      await send('patch', correction()).send({ note: '  ' }).expect(200);
      expect(logs[1]).not.toHaveProperty('note');
      const cleared = await send('get', path(owned, '/logs')).expect(200);
      expect(cleared.body).toContainEqual(correctedWithoutNote(corrected));
      const clearedAll = await send('get', '/habits/logs').expect(200);
      expect((clearedAll.body as Row[]).every((row) => !('note' in row))).toBe(
        true,
      );
    });

    it.each([true, false])(
      'inserts explicit past checkbox progress %s with an original snapshot',
      async (completed) => {
        const response = await send('patch', correction(owned, '2024-02-29'))
          .send({ completed, note: ' Leap day ' })
          .expect(200);
        expect(response.body).toMatchObject({
          date: anchor('2024-02-29').toISOString(),
          completed,
          note: 'Leap day',
          configurationSnapshot: {
            configuration: {
              schedule: { kind: 'daily' },
              goal: { kind: 'checkbox' },
            },
          },
        });
      },
    );

    it('requires active ownership and explicit progress for a missing record', async () => {
      await send('patch', correction()).send({ completed: false }).expect(200);
      expect(logs[1].completed).toBe(false);
      await send('patch', correction(owned, '2025-03-02'))
        .send({ note: 'No record' })
        .expect(400);
      await send('patch', correction(inactive, '2025-03-02'))
        .send({ completed: true })
        .expect(404);
      await send('patch', correction(inactive, '2024-02-29'))
        .send({ completed: false })
        .expect(200);
      const absent = await send('patch', correction(missing))
        .send({ completed: false })
        .expect(404);
      const nonowner = await send('patch', correction(foreign))
        .send({ completed: false })
        .expect(404);
      expect(nonowner.body).toEqual(absent.body);
      expect(logs[3].completed).toBe(true);
    });

    it('inserts scheduled past quantities and corrects snapshotless legacy gaps without backfill', async () => {
      const scheduled = {
        ...snapshot,
        configuration: {
          ...snapshot.configuration,
          schedule: { kind: 'weekdays', days: [7] },
        },
      };
      associations[0].configurationRevisions = [scheduled];
      const before = json(logs);
      await send('patch', correction(owned, '2025-03-29'))
        .send({ amount: 20 })
        .expect(400);
      expect(json(logs)).toEqual(before);
      const inserted = await send('patch', correction(owned, '2025-03-30'))
        .send({ amount: 20 })
        .expect(200);
      expect(inserted.body).toMatchObject({
        amount: 20,
        completed: true,
        configurationSnapshot: scheduled,
      });
      const legacy = await send('patch', correction())
        .send({ note: 'No inferred amount' })
        .expect(200);
      expect(legacy.body).not.toHaveProperty('amount');
      const corrected = await send('patch', correction())
        .send({ amount: 15 })
        .expect(200);
      expect(corrected.body).toMatchObject({ amount: 15, completed: false });
      expect(corrected.body).not.toHaveProperty('configurationSnapshot');
    });

    it('keeps notes through bodyless completion and returns 409 for a lost original identity', async () => {
      await send('patch', correction()).send({ note: 'Keep' }).expect(200);
      const response = await send('post', path(owned, '/complete')).expect(201);
      expect(response.body).toMatchObject({ note: 'Keep', completed: true });
      logModel.findOneAndUpdate.mockReturnValueOnce(executable(null));
      await send('patch', correction()).send({ completed: false }).expect(409);
      expect(logs[1]).toMatchObject({ note: 'Keep', completed: true });
    });

    it('rejects unauthenticated corrections and malformed habit IDs', async () => {
      await request(app.getHttpServer())
        .patch(correction())
        .send({ completed: false })
        .expect(401);
      await send('patch', '/habits/bad/logs/2025-03-31')
        .send({ completed: false })
        .expect(400);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      '2025-02-29',
      '2024-04-31',
      '0000-01-01',
      '2025-3-01',
      'oops',
      '2025-04-01',
      '2025-03-31T00:00:00Z',
    ])('rejects invalid or account-future calendar label %s', async (day) => {
      await send('patch', correction(owned, day))
        .send({ completed: false })
        .expect(400);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { note: null },
      { note: 4 },
      { note: 'x'.repeat(2001) },
      { amount: null },
      { amount: '4' },
      { amount: -1 },
      { amount: 1e9 + 1 },
      { completed: null },
      { completed: 'false' },
      { completed: 0 },
      { userId: other.toHexString() },
      { note: 'Valid', extra: true },
      { configurationSnapshot: snapshot },
      { amount: 1 },
    ])('rejects malformed/unsupported correction %j', async (body) => {
      const before = json(logs);
      await send('patch', correction()).send(body).expect(400);
      expect(json(logs)).toEqual(before);
      expect(logModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  it('returns no foreign history, even with explicit dates', async () => {
    const url = path(foreign, '/logs?startDate=2025-03-01&endDate=2025-03-31');
    await send('get', url).expect(200).expect([]);
    expect(logModel.find).toHaveBeenCalledWith(
      range(foreign, '2025-03-01', '2025-03-31'),
    );
  });
});
