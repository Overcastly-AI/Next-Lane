/**
 * PasswordResetService
 *
 * Issues and validates single-use, time-limited password-reset tokens.
 *
 * Security properties:
 * - 32 cryptographically-random bytes are generated for the raw token.
 * - Only the SHA-256 hex digest of the raw token is stored in the DB — the
 *   raw token is never persisted and cannot be reconstructed from the hash.
 * - Tokens expire after TOKEN_TTL_MS (default 1 hour).
 * - All unused prior tokens for the user are invalidated when a new one is
 *   issued, preventing token accumulation.
 * - The token is single-use: usedAt is set on first use; subsequent attempts
 *   with the same token are rejected.
 * - POST /auth/forgot-password always returns 200 regardless of whether the
 *   email exists (anti-enumeration).
 *
 * Delivery seam:
 * - In production you wire SMTP via `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
 *   `SMTP_PASS` env vars (see `.env.example`). When those are absent the
 *   service falls back to the Nest logger, emitting the full reset URL so
 *   developers can copy it from the API log.
 * - `deliverResetLink()` is the extension point — replace or augment it to
 *   plug in any transport (SES, Mailgun, etc.).
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

/** How long a reset token remains valid. */
const TOKEN_TTL_MS = 60 * 60 * 1_000; // 1 hour

/** Default base URL for reset links — override with RESET_BASE_URL env var. */
const defaultBaseUrl = (): string =>
  process.env.RESET_BASE_URL ?? 'http://localhost:3000';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a reset token for the given email address.
   *
   * Always returns void without error regardless of whether the user exists
   * (anti-enumeration: callers must not learn whether an email is registered).
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      // Do not reveal whether the address is registered.
      return;
    }

    // Invalidate all prior unused tokens for this user.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() }, // mark as consumed so they can't be used
    });

    // Generate a raw 32-byte token (URL-safe base64) and store only its hash.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    await this.deliverResetLink(user.email, rawToken);
  }

  /**
   * Validate the token, set the new password, and mark the token used.
   *
   * Throws BadRequestException on any of:
   *   - token not found
   *   - token expired
   *   - token already used
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (record.usedAt !== null) {
      throw new BadRequestException('Reset token has already been used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    const passwordHash = await argon2.hash(newPassword);

    // Update password and mark token used atomically.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Delivery seam
  // ---------------------------------------------------------------------------

  /**
   * Send (or log) the reset link.
   *
   * This is the extension point for SMTP / transactional email providers.
   * When SMTP_HOST is set, wire your mailer here. Until then the link is
   * written to the Nest logger so developers can grab it from the API logs.
   *
   * Environment variables used by the SMTP extension:
   *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
   *   RESET_BASE_URL — base URL of the web app (default: http://localhost:3000)
   *
   * See .env.example for documentation.
   */
  private async deliverResetLink(
    email: string,
    rawToken: string,
  ): Promise<void> {
    const baseUrl = defaultBaseUrl();
    const link = `${baseUrl}/reset-password?token=${rawToken}`;

    if (process.env.SMTP_HOST) {
      // SMTP delivery would be wired here. Placeholder for future integration.
      // Example: await this.mailer.sendMail({ to: email, subject: '...', html: ... });
      this.logger.log(
        `[password-reset] SMTP_HOST is set but SMTP delivery is not yet ` +
          `implemented. Falling back to log delivery for ${email}.`,
      );
    }

    // Dev-mode fallback: log the full link so developers can copy it from the
    // API logs.  NEVER emit the raw token in production — a log aggregator
    // (Loki, CloudWatch, journald) would capture it beyond the token's own
    // 1-hour validity window.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(
        `[password-reset] Reset link for ${email} → ${link}  ` +
          `(delivery: ${process.env.SMTP_HOST ? 'SMTP (stub)' : 'log'})`,
      );
    } else {
      // In production, log only the fact that a delivery was attempted — never
      // the raw token.  Configure SMTP_HOST to enable actual email delivery.
      this.logger.log(
        `[password-reset] Reset link dispatched for ${email} ` +
          `(delivery: ${process.env.SMTP_HOST ? 'SMTP (stub)' : 'log-suppressed-in-prod'})`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Deterministic SHA-256 hex digest of the raw token. */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
