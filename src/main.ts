import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertProductionSecretsAreSet } from './config/env.validation';

async function bootstrap() {
  // Buffer Nest's bootstrap logs until the real pino logger
  // registered via LoggerModule takes over.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  assertProductionSecretsAreSet(
    config.get('nodeEnv')!,
    config.get('jwt.accessSecret')!,
    config.get('jwt.refreshSecret')!,
  );

  app.enableCors();

  app.setGlobalPrefix('api/v1', {
    // Email verification and password reset links are generated
    // without the /api/v1 prefix.
    exclude: ['verify-email', 'reset-password'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ryda API')
    .setDescription(
      'Ride-hailing, delivery, and fleet management platform backend. ' +
        'Most endpoints require a JWT bearer token — register or log in via ' +
        '/api/v1/auth, then use the returned accessToken.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
      },
      'partner-api-key',
    )
    .addTag('auth', 'Registration, login, OTP, refresh tokens')
    .addTag('rides', 'Fare estimation and the full ride lifecycle')
    .addTag('payments', 'Card-on-file, bank transfer, refunds, webhooks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document);

  // Render provides the PORT environment variable.
  // Bind to 0.0.0.0 so Render's external proxy can reach NestJS.
  const port = Number(process.env.PORT) || 3000;

  await app.listen(port, '0.0.0.0');

  console.log(`Ryda backend listening on 0.0.0.0:${port}`);
  console.log(`API: http://0.0.0.0:${port}/api/v1`);
  console.log(`API docs: http://0.0.0.0:${port}/api/docs`);
  console.log(`Metrics: http://0.0.0.0:${port}/api/v1/metrics`);
}

bootstrap();
