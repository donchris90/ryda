import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new client.Registry();

  readonly httpRequestsTotal = new client.Counter({
    name: 'ryda_http_requests_total',
    help: 'Total HTTP requests, labeled by method/route/status',
    labelNames: ['method', 'route', 'status'] as const,
  });

  readonly httpRequestDurationSeconds = new client.Histogram({
    name: 'ryda_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly rideRequestsTotal = new client.Counter({
    name: 'ryda_ride_requests_total',
    help: 'Total ride requests created, labeled by category',
    labelNames: ['category'] as const,
  });

  readonly rideCompletionsTotal = new client.Counter({
    name: 'ryda_ride_completions_total',
    help: 'Total rides completed, labeled by payment method',
    labelNames: ['paymentMethod'] as const,
  });

  readonly rideCancellationsTotal = new client.Counter({
    name: 'ryda_ride_cancellations_total',
    help: 'Total rides cancelled, labeled by who cancelled',
    labelNames: ['cancelledBy'] as const,
  });

  readonly dispatchOffersTotal = new client.Counter({
    name: 'ryda_dispatch_offers_total',
    help: 'Total smart-dispatch offers created',
  });

  readonly walletTransactionsTotal = new client.Counter({
    name: 'ryda_wallet_transactions_total',
    help: 'Total wallet transactions, labeled by direction and category',
    labelNames: ['direction', 'category'] as const,
  });

  onModuleInit() {
    client.collectDefaultMetrics({ register: this.registry });
    this.registry.registerMetric(this.httpRequestsTotal);
    this.registry.registerMetric(this.httpRequestDurationSeconds);
    this.registry.registerMetric(this.rideRequestsTotal);
    this.registry.registerMetric(this.rideCompletionsTotal);
    this.registry.registerMetric(this.rideCancellationsTotal);
    this.registry.registerMetric(this.dispatchOffersTotal);
    this.registry.registerMetric(this.walletTransactionsTotal);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
