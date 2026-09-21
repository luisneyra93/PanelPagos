import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIn, IsInt, ValidateIf, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'SERVIA' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 1, description: '1 = activo, 0 = inactivo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  estatus?: number;

  @ApiPropertyOptional({
    example: 'https://api.miproyecto.com/webhooks/spei',
    description: 'URL para notificar acreditaciones. Cadena vacía para limpiar.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @Matches(/^https?:\/\/.+/i, {
    message: 'webhook_url debe ser una URL http(s) válida',
  })
  webhook_url?: string;
}
