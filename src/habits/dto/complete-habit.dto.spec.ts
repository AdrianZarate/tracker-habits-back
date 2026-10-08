import { ValidationPipe } from '@nestjs/common';
import { CompleteHabitDto } from './complete-habit.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const transform = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: CompleteHabitDto });

describe('CompleteHabitDto', () => {
  it.each([undefined, {}, { amount: 0 }, { amount: 0.5 }, { amount: 1e9 }])(
    'accepts omission or a finite replacement total %j',
    async (body) => {
      await expect(transform(body)).resolves.toEqual(body);
    },
  );

  it.each([
    ...[null, '1', false, NaN, Infinity, -Infinity, -1, 1e9 + 1].map(
      (amount) => ({ amount }),
    ),
    { completed: true },
    { configurationSnapshot: {} },
    { amount: 1, userId: 'owner' },
    { amount: 1, extra: true },
  ])('rejects invalid amounts and client authority %j', async (body) => {
    await expect(transform(body)).rejects.toThrow();
  });
});
