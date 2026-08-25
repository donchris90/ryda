import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import {
  assertProductionSecretsAreSet,
  assertProductionStorageIsConfigured,
} from './config/env.validation';
import { StorageService } from './storage/storage.service';

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

  const storage = app.get(StorageService);
  assertProductionStorageIsConfigured(
    config.get('nodeEnv')!,
    storage.configuredDriver(),
    storage.isS3Configured(),
    storage.isR2Configured(),
  );

  const corsOrigins = config.get<string[]>('corsOrigins')!;
  if (config.get('nodeEnv') === 'production') {
    if (corsOrigins.length === 0) {
      // Same "refuse to boot" pattern as the JWT-secret and storage
      // checks above — an unrestricted app.enableCors() in production
      // means literally any website can call this API with a logged-in
      // user's browser credentials. Fail loudly rather than silently
      // wide open.
      throw new Error(
        'Refusing to start with NODE_ENV=production and no CORS_ORIGINS set. ' +
          'Set CORS_ORIGINS to a comma-separated list of your admin/partner web app origins ' +
          '(mobile apps are unaffected by CORS either way).',
      );
    }
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    // Local/staging convenience — every web frontend during development
    // runs from an unpredictable localhost port.
    app.enableCors();
  }

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