import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPE_KEY = 'requiredApiKeyScope';

/**
 * Declares the scope an ApiKeyGuard-protected endpoint requires. ApiKey
 * already had a `scopes` field (set at creation time via CreateApiKeyDto)
 * but nothing ever checked it — every valid, active key could call every
 * @UseGuards(ApiKeyGuard) endpoint regardless of what scopes it was issued
 * with. This decorator + the check in ApiKeyGuard is what actually makes
 * `scopes` mean something.
 */
export const RequireScope = (scope: string) =>
  SetMetadata(REQUIRED_SCOPE_KEY, scope);
