import {
  BadRequestException,
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from './entities/payment-record.entity';
import { PaymentMethod } from '../common/enums/ride.enum';
import { PaystackService } from './paystack/paystack.service';
import { RefundPaymentDto, SetDefaultCardDto } from './dto/payments.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';
import { WithdrawalsService } from '../wallets/withdrawals.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paystack: PaystackService,
    @Inject(forwardRef(() => WithdrawalsService))
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  @Post('cards/add-init')
  @UseGuards(JwtAuthGuard)
  initCardAdd(@CurrentUser() user: User) {
    if (!user.email) {
      throw new BadRequestException(
        'Add an email to your account before adding a card',
      );
    }
    return this.paymentsService.initCardAdd(user.id, user.email);
  }

  @Get('cards/mine')
  @UseGuards(JwtAuthGuard)
  myCards(@CurrentUser() user: User) {
    return this.paymentsService.listSavedCards(user.id);
  }

  @Post('cards/:id/default')
  @UseGuards(JwtAuthGuard)
  setDefaultCard(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _dto: SetDefaultCardDto,
  ) {
    return this.paymentsService.setDefaultCard(user.id, id);
  }

  @Post('cards/:id/remove')
  @UseGuards(JwtAuthGuard)
  removeCard(@CurrentUser() user: User, @Param('id') id: string) {
    return this.paymentsService.removeCard(user.id, id);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: User) {
    return this.paymentsService.findForUser(user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  all(
    @Query('status') status?: PaymentStatus,
    @Query('method') method?: PaymentMethod,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.findAll(
      { status, method, search },
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @RequirePermission(Permission.PAYMENTS_REFUND)
  @Audit('payment.refund')
  refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.paymentsService.refundPayment(id, dto.amount);
  }

  /**
   * Paystack webhook receiver. Signature is verified against the raw
   * request body (see main.ts `rawBody: true`) before anything in the
   * payload is trusted — never process an unverified webhook.
   */
  @Post('webhook/paystack')
  @HttpCode(200)
  async paystackWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-paystack-signature'] as string | undefined;
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    if (!this.paystack.verifyWebhookSignature(rawBody, signature)) {
      // Returning 200 here is deliberate — Paystack retries on non-2xx,
      // and we don't want to leak *why* verification failed to a caller
      // that isn't actually Paystack.
      return { received: true };
    }

    const event = JSON.parse(rawBody);

    if (
      event.event === 'transfer.success' ||
      event.event === 'transfer.failed' ||
      event.event === 'transfer.reversed'
    ) {
      const transferReference: string | undefined = event?.data?.reference;
      if (transferReference) {
        await this.withdrawalsService.handleTransferWebhook(
          transferReference,
          event.event === 'transfer.success',
          event.event !== 'transfer.success'
            ? (event?.data?.failure_reason ??
                `Paystack reported ${event.event}`)
            : undefined,
        );
      }
      return { received: true };
    }

    // Confirms (or fails) a refund previously reserved by
    // PaymentsService.refundPayment() — most refunds come back
    // pending/queued from that initial call and only actually resolve
    // here, asynchronously, once Paystack finishes processing it.
    if (event.event === 'refund.processed' || event.event === 'refund.failed') {
      const transactionReference: string | undefined =
        event?.data?.transaction?.reference ??
        event?.data?.transaction_reference;
      if (transactionReference) {
        await this.paymentsService.handleRefundWebhook(
          transactionReference,
          event.event === 'refund.processed',
        );
      }
      return { received: true };
    }

    const reference: string | undefined = event?.data?.reference;
    if (!reference) return { received: true };

    if (event.event === 'charge.success') {
      const purpose: string | undefined = event.data.metadata?.purpose;
      const result = await this.paymentsService.markSuccessFromWebhook(
        reference,
        event.data.id?.toString() ?? reference,
        purpose,
      );

      // A replayed/duplicate webhook delivery for an already-settled
      // payment — every side effect below (wallet credit, card save +
      // refund) must run at most once per payment, so skip them entirely
      // on a replay rather than re-triggering them. Wallet crediting for
      // purpose === 'wallet_topup' already happened inside
      // markSuccessFromWebhook() itself, atomically with the status
      // flip — nothing further to do for that case here.
      if (result?.alreadyProcessed) {
        return { received: true };
      }

      const record = result?.record ?? null;

      if (
        record &&
        record.rideId === null &&
        purpose !== 'wallet_topup' &&
        event.data.authorization?.authorization_code
      ) {
        // Card-verification charges (not tied to a ride) tokenize the card
        // and get silently refunded — the point was only to capture the
        // reusable authorization_code.
        await this.paymentsService.saveCardFromVerification(
          record.userId,
          event.data.authorization.authorization_code,
          event.data.authorization.last4 ?? null,
          event.data.authorization.card_type ?? null,
          event.data.authorization.bank ?? null,
        );
        await this.paystack
          .refund({ transactionReference: reference })
          .catch(() => undefined);
      }
    } else if (event.event === 'charge.failed') {
      await this.paymentsService.markFailedFromWebhook(
        reference,
        'Paystack reported charge.failed',
      );
    }

    return { received: true };
  }
}