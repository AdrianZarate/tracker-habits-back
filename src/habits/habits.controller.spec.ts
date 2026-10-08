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
    update: jest.fn(),
    updateDefinition: jest.fn(),
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
