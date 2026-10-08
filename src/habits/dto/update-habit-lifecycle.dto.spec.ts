import { ValidationPipe } from '@nestjs/common';
import { model, Types } from 'mongoose';
import {
  HabitUser,
  HabitUserSchema,
  HABIT_STATUSES,
} from '../entities/habit-user.entity';
import { UpdateHabitLifecycleDto } from './update-habit-lifecycle.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const parse = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpdateHabitLifecycleDto });
const Association = model<HabitUser>('LifecycleSchemaFixture', HabitUserSchema);
const keys = { userId: new Types.ObjectId(), habitId: new Types.ObjectId() };

describe('Lifecycle DTO and optional schema', () => {
  it.each(HABIT_STATUSES)('accepts %s in DTO and schema', async (status) => {
    expect(await parse({ status })).toEqual({ status });
    expect(new Association({ ...keys, status }).validateSync()).toBeUndefined();
  });
  it.each([undefined, null, '', 'deleted', true, 1, [], {}])(
    'rejects status %j',
    async (status) => {
      await expect(parse({ status })).rejects.toThrow();
    },
  );
  it('requires status and rejects extra authority', async () => {
    await expect(parse({})).rejects.toThrow();
    await expect(parse({ status: 'paused', active: false })).rejects.toThrow();
    expect(
      new Association({ ...keys, status: 'deleted' }).validateSync(),
    ).toBeDefined();
  });
  it.each([true, false])(
    'never defaults/backfills status on legacy active=%s',
    (active) => {
      const row = new Association({ ...keys, active });
      expect(row.status).toBeUndefined();
      expect(row.active).toBe(active);
      expect(row.validateSync()).toBeUndefined();
    },
  );
});
