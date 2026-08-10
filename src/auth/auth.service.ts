import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '../otp/otp-code.entity';
import { OtpService } from '../otp/otp.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { AuditService } from '../audit/audit.service';
import { FraudService } from '../fraud/fraud.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly fraudService: FraudService,
    private readonly otpService: OtpService,
  ) {}

  async register(dto: RegisterDto) {
    const existingByPhone = await this.usersService.findByPhone(dto.phone);
    if (existingByPhone) throw new ConflictException('Phone number already registered');

    if (dto.email) {
      const existingByEmail = await this.usersService.findByEmail(dto.email);
      if (existingByEmail) throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.create({
      phone: dto.phone,
      email: dto.email ?? null,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      referredByCode: dto.referralCode ?? null,
    });

    await this.walletsService.createForUser(user.id);
    await this.sendOtp({ phone: user.phone });

    if (dto.deviceFingerprint) {
      await this.fraudService.recordDeviceFingerprint(user.id, dto.deviceFingerprint);
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async sendOtp(dto: SendOtpDto, purpose: OtpPurpose = OtpPurpose.PHONE_VERIFICATION) {
    const { devOnlyCode, expiresInSeconds } = await this.otpService.send(dto.phone, purpose);
    return { message: 'OTP sent', devOnlyCode, expiresInSeconds };
  }

  async verifyOtp(dto: VerifyOtpDto, purpose: OtpPurpose = OtpPurpose.PHONE_VERIFICATION) {
    await this.otpService.verify(dto.phone, dto.code, purpose);

    // Only a genuine phone-verification OTP should ever mark the phone
    // verified - a wallet-transfer confirmation succeeding says nothing
    // about phone ownership being newly proven, it was already required
    // to be verified before a transfer OTP could even be requested.
    if (purpose === OtpPurpose.PHONE_VERIFICATION) {
      const user = await this.usersService.findByPhone(dto.phone);
      if (user) {
        await this.usersService.markPhoneVerified(user.id);
      }
    }

    return { verified: true };
  }

  async login(dto: LoginDto) {
    const user = dto.email
      ? await this.usersService.findByEmailWithPassword(dto.email)
      : await this.usersService.findByPhoneWithPassword(dto.phone!);
    if (!user || !user.passwordHash) {
      await this.auditService.log({
        actorUserId: null,
        actorRole: null,
        action: 'auth.login.failed',
        metadata: { identifier: dto.email ?? dto.phone, reason: 'unknown_account' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.auditService.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.login.failed',
        metadata: { identifier: dto.email ?? dto.phone, reason: 'bad_password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    await this.auditService.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login.success',
    });

    if (dto.deviceFingerprint) {
      await this.fraudService.recordDeviceFingerprint(user.id, dto.deviceFingerprint);
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  /**
   * Verifies + rotates a refresh token: the presented token is checked
   * against its stored hash and must not already be revoked. If a *revoked*
   * token is presented, that's a signal of possible theft (an old token
   * being replayed), so every refresh token for that user is revoked as a
   * precaution and the caller must log in again.
   */
  async refresh(refreshToken: string) {
    let payload: { sub: string; role: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (stored.revoked) {
      await this.refreshTokenRepo.update({ userId: stored.userId }, { revoked: true });
      throw new UnauthorizedException('Refresh token reuse detected — please log in again');
    }

    await this.refreshTokenRepo.update(stored.id, { revoked: true });

    const user = await this.usersService.findById(payload.sub);
    return this.issueTokens(user.id, user.role);
  }

  /** Revokes a single refresh token (logout on one device). */
  async logout(refreshToken: string): Promise<{ loggedOut: boolean }> {
    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokenRepo.update({ tokenHash }, { revoked: true });
    return { loggedOut: true };
  }

  /** Revokes every refresh token for a user (logout everywhere). */
  async logoutAll(userId: string): Promise<{ loggedOut: boolean }> {
    await this.refreshTokenRepo.update({ userId, revoked: false }, { revoked: true });
    return { loggedOut: true };
  }

  private sanitizeUser(user: User) {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  private async issueTokens(userId: string, role: string) {
    // A random jti ensures two tokens issued within the same second (e.g.
    // rapid refresh calls) are never byte-identical, since JWT signing is
    // otherwise deterministic for identical payload+iat+secret.
    const payload = { sub: userId, role, jti: randomUUID() };
    const accessExpiresIn = this.config.get<string>('jwt.accessExpiresIn') as any;
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') as any;

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: accessExpiresIn,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: refreshExpiresIn,
    });

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.resolveExpiry(refreshExpiresIn),
      }),
    );

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveExpiry(expiresIn: string): Date {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback: 30d
    const value = parseInt(match[1], 10);
    const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]!;
    return new Date(Date.now() + value * unitMs);
  }
}
