jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
import { lookup } from 'node:dns/promises';
import {
  assertSafeWebhookUrl,
  assertSafeWebhookUrlResolved,
  isBlockedIp,
  isSafeWebhookUrl,
  UnsafeWebhookUrlError,
} from './webhook-url.util';

const lookupMock = lookup as unknown as jest.Mock;

describe('isBlockedIp', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.1.50',
    '100.64.0.1',
    '100.127.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ];

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34', // example.com
    '172.15.255.255', // just below private 172.16/12
    '172.32.0.1', // just above private 172.16/12
    '100.63.255.255', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '169.253.0.1', // not link-local
    '11.0.0.1',
    '2606:4700:4700::1111', // public IPv6 (Cloudflare)
  ];

  it.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(allowed)('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('blocks garbage input', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('999.999.999.999')).toBe(true);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('accepts a normal public https URL', () => {
    expect(() => assertSafeWebhookUrl('https://hooks.example.com/path')).not.toThrow();
    const url = assertSafeWebhookUrl('https://hooks.example.com/path?q=1');
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('accepts a public http URL', () => {
    expect(() => assertSafeWebhookUrl('http://hooks.example.com/path')).not.toThrow();
  });

  it('accepts a public IP literal', () => {
    expect(() => assertSafeWebhookUrl('https://8.8.8.8/hook')).not.toThrow();
  });

  it('rejects non-http(s) schemes', () => {
    for (const u of [
      'ftp://example.com/x',
      'file:///etc/passwd',
      'gopher://example.com',
      'javascript:alert(1)',
    ]) {
      expect(() => assertSafeWebhookUrl(u)).toThrow(UnsafeWebhookUrlError);
    }
  });

  it('rejects malformed URLs', () => {
    expect(() => assertSafeWebhookUrl('not a url')).toThrow(UnsafeWebhookUrlError);
    expect(() => assertSafeWebhookUrl('')).toThrow(UnsafeWebhookUrlError);
  });

  it('rejects localhost by name', () => {
    expect(() => assertSafeWebhookUrl('http://localhost:8080/x')).toThrow(
      UnsafeWebhookUrlError,
    );
    expect(() => assertSafeWebhookUrl('http://api.localhost/x')).toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it('rejects loopback and private IP literals', () => {
    for (const u of [
      'http://127.0.0.1/x',
      'http://127.0.0.1:9000/admin',
      'http://10.0.0.5/x',
      'http://172.16.0.1/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/x',
    ]) {
      expect(() => assertSafeWebhookUrl(u)).toThrow(UnsafeWebhookUrlError);
    }
  });

  it('rejects bracketed IPv6 loopback / link-local / ULA literals', () => {
    for (const u of [
      'http://[::1]/x',
      'http://[::1]:8080/x',
      'http://[fe80::1]/x',
      'http://[fc00::1]/x',
    ]) {
      expect(() => assertSafeWebhookUrl(u)).toThrow(UnsafeWebhookUrlError);
    }
  });

  it('isSafeWebhookUrl mirrors assert without throwing', () => {
    expect(isSafeWebhookUrl('https://hooks.example.com/x')).toBe(true);
    expect(isSafeWebhookUrl('http://127.0.0.1/x')).toBe(false);
    expect(isSafeWebhookUrl('ftp://example.com/x')).toBe(false);
  });
});

describe('assertSafeWebhookUrlResolved', () => {
  beforeEach(() => lookupMock.mockReset());

  it('passes IP literals through without DNS lookup', async () => {
    await expect(
      assertSafeWebhookUrlResolved('https://8.8.8.8/hook'),
    ).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a host that resolves to a public address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      assertSafeWebhookUrlResolved('https://hooks.example.com/x'),
    ).resolves.toBeInstanceOf(URL);
  });

  it('blocks a host that resolves to a private address (DNS rebinding)', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      assertSafeWebhookUrlResolved('https://evil.example.com/x'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('blocks when any of multiple resolved addresses is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(
      assertSafeWebhookUrlResolved('https://hooks.example.com/x'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('blocks when resolution fails', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      assertSafeWebhookUrlResolved('https://nope.example.com/x'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('still rejects bad schemes before resolving', async () => {
    await expect(
      assertSafeWebhookUrlResolved('ftp://example.com/x'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
