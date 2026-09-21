import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'SERVIA', description: 'Nombre del proyecto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
