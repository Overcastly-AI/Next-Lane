import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard that can be switched off via `RATE_LIMIT_DISABLED=true`.
 *
 * Rate limiting keys on client IP, so deployments where many users share one
 * egress IP (corporate NAT, reverse proxy without `X-Forwarded-For` trust) or
 * automated test suites that log in hundreds of times can opt out. Production
 * deployments should leave it enabled (the default) and tune the limits via the
 * `THROTTLE_*` env vars instead of disabling outright.
 */
@Injectable()
export class ConfigurableThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(): Promise<boolean> {
    return process.env.RATE_LIMIT_DISABLED === 'true';
  }
}
