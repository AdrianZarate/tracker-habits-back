import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CommonService } from './common.service';

function responseFrom(action: () => never) {
  try {
    action();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return error.getResponse();
  }
}

describe('CommonService database error boundary', () => {
  const service = new CommonService();

  it('preserves the duplicate-key 400 response', () => {
    const duplicate = { code: 11000, keyValue: { slug: 'fixture' } };
    expect(() => service.handleExceptions(duplicate, 'Habit')).toThrow(
      BadRequestException,
    );
    expect(
      responseFrom(() => service.handleExceptions(duplicate, 'Habit')),
    ).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Habit exists in db {"slug":"fixture"}',
    });
  });

  it.each([
    undefined,
    null,
    'database failure',
    11000,
    {},
    new Error('private detail'),
    { code: '11000' },
  ])('normalizes unknown error %# to the generic 500 envelope', (error) => {
    expect(() => service.handleExceptions(error, 'Habit')).toThrow(
      InternalServerErrorException,
    );
    expect(
      responseFrom(() => service.handleExceptions(error, 'Habit')),
    ).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: "Can't create Habit - Check server logs",
    });
  });
});
