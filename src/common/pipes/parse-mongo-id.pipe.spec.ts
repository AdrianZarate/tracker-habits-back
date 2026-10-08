import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ParseMongoIdPipe } from './parse-mongo-id.pipe';

describe('ParseMongoIdPipe', () => {
  const pipe: PipeTransform<string, string> = new ParseMongoIdPipe();

  it.each(['000000000000000000000001', 'ABCDEFabcdef012345678901'])(
    'returns valid ID %s unchanged',
    (id) => {
      expect(pipe.transform(id, { type: 'param' })).toBe(id);
    },
  );

  it.each([
    '',
    'not-an-id',
    '00000000000000000000000',
    '00000000000000000000000g',
  ])('rejects invalid ID %s', (id) => {
    expect(() => pipe.transform(id, { type: 'param' })).toThrow(
      new BadRequestException(`The id ${id} is not a valid MongoDB ObjectId`),
    );
  });
});
