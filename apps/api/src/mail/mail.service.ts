/**
 * MailService
 *
 * Thin wrapper around nodemailer that provides a single `send()` method.
 *
 * Configuration (all via environment variables):
 *   SMTP_HOST     — SMTP server hostname. When absent the service falls back to
 *                   dev-log mode: the message is printed to the Nest logger and
 *                   no network connection is made.
 *   SMTP_PORT     — TCP port (default: 587).
 *   SMTP_SECURE   — "true" for TLS-on-connect (port 465), omit/false for STARTTLS.
 *   SMTP_USER     — SMTP auth username.
 *   SMTP_PASS     — SMTP auth password.
 *   MAIL_FROM     — "From" address used for all outbound messages.
 *                   Default: "Next Lane <no-reply@example.com>"
 *
 * Security notes:
 *   - Credentials (SMTP_USER / SMTP_PASS) are never logged, even in dev mode.
 *   - The raw message body IS logged in dev mode so developers can inspect it
 *     without running a real SMTP server.
 *   - In production (NODE_ENV=production) only a sanitised delivery-attempt line
 *     is emitted; the full body (which may contain tokens) is never logged.
 *
 * Dev/test path:
 *   When SMTP_HOST is unset the service calls Logger.log() with a short summary
 *   and does NOT throw — existing dev workflows are unaffected.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body (always included). */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /**
   * Send an email, or log it when SMTP is not configured.
   *
   * Never throws — delivery failures are logged as errors so the caller's
   * control flow is not disrupted (e.g. password-reset still returns 200).
   */
  async send(message: MailMessage): Promise<void> {
    const smtpHost = process.env.SMTP_HOST;

    if (!smtpHost) {
      this.devLog(message);
      return;
    }

    try {
      await this.sendViaSMTP(smtpHost, message);
    } catch (err) {
      // Log the error but do not propagate — callers should not fail because
      // the SMTP server is temporarily unavailable.
      this.logger.error(
        `[mail] Failed to deliver email to ${message.to} (subject: "${message.subject}"): ${String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendViaSMTP(smtpHost: string, message: MailMessage): Promise<void> {
    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM ?? 'Next Lane <no-reply@example.com>';

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    await transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

    // Only log the fact of delivery — never the body or credentials.
    this.logger.log(
      `[mail] Sent "${message.subject}" to ${message.to} via ${smtpHost}:${port}`,
    );
  }

  /**
   * Dev-mode fallback: log the message body so developers can inspect it
   * without setting up an SMTP server.
   *
   * In production SMTP_HOST should always be set. If it is not, we only emit
   * a sanitised line (no body / potential tokens) to avoid leaking sensitive
   * content into log aggregators.
   */
  private devLog(message: MailMessage): void {
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      this.logger.warn(
        `[mail] SMTP_HOST is not configured — email to ${message.to} ` +
          `(subject: "${message.subject}") was NOT delivered. ` +
          `Set SMTP_HOST (and related env vars) to enable real email delivery.`,
      );
    } else {
      this.logger.log(
        `[mail] SMTP not configured — dev-mode log delivery:\n` +
          `  To:      ${message.to}\n` +
          `  Subject: ${message.subject}\n` +
          `  Body:\n${message.text}`,
      );
    }
  }
}
