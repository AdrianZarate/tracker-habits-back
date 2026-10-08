import { ValidationPipe } from '@nestjs/common';
import { GetHabitsDto } from './get-habits.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const parse = (query: unknown) =>
  pipe.transform(query, { type: 'query', metatype: GetHabitsDto });

describe('Habit list status query', () => {
  it.each([
    {},
    { status: 'active' },
    { status: 'paused' },
    { status: 'archived' },
    { status: 'all' },
  ])('accepts %j', async (query) => {
    expect(await parse(query)).toEqual(query);
  });
  it.each([null, '', 'deleted', true, 1, [], ['active', 'paused'], {}])(
    'rejects status %j',
    async (status) => {
      await expect(parse({ status })).rejects.toThrow();
    },
  );
  it('rejects unknown query keys', async () => {
    await expect(parse({ active: true })).rejects.toThrow();
  });
});
