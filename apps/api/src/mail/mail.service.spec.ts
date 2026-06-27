/**
 * Unit tests for MailService.
 *
 * nodemailer is mocked entirely — no real SMTP connection is made.
 *
 * Test matrix:
 *   1. With SMTP_HOST set: sendMail is called with the correct from/to/subject/body.
 *   2. With SMTP_HOST set: SMTP_SECURE=true → secure:true on the transport.
 *   3. With SMTP_HOST set: auth object is populated only when SMTP_USER+SMTP_PASS are set.
 *   4. Without SMTP_HOST (dev): sendMail is NOT called; Logger.log is called instead.
 *   5. Without SMTP_HOST (prod): Logger.warn is called, body is NOT logged.
 *   6. SMTP send failure: error is caught and logged; method does NOT throw.
 *   7. HTML body is forwarded to sendMail when provided.
 *   8. MAIL_FROM defaults when the env var is absent.
 */

import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailService, MailMessage } from './mail.service';

// ---------------------------------------------------------------------------
// Mock nodemailer at the module level so we can control the transport.
// ---------------------------------------------------------------------------

jest.mock('nodemailer');

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

// createTransport returns a stub transporter whose sendMail is our mockSendMail.
mockCreateTransport.mockReturnValue({
  sendMail: mockSendMail,
} as unknown as nodemailer.Transporter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SMTP_ENV: Record<string, string> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'user@example.com',
  SMTP_PASS: 'secret',
  MAIL_FROM: 'Next Lane <no-reply@example.com>',
};

function applyEnv(vars: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  // Clear relevant keys first so each test starts clean.
  const allKeys = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'NODE_ENV',
  ];
  for (const k of allKeys) saved[k] = process.env[k];

  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

const MESSAGE: MailMessage = {
  to: 'alice@example.com',
  subject: 'Password Reset',
  text: 'Click here: https://example.com/reset-password?token=abc123',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MailService', () => {
  let service: MailService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new MailService();
    mockSendMail.mockReset();
    mockCreateTransport.mockClear();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ── 1. SMTP configured: sendMail called with correct fields ──────────────

  it('calls sendMail with the correct from/to/subject/text when SMTP_HOST is set', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV, NODE_ENV: 'production' });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(call.from).toBe('Next Lane <no-reply@example.com>');
    expect(call.to).toBe(MESSAGE.to);
    expect(call.subject).toBe(MESSAGE.subject);
    expect(call.text).toBe(MESSAGE.text);
  });

  // ── 2. SMTP_SECURE=true → secure:true on the transport ──────────────────

  it('creates a secure transport when SMTP_SECURE=true', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV, SMTP_SECURE: 'true', SMTP_PORT: '465' });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, port: 465 }),
    );
  });

  // ── 3. Auth object populated only when SMTP_USER + SMTP_PASS are set ────

  it('includes auth credentials when SMTP_USER and SMTP_PASS are set', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: SMTP_ENV.SMTP_USER, pass: SMTP_ENV.SMTP_PASS },
      }),
    );
  });

  it('omits auth when SMTP_USER is absent', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV, SMTP_USER: undefined, SMTP_PASS: undefined });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    const transportConfig = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(transportConfig).not.toHaveProperty('auth');
  });

  // ── 4. No SMTP_HOST (dev): log, no sendMail call ─────────────────────────

  it('does NOT call sendMail when SMTP_HOST is absent; logs the message instead', async () => {
    const restore = applyEnv({
      SMTP_HOST: undefined,
      NODE_ENV: 'development',
    });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    expect(mockSendMail).not.toHaveBeenCalled();
    // Logger.log should have been called with a message containing the body.
    const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allLogs).toContain(MESSAGE.to);
    expect(allLogs).toContain(MESSAGE.subject);
  });

  // ── 5. No SMTP_HOST (prod): warn, body NOT logged ────────────────────────

  it('emits a warn (not log) in production when SMTP_HOST is absent; does NOT log the body', async () => {
    const restore = applyEnv({
      SMTP_HOST: undefined,
      NODE_ENV: 'production',
    });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    expect(mockSendMail).not.toHaveBeenCalled();

    // A warning should have been emitted.
    expect(warnSpy).toHaveBeenCalled();

    // The body (which may contain tokens) must NOT appear in any logged output.
    const allLogs = [
      ...logSpy.mock.calls.map((c) => String(c[0])),
      ...warnSpy.mock.calls.map((c) => String(c[0])),
    ].join('\n');
    expect(allLogs).not.toContain('token=');
    expect(allLogs).not.toContain(MESSAGE.text);
  });

  // ── 6. SMTP send failure: error logged, method does NOT throw ────────────

  it('catches SMTP errors, logs them, and does NOT throw', async () => {
    const restore = applyEnv({ ...SMTP_ENV, NODE_ENV: 'production' });
    mockSendMail.mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      await expect(service.send(MESSAGE)).resolves.toBeUndefined();
    } finally {
      restore();
    }

    expect(errorSpy).toHaveBeenCalled();
    const errMsg = String(errorSpy.mock.calls[0][0]);
    expect(errMsg).toContain(MESSAGE.to);
    expect(errMsg).toContain('ECONNREFUSED');
  });

  // ── 7. HTML body forwarded to sendMail ───────────────────────────────────

  it('forwards the html field to sendMail when provided', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV });
    const msgWithHtml: MailMessage = { ...MESSAGE, html: '<p>Click <a href="#">here</a></p>' };
    try {
      await service.send(msgWithHtml);
    } finally {
      restore();
    }

    const call = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(call.html).toBe(msgWithHtml.html);
  });

  // ── 8. MAIL_FROM defaults when env var absent ────────────────────────────

  it('uses the default MAIL_FROM when the env var is not set', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    const restore = applyEnv({ ...SMTP_ENV, MAIL_FROM: undefined });
    try {
      await service.send(MESSAGE);
    } finally {
      restore();
    }

    const call = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(call.from).toBe('Next Lane <no-reply@example.com>');
  });
});
