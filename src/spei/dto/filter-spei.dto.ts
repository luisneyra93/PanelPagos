import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsNotEmpty, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FilterSpeiDto {
  @ApiProperty({ description: 'Fecha inicial (YYYY-MM-DD)', example: '2026-08-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from debe ser YYYY-MM-DD' })
  from: string;

  @ApiProperty({ description: 'Fecha final inclusiva (YYYY-MM-DD)', example: '2026-08-31' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to debe ser YYYY-MM-DD' })
  to: string;

  @ApiPropertyOptional({
    description: 'Estado agrupado del SPEI',
    enum: ['pending', 'accredited', 'failed'],
  })
  @IsOptional()
  @IsIn(['pending', 'accredited', 'failed'])
  status?: 'pending' | 'accredited' | 'failed';

  @ApiPropertyOptional({ default: 1, description: 'Página (desde 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 200, description: 'Registros por página' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
