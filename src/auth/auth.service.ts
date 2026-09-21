import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly loginUrl: string;

  constructor(private readonly config: ConfigService) {
    this.loginUrl =
      this.config.get<string>('LOGIN_API_URL') ??
      'https://springtelecom.mx/nextAPI/api/login';
  }

  async login(dto: LoginDto) {
    let res: Response;
    try {
      res = await fetch(this.loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          userName: dto.userName,
          password: dto.password,
        }),
      });
    } catch {
      throw new HttpException('No se pudo conectar con el servicio de autenticación', 502);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text || 'Respuesta inválida del servidor de login' };
    }

    if (!res.ok) {
      const payload = (data ?? {}) as Record<string, unknown>;
      const message =
        (Array.isArray(payload.message) ? payload.message.join(', ') : payload.message) ||
        payload.error ||
        `Error de autenticación (${res.status})`;
      throw new HttpException(
        { message, ...(typeof payload === 'object' && payload ? payload : {}) },
        res.status,
      );
    }

    return data;
  }
}
