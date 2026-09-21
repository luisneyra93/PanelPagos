import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QuerySpeiDto {
  @ApiPropertyOptional({
    description: 'Filtra por estado agrupado del dashboard',
    enum: ['all', 'pending', 'accredited', 'failed'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'pending', 'accredited', 'failed'])
  status?: 'all' | 'pending' | 'accredited' | 'failed';

  @ApiPropertyOptional({
    description: 'Busca en BusinessName, OrderId, PaymentId, ExternalReference, Referencia, CLABE y email',
    example: 'MiEmpresa',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Fecha inicial (YYYY-MM-DD)', example: '2026-07-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha final inclusiva (YYYY-MM-DD)', example: '2026-07-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
