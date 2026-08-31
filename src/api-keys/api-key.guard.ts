import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from './api-keys.service';
import { REQUIRED_SCOPE_KEY } from './require-scope.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = request.headers['x-api-key'];

    if (!rawKey) throw new UnauthorizedException('Missing x-api-key header');

    const apiKey = await this.apiKeysService.validate(rawKey);
    if (!apiKey) throw new UnauthorizedException('Invalid or revoked API key');

    const requiredScope = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredScope && !apiKey.scopes.includes(requiredScope)) {
      throw new ForbiddenException(
        `This API key doesn't have the "${requiredScope}" scope`,
      );
    }

    request.apiKey = apiKey;
    return true;
  }
}
