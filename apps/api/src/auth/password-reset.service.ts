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
 * Delivery:
 * - When SMTP_HOST is configured, MailService sends a real email via nodemailer.
 * - When SMTP_HOST is absent (dev mode) MailService logs the full reset URL to
 *   the Nest logger so developers can copy it from the API logs.
 * - In production without SMTP_HOST configured, MailService emits a warning and
 *   skips delivery (the raw token is never logged in that case).
 * - `deliverResetLink()` delegates to MailService — SMTP vs log decision is made
 *   inside MailService, keeping this service transport-agnostic.
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/** How long a reset token remains valid. */
const TOKEN_TTL_MS = 60 * 60 * 1_000; // 1 hour

/** Default base URL for reset links — override with RESET_BASE_URL env var. */
const defaultBaseUrl = (): string =>
  process.env.RESET_BASE_URL ?? 'http://localhost:3000';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

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
   * Deliver the password-reset link to the user.
   *
   * Delegates to MailService which handles:
   *   - Real SMTP delivery when SMTP_HOST is configured (nodemailer).
   *   - Dev-log fallback when SMTP_HOST is absent (link printed to Nest logger).
   *   - Production-safe suppression (no body/token logged) when in prod without SMTP.
   *
   * In development (non-production) without SMTP the link also appears here via
   * Logger.log so it is still visible in the console even without reading MailService logs.
   */
  private async deliverResetLink(
    email: string,
    rawToken: string,
  ): Promise<void> {
    const baseUrl = defaultBaseUrl();
    const link = `${baseUrl}/reset-password?token=${rawToken}`;

    // Dev convenience: also log directly from this service so the link is
    // visible in one place even before MailService's log line.
    if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) {
      this.logger.log(
        `[password-reset] Reset link for ${email} → ${link}  (delivery: dev-log)`,
      );
    }

    await this.mail.send({
      to: email,
      subject: 'Reset your Next Lane password',
      text:
        `Hi,\n\n` +
        `You requested a password reset for your Next Lane account.\n\n` +
        `Click the link below to choose a new password (valid for 1 hour):\n` +
        `${link}\n\n` +
        `If you did not request this, you can safely ignore this email.\n\n` +
        `— Next Lane`,
      html:
        `<p>Hi,</p>` +
        `<p>You requested a password reset for your Next Lane account.</p>` +
        `<p><a href="${link}">Reset your password</a> (valid for 1 hour)</p>` +
        `<p>If you did not request this, you can safely ignore this email.</p>` +
        `<p>— Next Lane</p>`,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Deterministic SHA-256 hex digest of the raw token. */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
