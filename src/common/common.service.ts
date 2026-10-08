import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

@Injectable()
export class CommonService {
  handleExceptions(error: unknown, tableDB: string): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      const keyValue = 'keyValue' in error ? error.keyValue : undefined;
      throw new BadRequestException(
        `${tableDB} exists in db ${JSON.stringify(keyValue)}`,
      );
    }
    throw new InternalServerErrorException(
      `Can't create ${tableDB} - Check server logs`,
    );
  }
}
