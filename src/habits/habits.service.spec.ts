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
import {
  ConfigurationRevision,
  HabitConfiguration,
} from './configuration/habit-configuration';

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
    findOne: jest.fn(),
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
    logs.findOne.mockReturnValue(query(null));
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
        expect.objectContaining({ $set: { active: true, title: 'Read' } }),
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
            configurationRevisions: 1,
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
            amount: 1,
            configurationSnapshot: 1,
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
      expect.objectContaining({
        $set: {
          active: true,
          title: 'Read',
          category: 'Learning',
          color: '#abcdef',
        },
        $unset: { icon: 1 },
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('appends a complete next-day revision atomically on an inactive owned row', async () => {
    const configuration = {
      schedule: { kind: 'weekdays' as const, days: [1, 7] },
      goal: { kind: 'quantity' as const, target: 20, unit: 'pages' },
    };
    association.findOneAndUpdate.mockReturnValue(
      executableQuery({ habitId, active: false }),
    );
    const dto = { configuration, title: undefined };
    await service.updateDefinition(id, dto, account('America/Los_Angeles'));
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      {
        $push: {
          configurationRevisions: {
            revisionId: expect.stringMatching(/^[a-f0-9]{24}$/) as unknown,
            effectiveFrom: '2025-04-01',
            configuration,
          },
        },
      },
      { returnDocument: 'after', runValidators: true },
    );
    expect(association.findOne).not.toHaveBeenCalled();
    expect(habit.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('initializes a default revision only on insertion when POST omits configuration', async () => {
    habit.findOneAndUpdate.mockResolvedValue({ _id: habitId });
    association.findOneAndUpdate.mockResolvedValue({
      toObject: () => ({ habitId }),
    });
    await service.create({ title: 'Read' }, account('America/Los_Angeles'));
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      {
        $set: { title: 'Read', active: true },
        $setOnInsert: {
          configurationRevisions: [
            {
              revisionId: expect.stringMatching(/^[a-f0-9]{24}$/) as unknown,
              effectiveFrom: '2025-03-31',
              configuration: {
                schedule: { kind: 'daily' },
                goal: { kind: 'checkbox' },
              },
            },
          ],
        },
      },
      expect.objectContaining({ upsert: true }),
    );
  });

  it.each([true, false])(
    'preserves every existing revision on repeated POST (versioned=%s)',
    async (versioned) => {
      const original: ConfigurationRevision = {
        revisionId: '000000000000000000000010',
        effectiveFrom: '2020-01-01',
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      };
      const owned = {
        userId: ownerId,
        habitId,
        active: false,
        title: 'Old',
        ...(versioned ? { configurationRevisions: [original] } : {}),
      };
      habit.findOneAndUpdate.mockResolvedValue({ _id: habitId });
      association.findOneAndUpdate.mockImplementation(
        (
          _filter: unknown,
          update: { $set: object; $push?: unknown; $setOnInsert: object },
        ) => {
          expect(update.$push).toBeUndefined();
          expect(update.$set).not.toHaveProperty('configurationRevisions');
          expect(update.$setOnInsert).toHaveProperty('configurationRevisions');
          Object.assign(owned, update.$set);
          return Promise.resolve({ toObject: () => owned });
        },
      );
      const configuration: HabitConfiguration = {
        schedule: { kind: 'weekly', timesPerWeek: 2 },
        goal: { kind: 'quantity', target: 2, unit: 'hours' },
      };
      const dto = { title: 'Read', configuration };
      for (let i = 0; i < 2; i++) {
        const result = await service.create(dto, account());
        expect(result).not.toHaveProperty('configurationRevisions');
        expect(result).toMatchObject({ title: 'Read', active: true });
        if (versioned)
          expect(result.configuration).toEqual(original.configuration);
        else expect(result).not.toHaveProperty('configuration');
      }
      if (versioned) expect(owned.configurationRevisions).toEqual([original]);
      else expect(owned).not.toHaveProperty('configurationRevisions');
    },
  );

  it('creates a supplied complete configuration today and captures the date before awaited writes', async () => {
    const configuration: HabitConfiguration = {
      schedule: { kind: 'weekly', timesPerWeek: 2 },
      goal: { kind: 'quantity', target: 1, unit: ' hours ' },
    };
    habit.findOneAndUpdate.mockImplementation(() => {
      jest.setSystemTime(new Date('2025-04-02T00:30:00Z'));
      return Promise.resolve({ _id: habitId });
    });
    association.findOneAndUpdate.mockImplementation(
      (
        _filter: unknown,
        update: {
          $setOnInsert: { configurationRevisions: ConfigurationRevision[] };
        },
      ) => {
        expect(update.$setOnInsert.configurationRevisions).toHaveLength(1);
        expect(update.$setOnInsert.configurationRevisions[0]).toMatchObject({
          effectiveFrom: '2025-04-01',
          configuration: {
            ...configuration,
            goal: { kind: 'quantity', target: 1, unit: 'hours' },
          },
        });
        return Promise.resolve({
          toObject: () => ({ habitId, ...update.$setOnInsert }),
        });
      },
    );
    const result = await service.create(
      { title: 'Read', configuration },
      account(),
    );
    expect(result.configuration?.goal).toMatchObject({ unit: 'hours' });
    expect(result).not.toHaveProperty('pendingConfiguration');
    expect(configuration.goal).toMatchObject({ unit: ' hours ' });
  });

  it('retains original goals and all same-day edits, with only the last pending winner exposed', async () => {
    const original: ConfigurationRevision = {
      revisionId: '000000000000000000000010',
      effectiveFrom: '2020-01-01',
      configuration: {
        schedule: { kind: 'daily' },
        goal: { kind: 'quantity', target: 10, unit: 'pages' },
      },
    };
    const revisions = [original];
    const foreign = { configurationRevisions: [original] };
    const owned = { habitId, active: false, configurationRevisions: revisions };
    association.findOneAndUpdate.mockImplementation(
      (
        filter: { userId: Types.ObjectId; habitId: Types.ObjectId },
        update: { $push: { configurationRevisions: ConfigurationRevision } },
      ) => {
        expect(filter).toEqual({ userId: ownerId, habitId });
        revisions.push(update.$push.configurationRevisions);
        return executableQuery(owned);
      },
    );
    for (const target of [20, 30]) {
      const result = await service.updateDefinition(
        id,
        {
          configuration: {
            schedule: { kind: 'weekdays', days: [6, 7] },
            goal: { kind: 'quantity', target, unit: 'pages' },
          },
        },
        account(),
      );
      expect(result.configuration).toEqual(original.configuration);
      expect(result.pendingConfiguration).toEqual(
        revisions[revisions.length - 1],
      );
      expect(result).not.toHaveProperty('configurationRevisions');
    }
    expect(revisions).toHaveLength(3);
    expect(revisions[1].revisionId).not.toBe(revisions[2].revisionId);
    expect(revisions[0]).toEqual(original);
    expect(foreign.configurationRevisions).toEqual([original]);
    expect(association.findOne).not.toHaveBeenCalled();
    association.findOne.mockReturnValue(query(owned));
    jest.setSystemTime(new Date('2025-04-02T00:30:00Z'));
    const detail = await service.findOneByUser(id, account());
    expect(detail.configuration?.goal).toMatchObject({ target: 30 });
    expect(detail).not.toHaveProperty('pendingConfiguration');
  });

  it('shares account-date resolution between owner list and inactive detail without exposing history', async () => {
    const revisions: ConfigurationRevision[] = [
      {
        revisionId: '000000000000000000000010',
        effectiveFrom: '2025-03-31',
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      },
      {
        revisionId: '000000000000000000000011',
        effectiveFrom: '2025-04-01',
        configuration: {
          schedule: { kind: 'weekly', timesPerWeek: 3 },
          goal: { kind: 'quantity', target: 20, unit: 'pages' },
        },
      },
    ];
    const row = {
      habitId,
      title: 'Read',
      slug: 'read',
      configurationRevisions: revisions,
    };
    association.aggregate.mockResolvedValue([
      row,
      { habitId, title: 'Legacy', slug: 'legacy' },
    ]);
    association.findOne.mockReturnValue(query({ ...row, active: false }));
    const [listed, legacy] = await service.findAllByUser(
      account('America/Los_Angeles'),
    );
    const detail = await service.findOneByUser(
      id,
      account('America/Los_Angeles'),
    );
    expect(listed).toEqual({
      habitId,
      title: 'Read',
      slug: 'read',
      configuration: revisions[0].configuration,
      pendingConfiguration: revisions[1],
    });
    expect(detail).toEqual({ ...listed, active: false });
    expect(legacy).toEqual({ habitId, title: 'Legacy', slug: 'legacy' });
    expect(row.configurationRevisions).toEqual(revisions);
  });

  it('metadata-only edits never append a revision on versioned rows', async () => {
    const revisions: ConfigurationRevision[] = [
      {
        revisionId: '000000000000000000000010',
        effectiveFrom: '2020-01-01',
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      },
    ];
    association.findOneAndUpdate.mockReturnValue(
      executableQuery({
        habitId,
        active: true,
        title: 'New',
        configurationRevisions: revisions,
      }),
    );
    const result = await service.updateDefinition(
      id,
      { title: 'New' },
      account(),
    );
    expect(result.configuration).toEqual(revisions[0].configuration);
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      { $set: { title: 'New' } },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('a foreign/missing configuration edit returns 404 without upsert or catalog mutation', async () => {
    association.findOneAndUpdate.mockReturnValue(executableQuery(null));
    await expect(
      service.updateDefinition(
        id,
        {
          configuration: {
            schedule: { kind: 'daily' },
            goal: { kind: 'checkbox' },
          },
        },
        account(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      expect.objectContaining({ $push: expect.any(Object) as unknown }),
      { returnDocument: 'after', runValidators: true },
    );
    expect(habit.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('current-day measured records', () => {
    const configuration: HabitConfiguration = {
      schedule: { kind: 'daily' },
      goal: { kind: 'quantity', target: 20, unit: 'pages' },
    };
    const snapshot: ConfigurationRevision = {
      revisionId: '000000000000000000000010',
      effectiveFrom: '2020-01-01',
      configuration,
    };
    let stored: Record<string, unknown> | null;
    const write = (body: unknown = {}) =>
      service.complete(id, account(), body as { amount?: number });
    const configure = (revision = snapshot) =>
      association.findOne.mockReturnValue(
        query({ active: true, habitId, configurationRevisions: [revision] }),
      );

    beforeEach(() => {
      stored = null;
      configure();
      logs.findOne.mockImplementation(() => query(stored));
      logs.findOneAndUpdate.mockImplementation(
        (filter: object, update: { $setOnInsert?: object; $set?: object }) => {
          if (!stored)
            stored = { _id: otherId, ...filter, ...update.$setOnInsert };
          Object.assign(stored, update.$set);
          return executableQuery({ ...stored });
        },
      );
    });

    it('replaces daily totals including zero and preserves the first full snapshot', async () => {
      for (const [amount, completed] of [
        [10, false],
        [20, true],
        [25, true],
        [0, false],
      ]) {
        expect(await write({ amount })).toMatchObject({
          amount,
          completed,
          configurationSnapshot: snapshot,
        });
      }
      expect(stored!.amount).toBe(0);
      expect(logs.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: ownerId, habitId, date: anchor('2025-04-01') },
        {
          $setOnInsert: {
            configurationSnapshot: snapshot,
            amount: 10,
            completed: false,
          },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      );
    });

    it.each([false, true])(
      'rejects bodyless quantity without changing records (existing=%s)',
      async (existing) => {
        if (existing)
          stored = {
            _id: otherId,
            amount: 10,
            completed: false,
            configurationSnapshot: snapshot,
          };
        await expect(write()).rejects.toBeInstanceOf(BadRequestException);
        expect(stored?.amount).toBe(existing ? 10 : undefined);
        expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([null, '2', NaN, Infinity, -Infinity, -1, 1e9 + 1])(
      'rejects invalid amount %s before writes',
      async (amount) => {
        await expect(write({ amount })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([
      null,
      [],
      '20',
      { completed: true },
      { configurationSnapshot: snapshot },
      { amount: 20, extra: true },
    ])('rejects client authority/unknown fields %j', async (body) => {
      await expect(write(body)).rejects.toBeInstanceOf(BadRequestException);
      expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('uses the stored original goal even when the association differs', async () => {
      stored = {
        _id: otherId,
        configurationSnapshot: snapshot,
        amount: 10,
        completed: false,
      };
      association.findOne.mockReturnValue(query({ active: true, habitId }));
      expect(await write({ amount: 15 })).toMatchObject({
        amount: 15,
        completed: false,
        configurationSnapshot: snapshot,
      });
      expect(logs.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ownerId, habitId, _id: otherId }),
        { $set: { amount: 15, completed: false } },
        { returnDocument: 'after', runValidators: true },
      );
    });

    it('uses an existing checkbox snapshot instead of the current quantity goal', async () => {
      const original = {
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      };
      stored = {
        _id: otherId,
        configurationSnapshot: original,
        completed: true,
      };
      await expect(write({ amount: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
      expect(await write()).toMatchObject({
        configurationSnapshot: original,
        completed: true,
      });
      expect(stored).not.toHaveProperty('amount');
    });

    it('does not backfill legacy booleans with snapshots or amounts', async () => {
      stored = { _id: otherId, completed: true };
      association.findOne.mockReturnValue(query({ active: true, habitId }));
      expect(await write()).toEqual({ _id: otherId, completed: true });
      expect(stored).not.toHaveProperty('amount');
      expect(stored).not.toHaveProperty('configurationSnapshot');
      await expect(write({ amount: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('only adds an explicit amount to snapshotless quantity records', async () => {
      stored = { _id: otherId, completed: true };
      await expect(write()).rejects.toBeInstanceOf(BadRequestException);
      expect(stored).not.toHaveProperty('amount');
      expect(await write({ amount: 0 })).toEqual({
        _id: otherId,
        amount: 0,
        completed: false,
      });
      expect(stored).not.toHaveProperty('configurationSnapshot');
    });

    it('blocks only new nonselected weekday records', async () => {
      configure({
        ...snapshot,
        configuration: {
          ...configuration,
          schedule: { kind: 'weekdays', days: [1] },
        },
      });
      await expect(write({ amount: 20 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(logs.findOneAndUpdate).not.toHaveBeenCalled();
      stored = { _id: otherId, completed: false };
      expect(await write({ amount: 20 })).toMatchObject({
        amount: 20,
        completed: true,
      });
      expect(logs.deleteOne).not.toHaveBeenCalled();
    });

    it.each([
      { kind: 'weekdays' as const, days: [7] },
      { kind: 'weekly' as const, timesPerWeek: 3 },
    ])(
      'allows a selected local Sunday or any weekly day %j',
      async (schedule) => {
        jest.setSystemTime(new Date('2025-04-07T00:30:00Z'));
        configure({
          ...snapshot,
          configuration: { ...configuration, schedule },
        });
        const result = await service.complete(
          id,
          account('America/Los_Angeles'),
          { amount: 0.5 },
        );
        expect(result).toMatchObject({
          date: anchor('2025-04-06'),
          amount: 0.5,
          completed: false,
        });
      },
    );

    it('captures today before awaited reads, ignoring a next-day pending goal', async () => {
      association.findOne.mockImplementation(() => {
        jest.setSystemTime(new Date('2025-04-02T00:30:00Z'));
        return query({
          active: true,
          habitId,
          configurationRevisions: [
            snapshot,
            {
              ...snapshot,
              effectiveFrom: '2025-04-02',
              configuration: {
                ...configuration,
                goal: { kind: 'quantity', target: 5, unit: 'pages' },
              },
            },
          ],
        });
      });
      expect(await write({ amount: 10 })).toMatchObject({
        date: anchor('2025-04-01'),
        completed: false,
        configurationSnapshot: snapshot,
      });
    });

    it.each([false, true])(
      'evaluates the concurrent insert winner, including duplicate-key retry=%s',
      async (duplicate) => {
        const winner = {
          ...snapshot,
          configuration: {
            ...configuration,
            goal: { kind: 'quantity', target: 50, unit: 'pages' },
          },
        };
        logs.findOneAndUpdate.mockImplementationOnce(() => {
          stored = {
            _id: otherId,
            amount: 1,
            completed: false,
            configurationSnapshot: winner,
          };
          const error = Object.assign(new Error('duplicate key'), {
            code: 11000,
          });
          return duplicate
            ? { lean: () => ({ exec: () => Promise.reject(error) }) }
            : executableQuery({ ...stored });
        });
        expect(await write({ amount: 20 })).toMatchObject({
          amount: 20,
          completed: false,
          configurationSnapshot: winner,
        });
        expect(logs.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(logs.findOneAndUpdate).toHaveBeenLastCalledWith(
          expect.objectContaining({ _id: otherId }),
          { $set: { amount: 20, completed: false } },
          { returnDocument: 'after', runValidators: true },
        );
      },
    );

    it('does not change a concurrent checkbox winner when amount is invalid for its goal', async () => {
      const original = {
        configuration: {
          schedule: { kind: 'daily' },
          goal: { kind: 'checkbox' },
        },
      };
      logs.findOneAndUpdate.mockImplementationOnce(() => {
        stored = {
          _id: otherId,
          completed: true,
          configurationSnapshot: original,
        };
        return executableQuery({ ...stored });
      });
      await expect(write({ amount: 10 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(logs.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(stored).toEqual({
        _id: otherId,
        completed: true,
        configurationSnapshot: original,
      });
    });

    it('propagates duplicate-key failure if no winner can be read', async () => {
      const error = Object.assign(new Error('duplicate key'), { code: 11000 });
      logs.findOneAndUpdate.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.reject(error) }),
      });
      await expect(write({ amount: 1 })).rejects.toBe(error);
      expect(logs.findOne).toHaveBeenCalledTimes(2);
      expect(logs.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('propagates non-duplicate database failures without retrying', async () => {
      const error = new Error('synthetic database failure');
      logs.findOneAndUpdate.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.reject(error) }),
      });
      await expect(write({ amount: 1 })).rejects.toBe(error);
      expect(logs.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
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
    expect(logs.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId, date: anchor(day) },
      {
        $setOnInsert: {
          completed: true,
          configurationSnapshot: {
            configuration: {
              schedule: { kind: 'daily' },
              goal: { kind: 'checkbox' },
            },
          },
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    expect(logs.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId, date: anchor(day), _id: undefined },
      { $set: { completed: true } },
      { returnDocument: 'after', runValidators: true },
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

  it('does not leak the new raw revision array through the legacy deactivation response', async () => {
    const configuration: HabitConfiguration = {
      schedule: { kind: 'daily' },
      goal: { kind: 'checkbox' },
    };
    association.findOneAndUpdate.mockReturnValue(
      executableQuery({
        habitId,
        active: false,
        configurationRevisions: [
          {
            revisionId: '000000000000000000000010',
            effectiveFrom: '2020-01-01',
            configuration,
          },
        ],
      }),
    );
    expect(await service.update(id, account())).toEqual({
      habitId,
      active: false,
      configuration,
    });
    expect(association.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: ownerId, habitId },
      { active: false },
      { returnDocument: 'after' },
    );
  });

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
