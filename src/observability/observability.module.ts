import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { SentryService } from './sentry.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

@Module({
  providers: [
    MetricsService,
    SentryService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  controllers: [MetricsController],
  exports: [MetricsService, SentryService],
})
export class ObservabilityModule {}
