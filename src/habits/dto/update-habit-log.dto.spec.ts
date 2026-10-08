import { ValidationPipe } from '@nestjs/common';
import { UpdateHabitLogDto } from './update-habit-log.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const transform = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpdateHabitLogDto });

describe('UpdateHabitLogDto', () => {
  it.each([
    { amount: 0 },
    { amount: 0.5 },
    { amount: 1e9 },
    { completed: true },
    { completed: false },
    { note: '' },
    { note: 'x'.repeat(2000) },
    { amount: 2, note: 'Context' },
    { completed: false, note: 'Context' },
  ])('accepts explicit supported fields %j', async (body) => {
    await expect(transform(body)).resolves.toEqual(body);
  });

  it('trims before checking length, including empty note clearing', async () => {
    await expect(transform({ note: '  Context  ' })).resolves.toEqual({
      note: 'Context',
    });
    await expect(transform({ note: '  ' })).resolves.toEqual({ note: '' });
    await expect(transform({ note: ` ${'x'.repeat(2000)} ` })).resolves.toEqual(
      {
        note: 'x'.repeat(2000),
      },
    );
  });

  it.each([
    undefined,
    null,
    [],
    'bad',
    {},
    ...[null, '1', false, NaN, Infinity, -Infinity, -1, 1e9 + 1].map(
      (amount) => ({ amount }),
    ),
    ...[null, 'false', 0, [], {}].map((completed) => ({ completed })),
    ...[null, 4, false, [], {}, 'x'.repeat(2001)].map((note) => ({ note })),
    { note: 'Context', extra: true },
    { configurationSnapshot: {} },
    { userId: 'other' },
  ])('rejects empty, malformed or unknown payload %j', async (body) => {
    await expect(transform(body)).rejects.toThrow();
  });
});
