import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { model, Types } from 'mongoose';
import { User, UserSchema } from '../auth/entities/user.entity';
import { ParseMongoIdPipe } from '../common/pipes/parse-mongo-id.pipe';
import { CreateHabitDto } from './dto/create-habit.dto';
import { CompleteHabitDto } from './dto/complete-habit.dto';
import { GetHabitWeekDto } from './dto/get-habit-week.dto';
import { GetHabitsDto } from './dto/get-habits.dto';
import { UpdateHabitLifecycleDto } from './dto/update-habit-lifecycle.dto';
import { UpdateHabitLogDto } from './dto/update-habit-log.dto';
import { UpdateHabitUserDto } from './dto/update-habit-user.dto';
import { HabitsController } from './habits.controller';
import { HabitsService } from './habits.service';

// Forward real exports for the repository's src aliases; no HTTP listener or DB.
jest.mock(
  'src/auth/decorators',
  () =>
    jest.requireActual<typeof import('../auth/decorators')>(
      '../auth/decorators',
    ),
  { virtual: true },
);
jest.mock(
  'src/auth/entities/user.entity',
  () =>
    jest.requireActual<typeof import('../auth/entities/user.entity')>(
      '../auth/entities/user.entity',
    ),
  { virtual: true },
);
jest.mock(
  'src/common/pipes/parse-mongo-id.pipe',
  () =>
    jest.requireActual<typeof import('../common/pipes/parse-mongo-id.pipe')>(
      '../common/pipes/parse-mongo-id.pipe',
    ),
  { virtual: true },
);

const FixtureUser = model<User>('PersonalControllerFixtureUser', UserSchema);
const user = new FixtureUser({ _id: new Types.ObjectId() });
const habitId = new Types.ObjectId().toHexString();

describe('Personal definition controller plumbing', () => {
  const service = {
    create: jest.fn(),
    complete: jest.fn(),
    updateLog: jest.fn(),
    getWeek: jest.fn(),
    update: jest.fn(),
    updateDefinition: jest.fn(),
    updateLifecycle: jest.fn(),
    findAllByUser: jest.fn(),
  };
  const controller = new HabitsController(service as unknown as HabitsService);
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  beforeEach(() => jest.clearAllMocks());

  it('keeps authentication and exposes a dedicated PATCH with the concrete DTO', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HabitsController) as unknown[],
    ).not.toHaveLength(0);
    const handler = Object.getOwnPropertyDescriptor(
      HabitsController.prototype,
      'updateDefinition',
    )!.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':habitId/definition',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'updateDefinition',
      ),
    ).toEqual([String, UpdateHabitUserDto, User]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      HabitsController,
      'updateDefinition',
    ) as Record<string, { index: number; data?: string; pipes: unknown[] }>;
    expect(Object.values(args)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          data: 'habitId',
          pipes: [ParseMongoIdPipe],
        }),
        expect.objectContaining({ index: 1 }),
        expect.objectContaining({ index: 2 }),
      ]),
    );
  });

  it('forwards validated trimmed edits and the authenticated user', async () => {
    const dto = (await pipe.transform(
      { title: '  Personal read  ', category: '  ' },
      { type: 'body', metatype: UpdateHabitUserDto },
    )) as UpdateHabitUserDto;
    const response = { habitId, title: 'Personal read', active: false };
    service.updateDefinition.mockResolvedValue(response);
    expect(
      await controller.updateDefinition(
        new ParseMongoIdPipe().transform(habitId),
        dto,
        user,
      ),
    ).toBe(response);
    expect(service.updateDefinition).toHaveBeenCalledWith(
      habitId,
      { title: 'Personal read', category: '' },
      user,
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('forwards a complete configuration edit without interpreting it as a log mutation', async () => {
    const configuration = {
      schedule: { kind: 'weekly', timesPerWeek: 3 },
      goal: { kind: 'quantity', target: 20, unit: ' pages ' },
    };
    const dto = (await pipe.transform(
      { configuration },
      { type: 'body', metatype: UpdateHabitUserDto },
    )) as UpdateHabitUserDto;
    await controller.updateDefinition(habitId, dto, user);
    expect(service.updateDefinition).toHaveBeenCalledWith(
      habitId,
      {
        configuration: {
          ...configuration,
          goal: { ...configuration.goal, unit: 'pages' },
        },
      },
      user,
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('rejects partial configurations at the controller validation boundary', async () => {
    await expect(
      pipe.transform(
        { configuration: { goal: { kind: 'checkbox' } } },
        { type: 'body', metatype: UpdateHabitUserDto },
      ),
    ).rejects.toThrow();
    expect(service.updateDefinition).not.toHaveBeenCalled();
  });

  it('uses the completion DTO and forwards only validated daily progress', async () => {
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'complete',
      ),
    ).toEqual([String, CompleteHabitDto, User]);
    const dto = (await pipe.transform(
      { amount: 0 },
      { type: 'body', metatype: CompleteHabitDto },
    )) as CompleteHabitDto;
    await controller.complete(habitId, dto, user);
    expect(service.complete).toHaveBeenCalledWith(habitId, user, { amount: 0 });
  });

  it('forwards bodyless completion and rejects client-supplied completion authority', async () => {
    const dto = (await pipe.transform(undefined, {
      type: 'body',
      metatype: CompleteHabitDto,
    })) as CompleteHabitDto;
    await controller.complete(habitId, dto, user);
    expect(service.complete).toHaveBeenCalledWith(habitId, user, undefined);
    await expect(
      pipe.transform(
        { completed: true },
        { type: 'body', metatype: CompleteHabitDto },
      ),
    ).rejects.toThrow();
  });

  it('exposes the owner-authenticated correction PATCH with date, Mongo-ID pipe and concrete DTO', async () => {
    const handler = Object.getOwnPropertyDescriptor(
      HabitsController.prototype,
      'updateLog',
    )!.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':habitId/logs/:date',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'updateLog',
      ),
    ).toEqual([String, String, UpdateHabitLogDto, User]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      HabitsController,
      'updateLog',
    ) as Record<string, { index: number; data?: string; pipes: unknown[] }>;
    expect(Object.values(args)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          data: 'habitId',
          pipes: [ParseMongoIdPipe],
        }),
        expect.objectContaining({ index: 1, data: 'date' }),
        expect.objectContaining({ index: 2 }),
        expect.objectContaining({ index: 3 }),
      ]),
    );
    const dto = (await pipe.transform(
      { completed: false, note: '  Past  ' },
      { type: 'body', metatype: UpdateHabitLogDto },
    )) as UpdateHabitLogDto;
    await controller.updateLog(habitId, '2024-02-29', dto, user);
    expect(service.updateLog).toHaveBeenCalledWith(
      habitId,
      '2024-02-29',
      { completed: false, note: 'Past' },
      user,
    );
    expect(service.complete).not.toHaveBeenCalled();
  });

  it('exposes GET week with concrete query DTO, Mongo-ID pipe and authenticated forwarding', async () => {
    const handler = Object.getOwnPropertyDescriptor(
      HabitsController.prototype,
      'getWeek',
    )!.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':habitId/week');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'getWeek',
      ),
    ).toEqual([String, GetHabitWeekDto, User]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      HabitsController,
      'getWeek',
    ) as Record<string, { index: number; data?: string; pipes: unknown[] }>;
    expect(Object.values(args)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          data: 'habitId',
          pipes: [ParseMongoIdPipe],
        }),
        expect.objectContaining({ index: 1 }),
        expect.objectContaining({ index: 2 }),
      ]),
    );
    const dto = (await pipe.transform(
      { date: '2024-02-29' },
      { type: 'query', metatype: GetHabitWeekDto },
    )) as GetHabitWeekDto;
    const response = { date: dto.date, days: [] };
    service.getWeek.mockResolvedValue(response);
    expect(await controller.getWeek(habitId, dto, user)).toBe(response);
    expect(service.getWeek).toHaveBeenCalledWith(habitId, user, {
      date: '2024-02-29',
    });
    await controller.getWeek(habitId, {}, user);
    expect(service.getWeek).toHaveBeenLastCalledWith(habitId, user, {});
  });

  it('declares dedicated authenticated lifecycle PATCH with concrete DTO and Mongo-ID pipe', async () => {
    const handler = Object.getOwnPropertyDescriptor(
      HabitsController.prototype,
      'updateLifecycle',
    )!.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':habitId/lifecycle',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'updateLifecycle',
      ),
    ).toEqual([String, UpdateHabitLifecycleDto, User]);
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      HabitsController,
      'updateLifecycle',
    ) as Record<string, { index: number; pipes: unknown[] }>;
    expect(Object.values(args)).toContainEqual(
      expect.objectContaining({ index: 0, pipes: [ParseMongoIdPipe] }),
    );
    await controller.updateLifecycle(habitId, { status: 'archived' }, user);
    expect(service.updateLifecycle).toHaveBeenCalledWith(
      habitId,
      { status: 'archived' },
      user,
    );
    expect(service.update).not.toHaveBeenCalled();
  });

  it('forwards status list query with authenticated ownership and a concrete DTO', async () => {
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        HabitsController.prototype,
        'findAll',
      ),
    ).toEqual([User, GetHabitsDto]);
    await controller.findAll(user, { status: 'all' });
    expect(service.findAllByUser).toHaveBeenCalledWith(user, { status: 'all' });
  });

  it('keeps the original empty PATCH as deactivation', async () => {
    const handler = Object.getOwnPropertyDescriptor(
      HabitsController.prototype,
      'update',
    )!.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':habitId');
    await controller.update(habitId, user);
    expect(service.update).toHaveBeenCalledWith(habitId, user);
    expect(service.updateDefinition).not.toHaveBeenCalled();
  });

  it('forwards trimmed creation metadata', async () => {
    const dto = (await pipe.transform(
      { title: ' Read ', icon: ' book ' },
      { type: 'body', metatype: CreateHabitDto },
    )) as CreateHabitDto;
    await controller.create(dto, user);
    expect(service.create).toHaveBeenCalledWith(
      { title: 'Read', icon: 'book' },
      user,
    );
  });

  it('rejects malformed identity and invalid payloads before invoking the service', async () => {
    expect(() => new ParseMongoIdPipe().transform('bad')).toThrow();
    await expect(
      pipe.transform(
        { title: null },
        { type: 'body', metatype: UpdateHabitUserDto },
      ),
    ).rejects.toThrow();
    expect(service.updateDefinition).not.toHaveBeenCalled();
  });
});
