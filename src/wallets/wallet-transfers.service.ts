import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Between, MoreThan, Repository } from 'typeorm';
import { WalletTransferRequest, WalletTransferStatus } from './entities/wallet-transfer-request.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '../otp/otp-code.entity';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { InitiateTransferDto, ConfirmTransferDto } from './dto/transfer.dto';

const TRANSFER_REQUEST_TTL_MINUTES = 10;

function maskName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName.charAt(0)}.`;
}

function maskEmail(email: string): string {
  // ada@example.com -> ad***@example.com - enough to recognise, not
  // enough to fully identify from the confirmation screen alone.
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone: string | null): string | null {
  // +2348011112222 -> +23480*****222 - same reasoning as maskEmail().
  if (!phone || phone.length <= 7) return phone;
  return `${phone.slice(0, 5)}*****${phone.slice(-3)}`;
}

@Injectable()
export class WalletTransfersService {
  private readonly logger = new Logger(WalletTransfersService.name);

  constructor(
    @InjectRepository(WalletTransferRequest)
    private readonly transferRequestsRepo: Repository<WalletTransferRequest>,
    @InjectRepository(WalletTransaction)
    private readonly txRepo: Repository<WalletTransaction>,
    private readonly walletsService: WalletsService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly settingsService: SystemSettingsService,
  ) {}

  async initiate(senderId: string, dto: InitiateTransferDto) {
    const sender = await this.usersService.findById(senderId);
    if (!sender.phone || !sender.isPhoneVerified) {
      throw new BadRequestException(
        'You need a verified phone number on file before you can send money — add and verify one first.',
      );
    }

    // A double-tap or network retry creating a second pending request
    // is a real correctness risk here, not just clutter: OTP
    // verification is scoped only to (phone, purpose), not to a
    // specific transferRequestId, so the code the user actually
    // receives (always the latest one sent) could otherwise be used
    // to confirm a stale, earlier request with a different
    // amount/recipient than the one currently on screen.
    const existingPending = await this.transferRequestsRepo.findOne({
      where: { senderId, status: WalletTransferStatus.PENDING },
    });
    if (existingPending && existingPending.expiresAt > new Date()) {
      throw new ConflictException(
        'You already have a transfer awaiting OTP confirmation — confirm or wait for it to expire before starting another.',
      );
    }

    const recipient = dto.recipientEmail
      ? await this.usersService.findByEmail(dto.recipientEmail)
      : await this.usersService.findByPhone(dto.recipientPhone!);
    if (!recipient) {
      const identifierLabel = dto.recipientEmail ? 'email address' : 'phone number';
      throw new BadRequestException(`No Ryda account found with that ${identifierLabel}`);
    }
    if (recipient.id === senderId) {
      throw new BadRequestException('You cannot transfer money to yourself');
    }

    // Real, not just theoretical: fetch both wallets now so a genuinely
    // missing recipient wallet fails clearly here, before an OTP is
    // spent on a transfer that could never complete.
    const senderWallet = await this.walletsService.getByUserId(senderId);
    const recipientWallet = await this.walletsService.getByUserId(recipient.id);

    const [minAmount, maxPerTransaction, maxDaily, fee] = await Promise.all([
      this.settingsService.getNumber(SETTING_KEYS.WALLET_TRANSFER_MIN, 100),
      this.settingsService.getNumber(SETTING_KEYS.WALLET_TRANSFER_MAX_PER_TRANSACTION, 500_000),
      this.settingsService.getNumber(SETTING_KEYS.WALLET_TRANSFER_MAX_DAILY, 1_000_000),
      this.settingsService.getNumber(SETTING_KEYS.WALLET_TRANSFER_FEE, 0),
    ]);

    if (dto.amount < minAmount) {
      throw new BadRequestException(`Minimum transfer amount is ${minAmount}`);
    }
    if (dto.amount > maxPerTransaction) {
      throw new BadRequestException(`Maximum transfer amount per transaction is ${maxPerTransaction}`);
    }

    const todaySent = await this.sumTodaysSentTransfers(senderWallet.id);
    if (todaySent + dto.amount > maxDaily) {
      throw new BadRequestException(
        `This would exceed your daily transfer limit of ${maxDaily}. You've already sent ${todaySent} today.`,
      );
    }

    const total = dto.amount + fee;
    if (parseFloat(senderWallet.balance) < total) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const request = await this.transferRequestsRepo.save(
      this.transferRequestsRepo.create({
        senderId,
        recipientId: recipient.id,
        amount: dto.amount.toFixed(2),
        fee: fee.toFixed(2),
        note: dto.note ?? null,
        status: WalletTransferStatus.PENDING,
        expiresAt: new Date(Date.now() + TRANSFER_REQUEST_TTL_MINUTES * 60 * 1000),
      }),
    );

    const { expiresInSeconds } = await this.otpService.send(sender.phone!, OtpPurpose.WALLET_TRANSFER);

    return {
      transferRequestId: request.id,
      recipientName: maskName(recipient.firstName, recipient.lastName),
      recipientEmail: maskEmail(recipient.email),
      recipientPhone: maskPhone(recipient.phone),
      amount: dto.amount,
      fee,
      total,
      otpExpiresInSeconds: expiresInSeconds,
      transferRequestExpiresAt: request.expiresAt,
    };
  }

  async confirm(senderId: string, dto: ConfirmTransferDto) {
    const request = await this.transferRequestsRepo.findOne({ where: { id: dto.transferRequestId } });
    if (!request) throw new NotFoundException('Transfer request not found');

    // A different user confirming someone else's pending transfer id
    // must fail cleanly, not silently move someone else's money.
    if (request.senderId !== senderId) {
      throw new ForbiddenException('This transfer request does not belong to you');
    }

    if (request.status !== WalletTransferStatus.PENDING) {
      throw new BadRequestException(`This transfer request is already ${request.status}`);
    }

    if (request.expiresAt < new Date()) {
      request.status = WalletTransferStatus.EXPIRED;
      await this.transferRequestsRepo.save(request);
      throw new BadRequestException('This transfer request has expired — please start a new transfer');
    }

    const sender = await this.usersService.findById(senderId);
    await this.otpService.verify(sender.phone!, dto.otpCode, OtpPurpose.WALLET_TRANSFER);

    const senderWallet = await this.walletsService.getByUserId(request.senderId);
    const recipientWallet = await this.walletsService.getByUserId(request.recipientId);
    const recipient = await this.usersService.findById(request.recipientId);

    const { senderWallet: updatedSender } = await this.walletsService.transfer(
      senderWallet.id,
      recipientWallet.id,
      parseFloat(request.amount),
      parseFloat(request.fee),
      request.id,
      request.note
        ? `Transfer to ${recipient.firstName} — ${request.note}`
        : `Transfer to ${recipient.firstName} ${recipient.lastName}`,
    );

    request.status = WalletTransferStatus.COMPLETED;
    await this.transferRequestsRepo.save(request);

    return {
      transferRequestId: request.id,
      newBalance: updatedSender.balance,
      amount: parseFloat(request.amount),
      fee: parseFloat(request.fee),
      recipientName: `${recipient.firstName} ${recipient.lastName}`,
    };
  }

  private async sumTodaysSentTransfers(walletId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await this.txRepo.find({
      where: {
        walletId,
        category: TransactionCategory.TRANSFER_SENT,
        createdAt: MoreThan(startOfDay),
      },
    });

    return rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
  }

  /**
   * Proactive cleanup - EXPIRED was previously only ever set lazily,
   * when someone happened to attempt confirming an already-dead
   * request (see confirm()'s own expiry check above). The far more
   * common case - a request simply abandoned, nobody ever tries to
   * confirm it - left it sitting as PENDING forever, misleading any
   * admin view or analytics counting pending transfers.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleRequests(): Promise<void> {
    const result = await this.transferRequestsRepo
      .createQueryBuilder()
      .update(WalletTransferRequest)
      .set({ status: WalletTransferStatus.EXPIRED })
      .where('status = :status', { status: WalletTransferStatus.PENDING })
      .andWhere('"expiresAt" < :now', { now: new Date() })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Marked ${result.affected} stale wallet transfer request(s) as expired.`);
    }
  }
}
