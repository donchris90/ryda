import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PaystackService } from '../payments/paystack/paystack.service';

@Injectable()
export class PaymentsHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly paystack: PaystackService,
  ) {}

  check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    return this.paystack.isConfigured()
      ? indicator.up({ mode: 'live-or-test-key' })
      : indicator.down({ message: 'PAYSTACK_SECRET_KEY not set — payments run in simulated mode' });
  }
}
