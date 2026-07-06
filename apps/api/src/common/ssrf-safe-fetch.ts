import * as dns from 'node:dns';
import * as net from 'node:net';
import { Agent } from 'undici';

// ---- SSRF protection -------------------------------------------------------
//
// The SINGLE shared seam through which every outbound call this API makes to
// a user/admin-supplied URL — webhook delivery (`webhooks.service.ts`),
// GitHub live-status polling (`github-client.service.ts`), and GitLab
// live-status polling (`gitlab-client.service.ts`) — must go through.
//
// Hardening Night pass 13 (`docs/AUDIT-ENGINEERING.md`, Risk 3) found a
// DNS-rebinding TOCTOU here: the original guard resolved DNS once to check
// the target against a private/loopback/link-local blocklist, then called
// `fetch()`, which re-resolves DNS itself. An attacker-controlled hostname
// with a very short TTL can answer the check with a public IP and the
// subsequent real connection with `169.254.169.254`/`127.0.0.1`/an internal
// service — the classic bypass. `ssrfSafeFetch` closes this structurally by
// resolving DNS exactly ONCE and PINNING the actual TCP/TLS connection to
// that one vetted address (see `buildPinnedLookup`) — there is no second
// real DNS query for a rebinding nameserver to answer differently.

/**
 * Returns true if the given IP address (v4 or v6) is in a blocked range.
 *
 * Blocked ranges:
 *   IPv4: loopback 127.0.0.0/8, link-local 169.254.0.0/16,
 *         private 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *         this-network 0.0.0.0/8
 *   IPv6: loopback ::1, link-local fe80::/10, unique-local fc00::/7
 *
 * Gate: when process.env.WEBHOOK_ALLOW_PRIVATE === 'true' the caller should
 * skip this check entirely (see `ssrfSafeFetch`).
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    // 0.0.0.0/8 — this-network (also covers 0.0.0.0 as a default-route sentinel)
    if (a === 0) return true;
    // 127.0.0.0/8 — loopback
    if (a === 127) return true;
    // 10.0.0.0/8 — private class A
    if (a === 10) return true;
    // 172.16.0.0/12 — private class B (172.16–172.31)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 — private class C
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local / AWS metadata
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    // Normalise to lower-case for comparison.
    const lower = ip.toLowerCase();
    // :: — unspecified (connects to "this host" on most stacks)
    if (lower === '::') return true;
    // ::1 — loopback
    if (lower === '::1') return true;
    // fe80::/10 — link-local (fe80 – febf)
    if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
    // fc00::/7 — unique-local (fc00 – fdff)
    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;

    // IPv4-embedded IPv6 (security review on 6fd9201, must-fix): an AAAA
    // record of ::ffff:169.254.169.254 previously sailed through this
    // branch — the pin then faithfully connected to the metadata IP. Cover
    // IPv4-mapped ::ffff:0:0/96 (both the dotted `::ffff:a.b.c.d` and pure
    // hex `::ffff:a9fe:a9fe` textual forms), the deprecated IPv4-compatible
    // ::a.b.c.d/96, and NAT64 64:ff9b::/96 by extracting the embedded IPv4
    // and re-running the IPv4 blocklist on it.
    const embedded = extractEmbeddedIpv4(lower);
    if (embedded !== null) return isBlockedIp(embedded);

    return false;
  }

  // Unknown address family — block by default (fail-closed).
  return true;
}

/**
 * If `lower` (a valid lower-case IPv6 literal) embeds an IPv4 address —
 * IPv4-mapped `::ffff:0:0/96`, deprecated IPv4-compatible `::/96` (with a
 * non-zero host part), or NAT64 `64:ff9b::/96` — return that IPv4 in dotted
 * form; otherwise null. Works on both textual styles (`::ffff:1.2.3.4` and
 * `::ffff:102:304`) by fully expanding the address first.
 */
function extractEmbeddedIpv4(lower: string): string | null {
  // Trailing dotted-quad form: convert it to two hex groups so the address
  // can be expanded uniformly.
  let s = lower;
  const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  let dottedQuad: number[] | null = null;
  if (dotted) {
    dottedQuad = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number);
    const hi = ((dottedQuad[0] << 8) | dottedQuad[1]).toString(16);
    const lo = ((dottedQuad[2] << 8) | dottedQuad[3]).toString(16);
    s = `${dotted[1]}${hi}:${lo}`;
  }

  // Expand `::` to the full 8 groups.
  let groups: string[];
  if (s.includes('::')) {
    const [head, tail] = s.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return null;
  const g = groups.map((x) => parseInt(x || '0', 16));
  if (g.some((x) => Number.isNaN(x))) return null;

  const embedsAt = (prefix: number[]): boolean =>
    prefix.every((p, i) => g[i] === p);

  const isMapped = embedsAt([0, 0, 0, 0, 0, 0xffff]);
  // IPv4-compatible ::a.b.c.d — only when there IS an embedded IPv4
  // (i.e. the low 32 bits are non-zero; `::`/`::1` are handled above).
  const isCompat =
    embedsAt([0, 0, 0, 0, 0, 0]) && (g[6] !== 0 || g[7] > 1);
  const isNat64 = embedsAt([0x64, 0xff9b, 0, 0, 0, 0]);
  if (!isMapped && !isCompat && !isNat64) return null;

  const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  return v4.join('.');
}

/** Thrown by `ssrfSafeFetch` when the target is rejected by the SSRF guard. */
export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`SSRF blocked: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

interface VettedOk {
  blocked: false;
  /**
   * The single IP address the connection will be pinned to. `null` only
   * when the guard is bypassed entirely via WEBHOOK_ALLOW_PRIVATE=true (no
   * pinning is performed in that case — self-hosters targeting internal
   * infra opt out of the whole guard, including pinning).
   */
  address: string | null;
  family: 4 | 6 | null;
}
interface VettedBlocked {
  blocked: true;
  reason: string;
}

/**
 * Resolve `urlString`'s hostname to its address(es), check every one against
 * the blocklist, and — critically — decide the SINGLE address that any
 * subsequent connection will use. This performs at most one real DNS query
 * per call; nothing downstream ever re-resolves.
 */
async function resolveVetted(urlString: string): Promise<VettedOk | VettedBlocked> {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === 'true') {
    return { blocked: false, address: null, family: null };
  }

  let hostname: string;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return { blocked: true, reason: 'invalid URL' };
  }

  // If the hostname is already a raw IP literal, no DNS is ever involved —
  // check it directly and pin to itself. WHATWG URL keeps IPv6 literals in
  // bracketed form (`[2001:db8::1]`) which net.isIP() rejects — strip the
  // brackets or every legitimate IPv6-literal URL fails closed at the
  // dns.lookup below (security review on 6fd9201, should-fix 2).
  const bareHost =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  if (net.isIP(bareHost)) {
    if (isBlockedIp(bareHost)) {
      return { blocked: true, reason: `IP ${bareHost} is in a blocked range` };
    }
    return { blocked: false, address: bareHost, family: net.isIPv6(bareHost) ? 6 : 4 };
  }

  // Resolve DNS to all addresses and check each one. This is the ONLY DNS
  // lookup performed for this call.
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    // DNS resolution failure — block (fail-closed; the host doesn't exist or
    // is unreachable; do not attempt to deliver).
    return { blocked: true, reason: `DNS lookup failed for ${hostname}: ${String(err)}` };
  }
  if (addresses.length === 0) {
    return { blocked: true, reason: `DNS lookup for ${hostname} returned no addresses` };
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return {
        blocked: true,
        reason: `Hostname ${hostname} resolved to blocked IP ${address}`,
      };
    }
  }

  // Pin to the FIRST resolved address. This exact address — never a fresh
  // lookup — is what the pinned connection below will use.
  const [pinned] = addresses;
  return { blocked: false, address: pinned.address, family: (pinned.family as 4 | 6) ?? (net.isIPv6(pinned.address) ? 6 : 4) };
}

/**
 * Back-compat, check-only entry point: resolves + vets a target and returns
 * just the yes/no decision, without performing a pinned request. Prefer
 * `ssrfSafeFetch` for anything that will actually connect — this exists for
 * call sites that only need the pre-flight decision.
 */
export async function resolveAndCheckBlocked(urlString: string): Promise<{ blocked: boolean; reason?: string }> {
  const result = await resolveVetted(urlString);
  return result.blocked ? { blocked: true, reason: result.reason } : { blocked: false };
}

/**
 * A `net.connect`/`tls.connect`-compatible `lookup` function that ignores
 * whatever hostname it is asked to resolve and unconditionally answers with
 * the single, already-vetted `address`/`family` it was built with.
 *
 * This is the structural fix for the DNS-rebinding TOCTOU: passing this as
 * an undici `Agent`'s `connect.lookup` means the connection undergoes ZERO
 * additional real DNS resolution — there is no second query left for a
 * short-TTL, rebinding nameserver to answer with a different (private) IP.
 *
 * Exported standalone so the pinning behaviour itself — not just the full
 * `ssrfSafeFetch` round trip — can be unit-tested directly (see
 * `ssrf-safe-fetch.spec.ts`).
 */
export function buildPinnedLookup(
  address: string,
  family: 4 | 6,
): (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) => void {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

/** Builds a single-use undici dispatcher pinned to `address`. */
function buildPinnedDispatcher(address: string, family: 4 | 6): Agent {
  return new Agent({
    connections: 1,
    pipelining: 0,
    // Each call gets its own single-use Agent — there is no pool to keep
    // warm, so idle sockets should self-close quickly rather than linger.
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1000,
    connect: {
      lookup: buildPinnedLookup(address, family),
    },
  });
}

/**
 * The single seam every outbound call this API makes to a user/admin
 * supplied URL MUST go through (webhook delivery, GitHub/GitLab live-status
 * polling, and any future outbound-call family). Resolves DNS exactly once,
 * checks the resolved address against the private/loopback/link-local
 * blocklist, then performs the actual request PINNED to that one vetted
 * address — closing the DNS-rebinding TOCTOU where a naive
 * "resolve-then-fetch" pattern lets a short-TTL attacker DNS record answer
 * the check with a public IP and the real connection with an internal one.
 *
 * `redirect` defaults to `'manual'` (never silently upgraded to `'follow'`)
 * so a 3xx response can never bounce the connection to an unvetted host.
 *
 * Throws `SsrfBlockedError` when the target is rejected — every current
 * caller already treats "can't reach this target" as a soft failure and
 * catches accordingly.
 */
export async function ssrfSafeFetch(urlString: string, init: RequestInit = {}): Promise<Response> {
  const vetted = await resolveVetted(urlString);
  if (vetted.blocked) {
    throw new SsrfBlockedError(vetted.reason);
  }

  const requestInit: RequestInit = { ...init, redirect: init.redirect ?? 'manual' };

  if (vetted.address === null) {
    // WEBHOOK_ALLOW_PRIVATE=true — guard fully bypassed, ordinary fetch (no
    // pinning is possible/meaningful when the operator has opted out).
    return fetch(urlString, requestInit);
  }

  const dispatcher = buildPinnedDispatcher(vetted.address, vetted.family!);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `dispatcher` is an undici-only fetch extension not in the DOM lib RequestInit type.
    return await fetch(urlString, { ...requestInit, dispatcher } as any);
  } finally {
    // Release the underlying socket back to the OS once undici is done with
    // it. `close()` gracefully drains any still-in-flight request on this
    // (single-use) agent before tearing down, so this never races a caller
    // that is still reading the response body after this promise settles.
    void dispatcher.close().catch(() => undefined);
  }
}
