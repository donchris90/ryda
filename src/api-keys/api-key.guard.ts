import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = request.headers['x-api-key'];

    if (!rawKey) throw new UnauthorizedException('Missing x-api-key header');

    const apiKey = await this.apiKeysService.validate(rawKey);
    if (!apiKey) throw new UnauthorizedException('Invalid or revoked API key');

    request.apiKey = apiKey;
    return true;
  }
}
