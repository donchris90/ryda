import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const dsn = this.config.get<string>('observability.sentryDsn');
    if (!dsn) {
      this.logger.log('SENTRY_DSN not set — error reporting disabled (see README)');
      return;
    }

    Sentry.init({
      dsn,
      environment: this.config.get<string>('nodeEnv'),
      tracesSampleRate: 0.1,
    });
    this.enabled = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  captureException(error: Error, context?: Record<string, unknown>): void {
    if (!this.enabled) return;
    Sentry.captureException(error, { extra: context });
  }
}
