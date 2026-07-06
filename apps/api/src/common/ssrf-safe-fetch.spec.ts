import * as http from 'node:http';
import * as dns from 'node:dns';
import * as os from 'node:os';
import {
  buildPinnedLookup,
  isBlockedIp,
  resolveAndCheckBlocked,
  ssrfSafeFetch,
  SsrfBlockedError,
} from './ssrf-safe-fetch';

/**
 * Hardening Night pass 13, Risk 3 (docs/AUDIT-ENGINEERING.md): the original
 * `resolveAndCheckBlocked` + raw `fetch()` pattern resolved DNS once to vet
 * a target, then let `fetch()` re-resolve DNS itself — a DNS-rebinding
 * attacker could answer the vetting query with a public IP and the real
 * connection query with an internal one (169.254.169.254, 127.0.0.1, ...).
 *
 * These tests prove the fix: `ssrfSafeFetch` performs exactly ONE DNS
 * resolution per call and PINS the actual connection to that one address —
 * there is no second query left for a rebinding nameserver to answer
 * differently.
 */

// The container's own non-loopback interface address, in the RFC 5737
// TEST-NET-1 documentation range (192.0.2.0/24) — NOT in any range
// `isBlockedIp` blocks (only 192.168.0.0/16 is), and genuinely bindable +
// self-reachable in this sandbox (unlike a real public IP, which nothing
// here can route to). Falls back to loopback-adjacent skip if unavailable
// so this suite is not sandbox-topology-fragile.
function findNonLoopbackAddress(): string | null {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal && !isBlockedIp(info.address)) {
        return info.address;
      }
    }
  }
  return null;
}

describe('buildPinnedLookup', () => {
  it('answers the non-`all` shape with the pinned address regardless of the requested hostname', () => {
    const lookup = buildPinnedLookup('203.0.113.9', 4);
    const cb = jest.fn();
    lookup('totally-different-hostname.attacker.test', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '203.0.113.9', 4);
  });

  it('answers the `all: true` shape with a single-element array of the pinned address', () => {
    const lookup = buildPinnedLookup('203.0.113.9', 4);
    const cb = jest.fn();
    lookup('another-hostname.attacker.test', { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: '203.0.113.9', family: 4 }]);
  });

  it('never touches node:dns — it is a pure function with no real resolution capability', () => {
    const dnsLookupSpy = jest.spyOn(dns.promises, 'lookup');
    const lookup = buildPinnedLookup('198.51.100.1', 4);
    lookup('whatever.test', { all: true }, jest.fn());
    lookup('whatever.test', {}, jest.fn());
    expect(dnsLookupSpy).not.toHaveBeenCalled();
    dnsLookupSpy.mockRestore();
  });

  it('ignores the hostname argument even across repeated calls with different hosts', () => {
    const lookup = buildPinnedLookup('198.51.100.1', 4);
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    lookup('first.example', {}, cb1);
    lookup('second.example', {}, cb2);
    expect(cb1).toHaveBeenCalledWith(null, '198.51.100.1', 4);
    expect(cb2).toHaveBeenCalledWith(null, '198.51.100.1', 4);
  });
});

describe('ssrfSafeFetch — DNS-rebinding TOCTOU regression', () => {
  const vettedAddress = findNonLoopbackAddress();
  const maybeIt = vettedAddress ? it : it.skip;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  maybeIt(
    'pins the connection to the first-resolved address and never re-resolves, even when a simulated rebind would answer a second query with a private IP',
    async () => {
      // A real local server bound to the "vetted" address — standing in for
      // the legitimate destination the first (only) DNS resolution names.
      const server = http.createServer((_req, res) => {
        res.end('vetted-server-response');
      });
      await new Promise<void>((resolve) => server.listen(0, vettedAddress!, resolve));
      const port = (server.address() as { port: number }).port;

      try {
        let callCount = 0;
        jest
          .spyOn(dns.promises, 'lookup')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .mockImplementation((async () => {
            callCount += 1;
            if (callCount === 1) {
              // The ONLY resolution ssrfSafeFetch is allowed to perform:
              // answers with the vetted, non-blocked address.
              return [{ address: vettedAddress!, family: 4 }];
            }
            // A rebinding nameserver would answer any FURTHER query with an
            // internal address. If ssrfSafeFetch ever re-resolved, it would
            // connect here instead — nothing is listening on this address for
            // this hostname/port, so the request would fail rather than
            // silently succeed against a rebind target.
            return [{ address: '169.254.169.254', family: 4 }];
          }) as any);

        const res = await ssrfSafeFetch(`http://rebind-attacker.test:${port}/`, {
          method: 'GET',
        });

        expect(await res.text()).toBe('vetted-server-response');
        // Exactly one DNS query for the entire call — no re-resolution
        // window exists for a rebinding nameserver to exploit.
        expect(dns.promises.lookup).toHaveBeenCalledTimes(1);
      } finally {
        server.close();
      }
    },
  );

  it('fails closed when the (single) resolution is already a blocked address', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);

    await expect(ssrfSafeFetch('http://metadata.internal/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(dns.promises.lookup).toHaveBeenCalledTimes(1);
  });

  it('fails closed on DNS resolution failure rather than falling back to an unvetted connection', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));

    await expect(ssrfSafeFetch('http://does-not-exist.invalid/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('rejects a raw blocked IP literal without ever touching dns.lookup', async () => {
    const dnsLookupSpy = jest.spyOn(dns.promises, 'lookup');
    await expect(ssrfSafeFetch('http://127.0.0.1/hook')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(dnsLookupSpy).not.toHaveBeenCalled();
  });

  it('defaults redirect to "manual" so a 3xx cannot bounce to an unvetted host', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await ssrfSafeFetch('https://example.test/hook');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/hook',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('honours an explicit redirect override when the caller sets one', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

    await ssrfSafeFetch('https://example.test/hook', { redirect: 'error' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/hook',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('WEBHOOK_ALLOW_PRIVATE=true bypasses the guard entirely (no pinning, ordinary fetch)', async () => {
    const prev = process.env.WEBHOOK_ALLOW_PRIVATE;
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    try {
      const dnsLookupSpy = jest.spyOn(dns.promises, 'lookup');
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('ok', { status: 200 }));

      const res = await ssrfSafeFetch('http://192.168.1.100/hook');

      expect(await res.text()).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://192.168.1.100/hook',
        expect.objectContaining({ redirect: 'manual' }),
      );
      // No DNS resolution is even attempted when the guard is bypassed.
      expect(dnsLookupSpy).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = prev;
    }
  });
});

describe('resolveAndCheckBlocked (back-compat check-only entry point)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports blocked for a private IP literal', async () => {
    await expect(resolveAndCheckBlocked('http://10.0.0.5/')).resolves.toMatchObject({
      blocked: true,
    });
  });

  it('reports not blocked for a resolved public address', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(resolveAndCheckBlocked('https://example.test/')).resolves.toEqual({
      blocked: false,
    });
  });
});

describe('isBlockedIp (re-exported for both webhooks.service.ts and this module)', () => {
  it('blocks the AWS metadata endpoint', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
  });

  it('allows a public address', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
});

/**
 * IPv4-embedded IPv6 coverage (security review on 6fd9201, must-fix 1): an
 * AAAA record of ::ffff:169.254.169.254 previously passed the IPv6 branch —
 * and the pin then faithfully connected to the metadata IP. Every embedded
 * form must re-run the IPv4 blocklist on the inner address.
 */
describe('isBlockedIp — IPv4-embedded IPv6 forms', () => {
  it.each([
    ['::ffff:127.0.0.1', 'mapped loopback (dotted)'],
    ['::ffff:169.254.169.254', 'mapped AWS metadata (dotted)'],
    ['::ffff:10.0.0.1', 'mapped private class A (dotted)'],
    ['::ffff:192.168.1.1', 'mapped private class C (dotted)'],
    ['::ffff:a9fe:a9fe', 'mapped AWS metadata (pure hex form)'],
    ['::ffff:7f00:1', 'mapped loopback (pure hex form)'],
    ['::127.0.0.1', 'deprecated IPv4-compatible loopback'],
    ['64:ff9b::a9fe:a9fe', 'NAT64-embedded AWS metadata'],
    ['64:ff9b::7f00:1', 'NAT64-embedded loopback'],
    ['::', 'unspecified address'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ['::ffff:93.184.216.34', 'mapped PUBLIC IPv4 stays allowed (dotted)'],
    ['64:ff9b::5db8:d822', 'NAT64-embedded PUBLIC IPv4 stays allowed'],
    ['2001:db8::1', 'plain global-unicast IPv6 unaffected'],
    ['2606:4700:4700::1111', 'public resolver IPv6 unaffected'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

/**
 * Bracketed IPv6 literal URLs (security review on 6fd9201, should-fix 2):
 * WHATWG URL keeps IPv6 hostnames bracketed, which net.isIP() rejects — the
 * old code fell through to dns.lookup('[::1]') and failed closed even for
 * legitimate public IPv6 literals.
 */
describe('ssrfSafeFetch — bracketed IPv6 literals', () => {
  it('rejects a bracketed blocked IPv6 literal as a blocked IP (not a DNS error)', async () => {
    await expect(ssrfSafeFetch('http://[::1]:8080/hook')).rejects.toThrow(
      /blocked range/,
    );
  });

  it('rejects a bracketed IPv4-mapped metadata literal as blocked', async () => {
    await expect(
      ssrfSafeFetch('http://[::ffff:169.254.169.254]/latest/meta-data/'),
    ).rejects.toThrow(/blocked range/);
  });
});
