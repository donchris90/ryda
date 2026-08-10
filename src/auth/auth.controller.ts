import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailDto, ResendVerificationDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto, DeleteAccountDto } from './dto/password-reset.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account', description: 'Creates a User + Wallet and sends an email verification link. No tokens are issued until the email is verified.' })
  @ApiResponse({ status: 201, description: 'Account created — check email to verify before logging in.' })
  @ApiResponse({ status: 409, description: 'Phone or email already registered.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited — 10 requests/minute per IP.' })
  // Tighter limit than the API default — register/login/OTP are the classic
  // brute-force / enumeration targets.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Log in', description: 'Email + password. Returns a new access/refresh token pair. Fails with a specific error if the email is not yet verified.' })
  @ApiResponse({ status: 200, description: 'Login successful.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials, unverified email, or disabled account.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited — 10 requests/minute per IP.' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'Verify an email address', description: 'Consumes the single-use token from the verification link and activates the account.' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @ApiOperation({ summary: 'Resend the verification email', description: 'Same response whether or not the email is registered/unverified, to avoid leaking account existence.' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @ApiOperation({ summary: 'Request a password reset email', description: 'Same response whether or not the email is registered, to avoid leaking account existence.' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @ApiOperation({ summary: 'Reset password with a token', description: 'Consumes the single-use token from the reset email and revokes every existing session.' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @ApiOperation({ summary: 'Change password while logged in', description: 'Requires the current password. Revokes every session (including this one) on success, so a fresh login is required afterward.' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('change-password')
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @ApiOperation({ summary: 'Deactivate my own account', description: 'Requires the current password. Soft-deactivates the account (not a row delete) and revokes every session — see AuthService.deleteAccount() for why.' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('delete-account')
  deleteAccount(@CurrentUser() user: User, @Body() dto: DeleteAccountDto) {
    return this.authService.deleteAccount(user.id, dto.password);
  }

  @ApiOperation({ summary: 'Send an OTP', description: 'Used for phone verification of the optional phone field, not for account login. Dev mode returns the code directly in the response (no SMS provider wired — see README).' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @ApiOperation({ summary: 'Verify an OTP' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @ApiOperation({ summary: 'Exchange a refresh token for a new pair', description: 'Rotates the token — the presented refresh token is revoked and a new one issued. Reusing an already-revoked token revokes ALL of that user\'s tokens (theft response).' })
  @ApiUnauthorizedResponse({ description: 'Invalid, expired, or reused (revoked) refresh token.' })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Log out on one device', description: 'Revokes a single refresh token.' })
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Log out everywhere', description: "Revokes every refresh token for the current user." })
  @ApiBearerAuth('access-token')
  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  logoutAll(@CurrentUser() user: User) {
    return this.authService.logoutAll(user.id);
  }
}
