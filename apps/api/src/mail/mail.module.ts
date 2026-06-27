import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * MailModule — provides MailService for SMTP email delivery.
 *
 * Import this module wherever you need to send emails. MailService is
 * exported so it can be injected into any other module that imports MailModule.
 *
 * No SMTP configuration is required at import time — all settings are read
 * from environment variables at send time, keeping this module stateless and
 * easy to test (no factory setup, no config service dependency).
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
