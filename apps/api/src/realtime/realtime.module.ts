import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtExpiresIn, getJwtSecret } from '../auth/auth.config';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [
    // Reuse the single required-secret source — never fall back to a default
    // (fail-fast is enforced by assertAuthConfig() at startup).
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
