import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpeiModule } from './spei/spei.module';
import { ProjectsModule } from './projects/projects.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host:     config.get<string>('DB_HOST'),
        port:     Number(config.get<string>('DB_PORT') ?? 3306),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        // BD compartida con mercadopago-nest: nunca sincronizar el esquema.
        // Las tablas propias se crean en ensureSchema() de cada servicio.
        synchronize: false,
        logging:  config.get<string>('DB_LOGGING') === 'true',
        timezone: config.get<string>('DB_TIMEZONE') ?? '-06:00',
        extra: {
          connectionLimit:    5,
          connectTimeout:     60000,
          waitForConnections: true,
        },
        keepConnectionAlive: true,
        retryAttempts:       5,
        retryDelay:          3000,
      }),
    }),

    AuthModule,
    SpeiModule,
    ProjectsModule,
  ],
})
export class AppModule {}