import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from './require-feature.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const enabled = await this.featureFlagsService.isEnabled(key);
    if (!enabled) {
      throw new ServiceUnavailableException(`This feature ("${key}") is currently disabled`);
    }
    return true;
  }
}
