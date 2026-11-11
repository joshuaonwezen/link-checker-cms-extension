import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

// Editors can put any URL in content, and the sidebar opens them automatically from the app's
// backend. Without this guard that is a way to probe internal hosts and cloud metadata
// (169.254.169.254) and read back what answered. Every outbound request to a URL that came
// from content goes through guardedFetch().
//
// Residual risk: DNS rebinding. The host is resolved and checked here, then fetch() resolves
// it again; a hostile DNS server can answer a public address first and a private one second.
// Closing that needs the checked address pinned into the connection (a custom undici
// dispatcher), which the runtime's built-in fetch doesn't expose. Only the status code ever
// comes back to the editor, never a response body.

export const USER_AGENT = 'Mozilla/5.0 (compatible; OptimizelyCmsLinkChecker/1.0)';

/** What one request answered: an HTTP status (and Location), or no answer at all. */
export type Answer = {status: number; location?: string | null} | {failure: 'timeout' | 'error' | 'redirects'};

/** Why a URL was not requested. */
export type Refusal = 'private' | 'numeric' | 'port' | 'credentials' | 'scheme';

export type Guarded = Answer | {refused: Refusal; host: string};

/** Every address a host name resolves to. */
export type Resolver = (host: string) => Promise<string[]>;

export interface OutboundDeps {
  resolve: Resolver;
  fetch: typeof fetch;
}

const systemDeps: OutboundDeps = {
  resolve: async (host) => (await lookup(host, {all: true})).map((a) => a.address),
  fetch: (input, init) => fetch(input, init),
};

const MAX_HOPS = 5;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal'];

// [network, prefix length]. 224.0.0.0/3 covers multicast, reserved and broadcast.
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];

function v4Number(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

const BLOCKED_V4_RANGES = BLOCKED_V4.map(([net, bits]) => ({start: v4Number(net)!, size: 2 ** (32 - bits)}));

function isPublicV4(n: number): boolean {
  return !BLOCKED_V4_RANGES.some(({start, size}) => n >= start && n < start + size);
}

/** The eight 16-bit groups of an IPv6 address, or null when it can't be read. */
function v6Groups(ip: string): number[] | null {
  let s = ip.split('%')[0].toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4Number(tail[1]);
    if (n === null) return null;
    s = `${s.slice(0, -tail[1].length)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 2 && fill === 0)) return null;
  const groups = [...left, ...new Array<string>(fill).fill('0'), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// An allow-list: only global unicast (2000::/3) passes, so ::, ::1, fc00::/7 (ULA),
// fe80::/10 (link-local) and ff00::/8 (multicast) are all refused. Forms that carry an IPv4
// address are judged by that address.
function isPublicV6(g: number[]): boolean {
  const embedded = g[6] * 65536 + g[7];
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible; also covers :: and ::1).
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embedded);
  // 64:ff9b::a.b.c.d (NAT64).
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPublicV4(embedded);
  // 2002:aabb:ccdd:: (6to4).
  if (g[0] === 0x2002) return isPublicV4(g[1] * 65536 + g[2]);
  if ((g[0] & 0xe000) !== 0x2000) return false;
  // 2001::/32 (Teredo, hides the IPv4 address it tunnels to) and 2001:db8::/32 (documentation).
  return !(g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8));
}

/** True only for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip.split('%')[0]);
  if (family === 4) return isPublicV4(v4Number(ip)!);
  if (family === 6) {
    const groups = v6Groups(ip);
    return groups !== null && isPublicV6(groups);
  }
  return false;
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

function isPrivateName(host: string): boolean {
  // A single label ("intranet", "metadata") only resolves through a local search domain.
  if (!host.includes('.')) return true;
  return PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Why the URL itself may not be requested, before any DNS lookup; null when it may. */
export function refusal(url: URL): Refusal | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'scheme';
  const host = bareHost(url);
  const literal = isIP(host) !== 0;
  // A private host first: it is the most useful thing to tell the editor.
  if (literal ? !isPublicAddress(host) : isPrivateName(host)) return 'private';
  if (url.username || url.password) return 'credentials';
  if (!ALLOWED_PORTS.has(url.port)) return 'port';
  return literal ? 'numeric' : null;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * refusal() plus DNS: every address the host resolves to must be public, so one private
 * record among public ones is enough to refuse. Throws when the host doesn't resolve.
 */
export async function screen(url: URL, resolve: Resolver, signal: AbortSignal): Promise<Refusal | null> {
  const early = refusal(url);
  if (early) return early;
  const addresses = await abortable(resolve(bareHost(url)), signal);
  if (addresses.length === 0) throw new Error('The host has no addresses');
  return addresses.every(isPublicAddress) ? null : 'private';
}

function failureOf(error: unknown): Answer {
  return {failure: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error'};
}

/**
 * Requests `start` with redirects off, following up to five of them itself so each new
 * Location is screened before it is requested. `timeoutMs` covers every hop.
 */
export async function guardedFetch(
  start: string,
  method: 'HEAD' | 'GET',
  {timeoutMs, onRequest}: {timeoutMs: number; onRequest?: (url: URL) => void},
  deps: OutboundDeps = systemDeps,
): Promise<Guarded> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    return {failure: 'error'};
  }
  for (let hop = 0; ; hop++) {
    try {
      const refused = await screen(url, deps.resolve, signal);
      if (refused) return {refused, host: bareHost(url)};
    } catch (error) {
      return failureOf(error);
    }
    onRequest?.(url);
    let res: Response;
    try {
      res = await deps.fetch(url, {method, redirect: 'manual', headers: {'User-Agent': USER_AGENT}, signal});
    } catch (error) {
      return failureOf(error);
    }
    void res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return {status: res.status, location};
    if (hop === MAX_HOPS) return {failure: 'redirects'};
    try {
      url = new URL(location, url);
    } catch {
      return {status: res.status, location};
    }
  }
}
