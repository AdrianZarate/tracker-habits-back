import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { model, Types } from 'mongoose';
import { User, UserSchema } from '../auth/entities/user.entity';
import { GetLogsDto } from './dto/get-logs.dto';
import { HabitsService } from './habits.service';

import { CommonService } from '../common/common.service';

const ownerId = new Types.ObjectId('000000000000000000000001');
const habitId = new Types.ObjectId('000000000000000000000002');
const otherId = new Types.ObjectId('000000000000000000000003');
const id = habitId.toHexString();
const anchor = (day: string) => new Date(`${day}T00:00:00.000Z`);
// Construct a schema-backed fixture only; no connection or database operations.
const FixtureUser = model<User>('CalendarFixtureUser', UserSchema);
const account = (timeZone?: string) =>
  new FixtureUser({ _id: ownerId, timeZone });
const query = (value: unknown) => ({
  lean: jest.fn().mockResolvedValue(value),
  exec: jest.fn().mockResolvedValue(value),
});
const executableQuery = (value: unknown) => ({
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('Habit route declarations', () => {
  it('declares static logs before the authenticated, Mongo-ID-piped detail route', () => {
    const source = readFileSync(
      join(__dirname, 'habits.controller.ts'),
      'utf8',
    );
    expect(source).toContain('@Auth()');
    expect(source).toContain("@Get(':habitId')");
    expect(source.indexOf("@Get('logs')")).toBeLessThan(
      source.indexOf("@Get(':habitId')"),
    );
    expect(source).toMatch(
      /@Get\(':habitId'\)[\s\S]*?@Param\('habitId', ParseMongoIdPipe\)/,
    );
  });
});

describe('Owner-scoped habit calendar operations', () => {
  let service: HabitsService;
  const habit = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const association = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    aggregate: jest.fn(),
  };
  const logs = {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    aggregate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2025-04-01T00:30:00Z'));
    association.findOne.mockReturnValue(query({ active: true, habitId }));
    habit.findOne.mockReturnValue(
      query({ _id: habitId, title: 'Read', slug: 'read' }),
    );
    logs.find.mockReturnValue(executableQuery([]));
    logs.findOneAndUpdate.mockReturnValue(executableQuery({ completed: true }));
    logs.deleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
    const module = await Test.createTestingModule({
      providers: [
        HabitsService,
        { provide: getModelToken('Habit'), useValue: habit },
        { provide: getModelToken('HabitUser'), useValue: association },
        { provide: getModelToken('HabitLog'), useValue: logs },
        { provide: CommonService, useValue: { handleExceptions: jest.fn() } },
      ],
    }).compile();
    service = module.get(HabitsService);
  });

  afterEach(() => jest.useRealTimers());

  it.each([true, false])(
    'reads an owned habit with active=%s',
    async (active) => {
      association.findOne.mockReturnValue(query({ active, habitId }));
      expect(await service.findOneByUser(id, account())).toEqual({
        habitId,
        title: 'Read',
        slug: 'read',
        active,
      });
      expect(association.findOne).toHaveBeenCalledWith({
        userId: ownerId,
        habitId,
      });
      expect(habit.findOne).toHaveBeenCalledWith({ _id: habitId });
    },
  );

  it.each(['missing', 'other owner'])(
    'returns the same 404 for %s',
    async (scenario) => {
      const stored =
        scenario === 'missing'
          ? []
          : [{ userId: otherId, habitId, active: true }];
      association.findOne.mockImplementation(
        (filter: { userId: Types.ObjectId; habitId: Types.ObjectId }) =>
          query(
            stored.find(
              (item) =>
                item.userId.equals(filter.userId) &&
                item.habitId.equals(filter.habitId),
            ) ?? null,
          ),
      );
      await expect(service.findOneByUser(id, account())).rejects.toEqual(
        new NotFoundException('Habit not found for this user'),
      );
      expect(association.findOne).toHaveBeenCalledWith({
        userId: ownerId,
        habitId,
      });
      expect(habit.findOne).not.toHaveBeenCalled();
    },
  );

  it('uses personal metadata without changing catalog identity', async () => {
    association.findOne.mockReturnValue(
      query({
        habitId,
        active: false,
        title: 'My reading',
        category: 'Learning',
        color: '#123abc',
        icon: 'book',
      }),
    );
    expect(await service.findOneByUser(id, account())).toEqual({
      habitId,
      active: false,
      title: 'My reading',
      category: 'Learning',
      color: '#123abc',
      icon: 'book',
      slug: 'read',
    });
  });

  it.each([true, false])(
    'create/reactivate stores personal title with previous active=%s',
    async (active) => {
      const catalog = { _id: habitId, title: 'Original catalog', slug: 'read' };
      habit.findOneAndUpdate.mockResolvedValue(catalog);
      const owned = {
        userId: ownerId,
        habitId,
        active,
        title: 'Old title',
        icon: 'book',
      };
      const foreign = {
        userId: otherId,
        habitId,
        active: false,
        title: 'Other title',
      };
      association.findOneAndUpdate.mockImplementation(
        (
          filter: { userId: Types.ObjectId; habitId: Types.ObjectId },
          update: { $set: object },
        ) => {
          const row = [owned, foreign].find(
            (item) =>
              item.userId.equals(filter.userId) &&
              item.habitId.equals(filter.habitId),
          );
          Object.assign(row!, update.$set);
          return Promise.resolve({ toObject: () => row });
        },
      );
      expect(await service.create({ title: 'Read' }, account())).toEqual({
        ...owned,
        title: 'Read',
        active: true,
      });
      expect(owned.active).toBe(true);
      expect(owned.icon).toBe('book');
      expect(foreign.title).toBe('Other title');
      expect(habit.findOneAndUpdate).toHaveBeenCalledWith(
        { slug: 'read' },
        { $setOnInsert: { title: 'Read', slug: 'read' } },
        expect.objectContaining({ upsert: true }),
      );
      expect(association.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: ownerId, habitId },
        { $set: { active: true, title: 'Read' } },
        expect.objectContaining({ upsert: true }),
      );
      expect(catalog.title).toBe('Original catalog');
    },
  );

  it('projects personal titles and optional metadata in the owner list', async () => {
    association.aggregate.mockResolvedValue([]);
    await service.findAllByUser(account());
    expect(association.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        { $match: { userId: ownerId, active: true } },
        {
          $project: {
            _id: 0,
            habitId: '$habit._id',
            title: { $ifNull: ['$title', '$habit.title'] },
            slug: '$habit.slug',
            category: { $ifNull: ['$category', '$$REMOVE'] },
            color: { $ifNull: ['$color', '$$REMOVE'] },
            icon: { $ifNull: ['$icon', '$$REMOVE'] },
          },
        },
      ]),
    );
  });

  it('joins log titles on both authenticated owner and stable habit identity', async () => {
    logs.aggregate.mockResolvedValue([]);
    await service.getLogsByUser(account());
    expect(logs.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $lookup: {
            from: 'habitusers',
            let: { owner: '$userId', habit: '$habitId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$owner'] },
                      { $eq: ['$habitId', '$$habit'] },
                    ],
                  },
                },
              },
            ],
            as: 'definition',
          },
        },
        {
          $project: {
            _id: 1,
            habitId: '$habit._id',
            title: {
              $ifNull: [
                { $arrayElemAt: ['$definition.title', 0] },
                '$habit.title',
              ],
            },
            slug: '$habit.slug',
            date: 1,
            completed: 1,
          },
        },
      ]),
    );
  });

  it.each([true, false])(
    'edits an owned definition with active=%s without touching logs or catalog',
    async (active) => {
      association.findOneAndUpdate.mockReturnValue(
        executableQuery({
          habitId,
          active,
          title: 'Personal read',
          color: '#abcdef',
        }),
      );
      expect(
        await service.updateDefinition(
          id,
          { title: 'Personal read', category: '', color: '#abcdef' },
          account(),
        ),
      ).toEqual({
        habitId,
        active,
        title: 'Personal read',
        color: '#abcdef',
        slug: 'read',
      });
      expect(association.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: ownerId, habitId },
        {
          $set: { title: 'Personal read', color: '#abcdef' },
          $unset: { category: 1 },
        },
        { returnDocument: 'after', runValidators: true },
      );
      expect(habit.findOneAndUpdate).not.toHaveBeenCalled();
      expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'foreign'])(
    'definition edit returns equivalent 404 for %s and never upserts',
    async (scenario) => {
      const foreign = { userId: otherId, habitId, title: 'Private title' };
      association.findOneAndUpdate.mockImplementation(
        (filter: { userId: Types.ObjectId; habitId: Types.ObjectId }) =>
          executableQuery(
            scenario === 'foreign' && foreign.userId.equals(filter.userId)
              ? foreign
              : null,
          ),
      );
      await expect(
        service.updateDefinition(id, { title: 'Changed' }, account()),
      ).rejects.toEqual(new NotFoundException('Habit not found for this user'));
      expect(association.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: ownerId, habitId },
        { $set: { title: 'Changed' } },
        { returnDocument: 'after', runValidators: true },
      );
      expect(foreign.title).toBe('Private title');
      expect(habit.findOne).not.toHaveBeenCalled();
    },
  );

  it('accepts an empty definition patch as an owned read, not deactivation', async () => {
    expect(await service.updateDefinition(id, {}, account())).toEqual({
      habitId,
      active: true,
      title: 'Read',
      slug: 'read',
    });
    expect(association.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('creates personal metadata and clears supplied empty metadata', async () => {
    habit.findOneAndUpdate.mockResolvedValue({ _id: habitId });
    association.findOneAndUpdate.mockResolvedValue({
      toObject: () => ({
        habitId,
        title: 'Read',
        category: 'Learning',
        color: '#abcdef',
      }),
    });
    await service.create(
      { title: 'Read', category: 'Learning', color: '#abcdef', icon: '' },
      account(),
    );
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      {
        $set: {
          active: true,
          title: 'Read',
          category: 'Learning',
          color: '#abcdef',
        },
        $unset: { icon: 1 },
      },
      expect.objectContaining({ upsert: true }),
    );
  });

  it('returns 404 for an orphaned association', async () => {
    habit.findOne.mockReturnValue(query(null));
    await expect(service.findOneByUser(id, account())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['Asia/Tokyo', '2025-03-31T16:00:00Z', '2025-04-01'],
    ['America/Los_Angeles', '2025-04-01T00:30:00Z', '2025-03-31'],
    ['America/New_York', '2025-03-09T07:30:00Z', '2025-03-09'],
    [undefined, '2025-04-01T00:30:00Z', '2025-04-01'],
  ])('complete/undo share the %s day key', async (zone, instant, day) => {
    jest.setSystemTime(new Date(instant));
    const user = account(zone);
    expect(await service.complete(id, user)).toEqual({ completed: true });
    expect(await service.complete(id, user)).toEqual({ completed: true });
    expect(logs.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { userId: ownerId, habitId, date: anchor(day) },
      { completed: true },
      { upsert: true, returnDocument: 'after' },
    );
    expect(association.findOne).toHaveBeenCalledWith({
      userId: ownerId,
      habitId,
      active: true,
    });
    expect(await service.deleteHabitLog(id, user)).toEqual({
      acknowledged: true,
      deletedCount: 1,
    });
    expect(logs.deleteOne).toHaveBeenCalledWith({
      userId: ownerId,
      habitId,
      date: anchor(day),
    });
  });

  it.each(['inactive', 'other owner', 'missing'])(
    'cannot complete %s',
    async (scenario) => {
      const stored =
        scenario === 'missing'
          ? []
          : [
              {
                userId: scenario === 'other owner' ? otherId : ownerId,
                habitId,
                active: scenario !== 'inactive',
              },
            ];
      association.findOne.mockImplementation(
        (filter: {
          userId: Types.ObjectId;
          habitId: Types.ObjectId;
          active: boolean;
        }) =>
          query(
            stored.find(
              (item) =>
                item.userId.equals(filter.userId) &&
                item.habitId.equals(filter.habitId) &&
                item.active === filter.active,
            ) ?? null,
          ),
      );
      await expect(service.complete(id, account())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('deactivation remains owner-scoped and idempotent', async () => {
    association.findOneAndUpdate.mockReturnValue(
      executableQuery({ habitId, active: false }),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await service.update(id, account())).toEqual({
        habitId,
        active: false,
      });
    }
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      { active: false },
      { returnDocument: 'after' },
    );
    association.findOneAndUpdate.mockReturnValue(executableQuery(null));
    await expect(service.update(id, account())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['America/Los_Angeles', '2025-04-01T00:30:00Z', '2025-03-01', '2025-03-31'],
    ['Asia/Tokyo', '2025-03-31T16:00:00Z', '2025-04-01', '2025-04-30'],
    ['America/New_York', '2024-03-10T07:30:00Z', '2024-03-01', '2024-03-31'],
    [undefined, '2024-02-15T12:00:00Z', '2024-02-01', '2024-02-29'],
  ])(
    'defaults history to inclusive local month in %s',
    async (zone, instant, start, end) => {
      jest.setSystemTime(new Date(instant));
      await service.getLogs(id, account(zone), {});
      expect(logs.find).toHaveBeenCalledWith({
        userId: ownerId,
        habitId,
        date: { $gte: anchor(start), $lte: anchor(end) },
      });
    },
  );

  it('keeps explicit bounds and historical anchors unchanged, including inactive history', async () => {
    const historical = [
      { userId: ownerId, habitId, date: anchor('2024-02-29'), completed: true },
    ];
    logs.find.mockReturnValue(executableQuery(historical));
    expect(
      await service.getLogs(id, account('America/Los_Angeles'), {
        startDate: '2024-02-29',
        endDate: '2024-02-29',
      }),
    ).toBe(historical);
    expect(logs.find).toHaveBeenCalledWith({
      userId: ownerId,
      habitId,
      date: { $gte: anchor('2024-02-29'), $lte: anchor('2024-02-29') },
    });
    expect(association.findOne).not.toHaveBeenCalled();
    await service.deleteHabitLog(id, account());
    expect(association.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['2025-02-29', '2025-03-01'],
    ['2024-04-31', '2024-05-01'],
    ['2025-13-01', '2025-12-31'],
    ['0000-01-01', '2025-04-01'],
    ['2025-4-01', '2025-04-30'],
    ['2025-04-01T00:00:00Z', '2025-04-30'],
    ['2025-04-01T23:00:00-07:00', '2025-04-30'],
    ['', '2025-04-30'],
    ['2025-04-30', '2025-04-01'],
    ['2025-04-01', 'not-a-date'],
  ])(
    'rejects invalid/reversed labels %s..%s before querying',
    async (startDate, endDate) => {
      await expect(
        service.getLogs(id, account(), { startDate, endDate }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(logs.find).not.toHaveBeenCalled();
    },
  );

  it('filters historical logs by authenticated owner, not just habit ID', async () => {
    const owned = {
      userId: ownerId,
      habitId,
      date: anchor('2025-04-01'),
      completed: true,
    };
    const foreign = { ...owned, userId: otherId };
    logs.find.mockImplementation(
      (filter: { userId: Types.ObjectId; habitId: Types.ObjectId }) =>
        executableQuery(
          [owned, foreign].filter(
            (item) =>
              item.userId.equals(filter.userId) &&
              item.habitId.equals(filter.habitId),
          ),
        ),
    );
    expect(await service.getLogs(id, account(), {})).toEqual([owned]);
  });

  it('defaults omitted endpoints independently and checks the resulting range', async () => {
    await service.getLogs(id, account(), { startDate: '2025-04-15' });
    expect(logs.find).toHaveBeenCalledWith({
      userId: ownerId,
      habitId,
      date: { $gte: anchor('2025-04-15'), $lte: anchor('2025-04-30') },
    });
    logs.find.mockClear();
    await expect(
      service.getLogs(id, account(), { endDate: '2025-03-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(logs.find).not.toHaveBeenCalled();
  });

  it('isolates all-log reads by owner and preserves the response shape/date', async () => {
    const historical = [
      {
        _id: otherId,
        habitId,
        title: 'Read',
        slug: 'read',
        date: anchor('2020-01-01'),
        completed: true,
      },
    ];
    logs.aggregate.mockResolvedValue(historical);
    expect(await service.getLogsByUser(account('Asia/Tokyo'))).toBe(historical);
    expect(logs.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        { $match: { userId: ownerId } },
        { $sort: { date: -1 } },
      ]),
    );
  });

  it.each(['2025-02-29', '2025-4-01', '2025-04-01T00:00:00Z', '0000-01-01'])(
    'DTO rejects non-calendar label %s',
    async (startDate) => {
      expect(
        await validate(Object.assign(new GetLogsDto(), { startDate })),
      ).not.toHaveLength(0);
    },
  );

  it('DTO accepts valid calendar labels and omitted endpoints', async () => {
    expect(
      await validate(
        Object.assign(new GetLogsDto(), {
          startDate: '2024-02-29',
          endDate: '2024-03-01',
        }),
      ),
    ).toHaveLength(0);
    expect(await validate(new GetLogsDto())).toHaveLength(0);
  });
});
