import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertProductionSecretsAreSet } from './config/env.validation';

async function bootstrap() {
  // bufferLogs holds Nest's own bootstrap logs until the real pino logger
  // (registered via LoggerModule, DI-resolved below) takes over — without
  // this, Nest's default console logger prints the first few lines before
  // structured logging kicks in.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  assertProductionSecretsAreSet(
    config.get<string>('nodeEnv')!,
    config.get<string>('jwt.accessSecret')!,
    config.get<string>('jwt.refreshSecret')!,
  );

  app.enableCors();
  app.setGlobalPrefix('api/v1', {
    // The email-verification and password-reset links sent by
    // AuthService already point at ${appBaseUrl}/verify-email and
    // ${appBaseUrl}/reset-password with no /api/v1 prefix — excluding
    // these here matches what's already being generated, rather than
    // changing already-tested email-sending code to match a prefix.
    exclude: ['verify-email', 'reset-password'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  // HttpExceptionFilter is registered via APP_FILTER in ObservabilityModule
  // now (it needs SentryService injected via DI, which a manually
  // constructed `new HttpExceptionFilter()` here couldn't provide).

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ryda API')
    .setDescription(
      'Ride-hailing, delivery, and fleet management platform backend. ' +
        'Most endpoints require a JWT bearer token — register or log in via ' +
        '/api/v1/auth, then use the returned accessToken.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'partner-api-key')
    .addTag('auth', 'Registration, login, OTP, refresh tokens')
    .addTag('rides', 'Fare estimation and the full ride lifecycle')
    .addTag('payments', 'Card-on-file, bank transfer, refunds, webhooks')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Ryda backend running on http://localhost:${port}/api/v1`);
  console.log(`API docs at http://localhost:${port}/api/docs`);
  console.log(`Metrics at http://localhost:${port}/api/v1/metrics`);
}
bootstrap();
