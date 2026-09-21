import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Dashboard estático en http://localhost:PORT/
  app.useStaticAssets(join(__dirname, '..', 'public'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();
  app.setGlobalPrefix('api');

  const port = process.env.APP_PORT ?? 3005;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Pagos SPEI API')
    .setDescription('Generación de CLABEs SPEI (Mercado Pago Orders API) + webhook + dashboard')
    .setVersion('1.0')
    .addServer(`http://localhost:${port}/api`, 'Local')
    .addTag('spei', 'Generación de SPEI, webhook y consultas del dashboard')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    ignoreGlobalPrefix: true,
  });
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  console.log(`🚀 API      → http://localhost:${port}/api`);
  console.log(`📊 Dashboard → http://localhost:${port}/`);
  console.log(`📄 Swagger   → http://localhost:${port}/api/docs`);
}
bootstrap();
