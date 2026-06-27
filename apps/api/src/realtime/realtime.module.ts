import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtExpiresIn, getJwtSecret } from '../auth/auth.config';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { ApiTokensModule } from '../api-tokens/api-tokens.module';

// RedisModule is @Global — the pub/sub clients are injected into the gateway
// via @Optional() so no explicit import is needed here; the tokens resolve from
// the global context automatically.

@Global()
@Module({
  imports: [
    // Reuse the single required-secret source — never fall back to a default
    // (fail-fast is enforced by assertAuthConfig() at startup).
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
    // ApiTokensModule exports ApiTokensService so the gateway can validate
    // PAT tokens at WebSocket handshake time.
    ApiTokensModule,
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
