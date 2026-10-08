import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // configuración global de pipes para validación de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: [
      'https://tracker-habits.alexadrian.dev',
      'https://dynamic-nasturtium-c7a358.netlify.app',
      'http://localhost:5173',
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  //* Swagger
  const config = new DocumentBuilder()
    .setTitle('Habit Tracker RESTFull API')
    .setDescription('API para el seguimiento de hábitos')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Ingresa tu JWT token',
        in: 'header',
      },
      'JWT-auth', // Este es el nombre del esquema de seguridad
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`App running on port ${port}`);
}
bootstrap().catch(() => {
  // Do not log startup configuration values, which may contain credentials.
  new Logger('Bootstrap').error('Application startup failed');
  process.exitCode = 1;
});
