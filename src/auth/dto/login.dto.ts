import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'root@next.mx' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  userName: string;

  @ApiProperty({ example: '••••••••' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  password: string;
}
