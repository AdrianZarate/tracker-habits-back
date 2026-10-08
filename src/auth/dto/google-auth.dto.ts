import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({ description: 'ID Token obtenido del sign-in de Google' })
  @IsString()
  idToken: string;

  @ApiPropertyOptional({ description: 'Zona IANA detectada por el navegador' })
  @IsOptional()
  @IsString()
  timeZone?: string;
}
