import { IsDateString, IsOptional } from 'class-validator';

export class GetLogsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
