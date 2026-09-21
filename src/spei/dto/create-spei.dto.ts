import {
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  IsPositive,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SpeiPayerDto {
  @ApiProperty({ example: 'comprador@ejemplo.com' })
  @IsEmail()
  email: string;
}

export class CreateSpeiDto {
  @ApiProperty({ example: 150.5, description: 'Monto a cobrar vía SPEI (MXN)' })
  @IsNumber()
  @IsPositive()
  transaction_amount: number;

  @ApiProperty({ type: SpeiPayerDto })
  @ValidateNested()
  @Type(() => SpeiPayerDto)
  payer: SpeiPayerDto;

  @ApiPropertyOptional({
    example: 'MiProyecto',
    description:
      'Nombre del proyecto. Obligatorio si no se envía el header ApiKey. ' +
      'Si hay ApiKey, se ignora y se usa el Name del Project.',
  })
  @ValidateIf((o: CreateSpeiDto) => o.business_name != null && o.business_name !== '')
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  business_name?: string;

  @ApiPropertyOptional({ example: 'Pago de servicio' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'orden-123', description: 'ID de orden interno' })
  @IsOptional()
  @IsString()
  external_reference?: string;
}
