import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { RefreshToken } from './entities/refresh-token.entity';
import { AuthToken } from './entities/auth-token.entity';
import { AuthService } from './auth.service';
import { AuthTokensService } from './auth-tokens.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuditModule } from '../audit/audit.module';
import { FraudModule } from '../fraud/fraud.module';
import { OtpModule } from '../otp/otp.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, AuthToken]),
    UsersModule,
    WalletsModule,
    AuditModule,
    FraudModule,
    OtpModule,
    MailerModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.accessExpiresIn') as any,
        },
      }),
    }),
  ],
  providers: [AuthService, AuthTokensService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
