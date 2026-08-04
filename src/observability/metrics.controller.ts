import { Controller, Get, Header } from '@nestjs/common';
import { register } from 'prom-client';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', register.contentType)
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
