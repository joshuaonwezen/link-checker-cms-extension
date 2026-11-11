import {describe, expect, it, vi} from 'vitest';

import {guardedFetch, isPublicAddress, refusal, screen, type OutboundDeps} from './outbound';

const PUBLIC = '93.184.216.34';

/** A resolver that answers from a fixed table, like a DNS server would. */
function resolver(table: Record<string, string[]>) {
  return vi.fn(async (host: string) => {
    const addresses = table[host];
    if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {code: 'ENOTFOUND'});
    return addresses;
  });
}

function response(status: number, location?: string): Response {
  return new Response(null, {status, headers: location ? {location} : {}});
}

const never = new AbortController().signal;

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, CGNAT, unspecified, multicast and reserved IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('refuses loopback, ULA, link-local and IPv4-mapped private IPv6', () => {
    for (const ip of ['::', '::1', 'fd00::1', 'fc00::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a00:1::1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it('allows public addresses', () => {
    for (const ip of [PUBLIC, '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:93.184.216.34']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it('refuses anything that is not an address', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('refusal', () => {
  it('refuses IP literals, private names, odd ports, credentials and other schemes before any lookup', () => {
    expect(refusal(new URL('http://127.0.0.1/'))).toBe('private');
    expect(refusal(new URL('http://169.254.169.254/latest/meta-data/'))).toBe('private');
    expect(refusal(new URL('http://[::1]/'))).toBe('private');
    expect(refusal(new URL('http://[::ffff:10.0.0.1]/'))).toBe('private');
    // The URL parser turns these spellings into 127.0.0.1 first.
    expect(refusal(new URL('http://2130706433/'))).toBe('private');
    expect(refusal(new URL('http://0x7f.1/'))).toBe('private');
    expect(refusal(new URL(`https://${PUBLIC}/`))).toBe('numeric');
    expect(refusal(new URL('http://localhost/'))).toBe('private');
    expect(refusal(new URL('http://app.localhost./'))).toBe('private');
    expect(refusal(new URL('http://printer.local/'))).toBe('private');
    expect(refusal(new URL('http://metadata.google.internal/'))).toBe('private');
    expect(refusal(new URL('http://intranet/'))).toBe('private');
    expect(refusal(new URL('https://example.com:8080/'))).toBe('port');
    expect(refusal(new URL('https://user:secret@example.com/'))).toBe('credentials');
    expect(refusal(new URL('ftp://example.com/'))).toBe('scheme');
    expect(refusal(new URL('https://example.com:443/'))).toBeNull();
    expect(refusal(new URL('http://example.com:80/'))).toBeNull();
  });
});

describe('screen', () => {
  it('refuses a name that resolves to a private address, even alongside public ones', async () => {
    const resolve = resolver({
      'loopback.example': ['127.0.0.1'],
      'private.example': ['10.1.2.3'],
      'metadata.example': ['169.254.169.254'],
      'v6.example': ['::1'],
      'ula.example': ['fd00::1'],
      'mapped.example': ['::ffff:10.0.0.1'],
      'mixed.example': [PUBLIC, '10.0.0.5'],
      'public.example': [PUBLIC, '2606:4700:4700::1111'],
    });
    for (const host of ['loopback', 'private', 'metadata', 'v6', 'ula', 'mapped', 'mixed']) {
      expect(await screen(new URL(`https://${host}.example/`), resolve, never), host).toBe('private');
    }
    expect(await screen(new URL('https://public.example/'), resolve, never)).toBeNull();
  });

  it('never looks up a URL it can refuse as written', async () => {
    const resolve = resolver({});
    expect(await screen(new URL('http://localhost/'), resolve, never)).toBe('private');
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('guardedFetch', () => {
  function deps(table: Record<string, string[]>, answers: Record<string, Response>): OutboundDeps & {fetch: ReturnType<typeof vi.fn>} {
    return {
      resolve: resolver(table),
      fetch: vi.fn(async (input: string | URL | Request) => answers[String(input)] ?? response(404)),
    };
  }

  it('allows a public address on 443 and reports its status', async () => {
    const d = deps({'site.example': [PUBLIC]}, {'https://site.example/a': response(200)});
    const onRequest = vi.fn();
    expect(await guardedFetch('https://site.example/a', 'HEAD', {timeoutMs: 1000, onRequest}, d)).toEqual({status: 200, location: null});
    expect(d.fetch).toHaveBeenCalledWith(new URL('https://site.example/a'), expect.objectContaining({method: 'HEAD', redirect: 'manual'}));
    expect(onRequest).toHaveBeenCalledWith(new URL('https://site.example/a'));
  });

  it('refuses private targets without sending a request', async () => {
    const d = deps({'internal.example': ['10.1.2.3']}, {});
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/', 'https://internal.example/', 'http://[fd00::1]/']) {
      expect(await guardedFetch(url, 'GET', {timeoutMs: 1000}, d), url).toMatchObject({refused: 'private'});
    }
    expect(await guardedFetch('https://site.example:8080/', 'GET', {timeoutMs: 1000}, d)).toMatchObject({refused: 'port'});
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('screens every redirect: one into 127.0.0.1 is refused, not followed', async () => {
    const d = deps(
      {'site.example': [PUBLIC], 'sneaky.example': ['127.0.0.1']},
      {
        'https://site.example/go': response(302, 'http://127.0.0.1/admin'),
        'https://site.example/hop': response(301, '//sneaky.example/admin'),
      },
    );
    expect(await guardedFetch('https://site.example/go', 'GET', {timeoutMs: 1000}, d)).toEqual({refused: 'private', host: '127.0.0.1'});
    expect(await guardedFetch('https://site.example/hop', 'GET', {timeoutMs: 1000}, d)).toEqual({refused: 'private', host: 'sneaky.example'});
    expect(d.fetch).toHaveBeenCalledTimes(2);
  });

  it('follows relative redirects and stops after five hops', async () => {
    const d = deps(
      {'site.example': [PUBLIC]},
      {'https://site.example/old': response(301, '/new'), 'https://site.example/new': response(200)},
    );
    expect(await guardedFetch('https://site.example/old', 'GET', {timeoutMs: 1000}, d)).toEqual({status: 200, location: null});

    const loop = deps({'loop.example': [PUBLIC]}, {});
    loop.fetch.mockImplementation(async () => response(302, '/again'));
    expect(await guardedFetch('https://loop.example/', 'GET', {timeoutMs: 1000}, loop)).toEqual({failure: 'redirects'});
    expect(loop.fetch).toHaveBeenCalledTimes(6);
  });

  it('reports a host that does not resolve as unreachable', async () => {
    const d = deps({}, {});
    expect(await guardedFetch('https://nowhere.example/', 'GET', {timeoutMs: 1000}, d)).toEqual({failure: 'error'});
  });
});
