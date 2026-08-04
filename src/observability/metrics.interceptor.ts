import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const start = process.hrtime.bigint();

    // Use the matched route pattern (e.g. "/rides/:id/accept"), not the raw
    // URL — otherwise every distinct ride ID becomes its own metric label,
    // which would blow up cardinality.
    const route = request.route?.path ?? request.path ?? 'unknown';
    const method = request.method;

    return next.handle().pipe(
      tap({
        next: () => this.record(method, route, response.statusCode, start),
        error: (err) => this.record(method, route, err.status ?? 500, start),
      }),
    );
  }

  private record(method: string, route: string, status: number, start: bigint): void {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method, route, status: String(status) };
    this.metricsService.httpRequestsTotal.inc(labels);
    this.metricsService.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }
}
