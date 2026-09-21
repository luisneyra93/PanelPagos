import { IsString, IsNotEmpty, MaxLength, IsOptional, ValidateIf, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'SERVIA', description: 'Nombre del proyecto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: 'https://api.miproyecto.com/webhooks/spei',
    description: 'URL para notificar acreditaciones SPEI (opcional)',
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
