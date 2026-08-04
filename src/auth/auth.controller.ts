import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account', description: 'Creates a User + Wallet, sends an OTP, and returns access/refresh tokens.' })
  @ApiResponse({ status: 201, description: 'Account created — returns { user, accessToken, refreshToken }.' })
  @ApiResponse({ status: 409, description: 'Phone or email already registered.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited — 10 requests/minute per IP.' })
  // Tighter limit than the API default — register/login/OTP are the classic
  // brute-force / enumeration targets.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Log in', description: 'Phone + password. Returns a new access/refresh token pair.' })
  @ApiResponse({ status: 200, description: 'Login successful.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or disabled account.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited — 10 requests/minute per IP.' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'Send an OTP', description: 'Dev mode returns the code directly in the response (no SMS provider wired — see README).' })
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
