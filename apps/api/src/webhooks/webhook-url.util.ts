import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF hardening for webhook target URLs.
 *
 * Admins configure webhook URLs that the server later POSTs to. Without
 * validation, an attacker with admin access (or a compromised admin) could
 * point a webhook at internal services (cloud metadata endpoints, databases,
 * loopback admin panels, etc.) and use the server as a confused deputy.
 *
 * We defend in two layers:
 *  - {@link assertSafeWebhookUrl} runs at create/update time. It rejects bad
 *    schemes and any URL whose host is an IP literal in a blocked range. Hosts
 *    given as names are accepted here (they can't be fully validated until
 *    resolution, and DNS can change), but...
 *  - {@link resolveSafeWebhookHost} runs again at delivery time and resolves
 *    the hostname, rejecting if it maps to a blocked address. This closes the
 *    DNS-rebinding gap where a name resolves to a public IP at create time and
 *    a private one at delivery time.
 */

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Returns true if the given IPv4/IPv6 address string falls in a range that must
 * never be reachable by a webhook: loopback, link-local, private, CGNAT, etc.
 */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  // Not a recognizable IP literal — treat as blocked; callers should only pass
  // real addresses here.
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  // 0.0.0.0/8 — "this" network / unspecified.
  if (a === 0) return true;
  // 10.0.0.0/8 — private.
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254).
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private.
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function isBlockedIpv6(rawIp: string): boolean {
  // Strip zone id (e.g. fe80::1%eth0) and normalize case.
  const ip = rawIp.split('%')[0].toLowerCase();

  // Unspecified (::) and loopback (::1).
  if (ip === '::' || ip === '::1') return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) — fall back to
  // the embedded IPv4 check.
  const mapped = ip.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  // fe80::/10 — link-local.
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true;
  }
  // fc00::/7 — unique local addresses (private).
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;

  return false;
}

/**
 * Validate a webhook URL at configuration time.
 *
 * Throws {@link UnsafeWebhookUrlError} when the URL is malformed, uses a scheme
 * other than http/https, or has a host that is an IP literal in a blocked
 * range. Hostnames (names, not literals) pass this check and are re-validated at
 * delivery time by {@link resolveSafeWebhookHost}.
 */
export function assertSafeWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError('Webhook URL is not a valid URL');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeWebhookUrlError(
      'Webhook URL must use the http or https scheme',
    );
  }

  const host = normalizeHost(url.hostname);
  if (host.length === 0) {
    throw new UnsafeWebhookUrlError('Webhook URL must have a host');
  }

  // "localhost" and friends never resolve to anything public.
  if (isBlockedHostname(host)) {
    throw new UnsafeWebhookUrlError(
      `Webhook URL host "${url.hostname}" points to a non-routable address`,
    );
  }

  // If the host is an IP literal, validate it now.
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    throw new UnsafeWebhookUrlError(
      `Webhook URL host "${url.hostname}" is in a blocked address range`,
    );
  }

  return url;
}

/** Convenience boolean wrapper around {@link assertSafeWebhookUrl}. */
export function isSafeWebhookUrl(rawUrl: string): boolean {
  try {
    assertSafeWebhookUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a webhook URL's host and throw {@link UnsafeWebhookUrlError} if any
 * resolved address is in a blocked range. Call this immediately before making
 * the outbound request to defend against DNS rebinding.
 */
export async function assertSafeWebhookUrlResolved(rawUrl: string): Promise<URL> {
  const url = assertSafeWebhookUrl(rawUrl);
  const host = normalizeHost(url.hostname);

  // IP literals were already validated synchronously.
  if (isIP(host) !== 0) return url;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeWebhookUrlError(
      `Webhook URL host "${url.hostname}" could not be resolved`,
    );
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError(
      `Webhook URL host "${url.hostname}" did not resolve to any address`,
    );
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeWebhookUrlError(
        `Webhook URL host "${url.hostname}" resolves to a blocked address (${address})`,
      );
    }
  }

  return url;
}

/** Strip IPv6 brackets and lowercase the host. */
function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  return host;
}

/** Hostnames that are always non-routable regardless of DNS. */
function isBlockedHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'ip6-localhost' ||
    host === 'ip6-loopback'
  );
}
