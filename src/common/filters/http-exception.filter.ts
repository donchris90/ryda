import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryService } from '../../observability/sentry.service';

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly sentryService: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Only genuinely unexpected errors (5xx) go to Sentry — a 400 for a bad
    // request body isn't an application bug, it's expected input validation
    // doing its job, and would just be noise in error tracking.
    if (status >= 500 && exception instanceof Error) {
      this.logger.error(`${request.method} ${request.url} -> ${status}: ${exception.message}`, exception.stack);
      this.sentryService.captureException(exception, {
        path: request.url,
        method: request.method,
      });
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message: typeof message === 'string' ? message : (message as any).message ?? message,
    });
  }
}
