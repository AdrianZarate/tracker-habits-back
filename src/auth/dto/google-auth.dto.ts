import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({ description: 'ID Token obtenido del sign-in de Google' })
  @IsString()
  idToken: string;
}
