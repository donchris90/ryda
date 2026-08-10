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
import { AuthTokensService } from './auth-tokens.service';
import { AuthTokenPurpose } from './entities/auth-token.entity';
import { MailerService } from '../mailer/mailer.service';
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
    private readonly authTokensService: AuthTokensService,
    private readonly mailerService: MailerService,
  ) {}

  async register(dto: RegisterDto) {
    const existingByEmail = await this.usersService.findByEmail(dto.email);
    if (existingByEmail) throw new ConflictException('Email already registered');

    if (dto.phone) {
      const existingByPhone = await this.usersService.findByPhone(dto.phone);
      if (existingByPhone) throw new ConflictException('Phone number already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.usersService.create({
      email: dto.email,
      phone: dto.phone ?? null,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      referredByCode: dto.referralCode ?? null,
    });

    await this.walletsService.createForUser(user.id);

    if (dto.deviceFingerprint) {
      await this.fraudService.recordDeviceFingerprint(user.id, dto.deviceFingerprint);
    }

    await this.sendVerificationEmail(user.id, user.email, user.firstName);

    // Deliberately no tokens issued here - matches the requested flow
    // (register -> verify -> login), not an auto-logged-in state for
    // an account that hasn't proven its email yet.
    return {
      message: 'Registration successful — check your email to verify your account before logging in.',
      userId: user.id,
    };
  }

  async sendVerificationEmail(userId: string, email: string, firstName: string): Promise<void> {
    const token = await this.authTokensService.issue(userId, AuthTokenPurpose.EMAIL_VERIFICATION);
    const appBaseUrl = this.config.get<string>('mail.appBaseUrl')!;
    const verifyUrl = `${appBaseUrl}/verify-email?token=${token}`;

    await this.mailerService.send(
      email,
      'Verify your Ryda account',
      `<p>Hi ${firstName},</p>
       <p>Welcome to Ryda. Click the link below to verify your email and activate your account:</p>
       <p><a href="${verifyUrl}">Verify my email</a></p>
       <p>This link expires in ${this.config.get<number>('mail.verificationTtlHours')} hours. If you didn't create this account, you can ignore this email.</p>`,
    );
  }

  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    // Same message whether or not the account exists — confirming or
    // denying an email's registration status to an unauthenticated
    // caller is its own minor information leak, not worth it here.
    if (!user || user.isEmailVerified) {
      return { message: 'If that email is registered and unverified, a new verification link has been sent.' };
    }

    await this.sendVerificationEmail(user.id, user.email, user.firstName);
    return { message: 'If that email is registered and unverified, a new verification link has been sent.' };
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const userId = await this.authTokensService.consume(token, AuthTokenPurpose.EMAIL_VERIFICATION);
    await this.usersService.markEmailVerified(userId);
    return { verified: true };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    // Same response whether or not the account exists — same reasoning
    // as resendVerificationEmail above.
    if (!user) {
      return { message: 'If that email is registered, a password reset link has been sent.' };
    }

    const token = await this.authTokensService.issue(user.id, AuthTokenPurpose.PASSWORD_RESET);
    const appBaseUrl = this.config.get<string>('mail.appBaseUrl')!;
    const resetUrl = `${appBaseUrl}/reset-password?token=${token}`;

    await this.mailerService.send(
      user.email,
      'Reset your Ryda password',
      `<p>Hi ${user.firstName},</p>
       <p>Click the link below to reset your password:</p>
       <p><a href="${resetUrl}">Reset my password</a></p>
       <p>This link expires in ${this.config.get<number>('mail.passwordResetTtlMinutes')} minutes. If you didn't request this, you can ignore this email — your password will not be changed.</p>`,
    );

    return { message: 'If that email is registered, a password reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const userId = await this.authTokensService.consume(token, AuthTokenPurpose.PASSWORD_RESET);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    // Revoking every existing refresh token means a stolen device or
    // leaked session can't keep riding on the old password after a
    // reset - the whole point of a reset is to cut off prior access.
    await this.logoutAll(userId);
    return { message: 'Password reset successfully — please log in with your new password.' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordHash(userId, passwordHash);
    // Same reasoning as resetPassword() — revoking every session,
    // including this one, means a leaked old password on another
    // device loses access too, not just newly-issued tokens. The
    // person just re-proved they know the (old) password, so a fresh
    // login here is a small, reasonable cost for that guarantee.
    await this.logoutAll(userId);
    return { message: 'Password changed — please log in again with your new password.' };
  }

  async deleteAccount(userId: string, password: string): Promise<{ message: string }> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    // Soft deactivation, not a row delete — the spec is explicit that
    // this shouldn't just delete the database row immediately, and for
    // good reason: a hard delete would either cascade-fail against
    // every ride/wallet-transaction/document row referencing this
    // user, or silently orphan/corrupt another passenger's or driver's
    // own ride history, financial records, and audit trail, none of
    // which is this account's data to take down with it. isActive=false
    // plus a full session revocation is sufficient to make the account
    // genuinely unusable — login() already rejects a disabled account
    // (see the isActive check there) — while leaving every historical
    // record intact for the people who legitimately still need it.
    await this.usersService.deactivate(userId);
    await this.logoutAll(userId);
    return { message: 'Your account has been deactivated.' };
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
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.passwordHash) {
      await this.auditService.log({
        actorUserId: null,
        actorRole: null,
        action: 'auth.login.failed',
        metadata: { identifier: dto.email, reason: 'unknown_account' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.auditService.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.login.failed',
        metadata: { identifier: dto.email, reason: 'bad_password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Matches the requested flow directly: verify before login, not
    // verify-or-be-silently-limited-once-in. A correct password for an
    // unverified account gets a specific, actionable error rather than
    // a generic failure or a silent partial login.
    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email before logging in — check your inbox for the verification link.');
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
