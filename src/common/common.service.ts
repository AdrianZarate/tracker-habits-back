import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

@Injectable()
export class CommonService {
  handleExceptions(error: any, tableDB: string) {
    if (error.code === 11000) {
      throw new BadRequestException(
        `${tableDB} exists in db ${JSON.stringify(error.keyValue)}`,
      );
    }
    throw new InternalServerErrorException(
      `Can't create ${tableDB} - Check server logs`,
    );
  }
}
