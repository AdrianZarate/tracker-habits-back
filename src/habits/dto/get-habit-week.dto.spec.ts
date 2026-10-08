import { ValidationPipe } from '@nestjs/common';
import { GetHabitWeekDto } from './get-habit-week.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const parse = (value: unknown) =>
  pipe.transform(value, {
    type: 'query',
    metatype: GetHabitWeekDto,
  });

describe('Weekly query DTO', () => {
  it.each([
    {},
    { date: '2024-02-29' },
    { date: '0001-01-01' },
    { date: '9999-12-26' },
  ])('accepts omitted or real date %j', async (value) => {
    expect(await parse(value)).toEqual(value);
  });
  it.each([
    null,
    4,
    true,
    {},
    [],
    ['2025-03-31'],
    '',
    '2025-02-29',
    '0000-01-01',
    '10000-01-01',
    '9999-12-31',
    '2025-3-31',
    '2025-03-31T00:00:00Z',
  ])('rejects date %j instead of defaulting/coercing it', async (date) => {
    await expect(parse({ date })).rejects.toThrow();
  });
  it('rejects unsupported query keys', async () => {
    await expect(parse({ timeZone: 'UTC' })).rejects.toThrow();
  });
});
