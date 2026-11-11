import {logger} from '@zaiusinc/app-sdk';

import type {ActionParams, CheckedLink, CheckOutcome, FoundLink} from '../../shared/types';
import {CmsClient, type CmsItem, type CmsVersion} from './cms';
import {collectLinks, contentKeyOf, contentTypesIn, type TypeInfo} from './collect';
import {ActionError} from './errors';
import {publishedItem, type PublishedItem} from './graph';
import {guardedFetch, screen, systemDeps, USER_AGENT, type Answer, type OutboundDeps, type Refusal} from './outbound';
import {normalizeSiteUrl, type LoadedSettings} from './settings';
import {pickSiteUrl, siteOrigins} from './siteUrl';
import {byVerdict, isCosmeticRedirect, judgeExternal, judgeInternal, type Judgement} from './verdict';

const MAX_LINKS = 60;
const MAX_SHARED_BLOCKS = 25;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 8_000;
// Stay well inside the function's time limit, counted from the start of the run: shared
// blocks and links not started by then are skipped, and the links reported unchecked.
const BUDGET_MS = 25_000;
const KEY = /^[0-9a-f]{32}$/i;
const MAX_COSMETIC_HOPS = 3;

// Editors read these; only a CMS admin can act on them.
const SITE_UNKNOWN =
  "This CMS has more than one site and this page's address isn't one of them. Ask a CMS admin to set the Site URL in the app settings.";
const SITE_REFUSED =
  "This page's site address isn't a public https address, so the link checker won't open it. Ask a CMS admin to check the site's host in CMS Settings > Applications, or to set the Site URL in the app settings.";
const OVERRIDE_REFUSED =
  "The Site URL in the app settings doesn't lead to a public address any more. Ask a CMS admin to check it.";

/** The CMS calls the checker makes. */
export type CmsApi = Pick<CmsClient, 'getItem' | 'listVersions' | 'getVersion' | 'getContentType' | 'listApplications'>;

export interface CheckerDeps {
  cms?: CmsApi;
  /** DNS and fetch for every request the checker sends to a site. */
  outbound?: OutboundDeps;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

function once<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = load(key);
      cache.set(key, hit);
    }
    return hit;
  };
}

class Types {
  private readonly known = new Map<string, TypeInfo | null>();

  public constructor(private readonly cms: CmsApi) {}

  public async load(keys: Iterable<string | undefined>): Promise<void> {
    const missing = [...new Set(keys)].filter((k): k is string => Boolean(k) && !this.known.has(k!));
    await mapLimit(missing, CONCURRENCY, async (key) => this.known.set(key, await this.cms.getContentType(key)));
  }

  public readonly lookup = (key: string | undefined): TypeInfo | undefined => (key ? this.known.get(key) ?? undefined : undefined);
}

function parseUrl(href: string, base?: URL): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** "Dutch" for nl, falling back to the code. */
function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], {type: 'language'}).of(locale.replace(/_/g, '-')) ?? locale;
  } catch {
    return locale;
  }
}

/** One request to the site (never anywhere else), redirects off. */
async function answerFromSite(url: URL, fetchFn: typeof fetch): Promise<Answer> {
  try {
    const res = await fetchFn(url, {
      redirect: 'manual',
      headers: {'User-Agent': USER_AGENT},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    void res.body?.cancel().catch(() => undefined);
    return {status: res.status, location: res.headers.get('location')};
  } catch (error) {
    return {failure: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error'};
  }
}

/**
 * A site path as a URL on the site: appended to the origin, never resolved against it, so a
 * path that starts "//host" or "/\host" stays on the site instead of naming another host.
 */
export function sitePage(site: URL, path: string): URL | null {
  const url = parseUrl(`${site.origin}${path.startsWith('/') ? '' : '/'}${path}`);
  return url && url.origin === site.origin ? url : null;
}

/** A target as stored, classified for checking. */
export function classify(target: string, siteUrl: string):
  | {type: 'content'; key: string}
  | {type: 'internal'; path: string}
  | {type: 'external'; url: string}
  | {type: 'dam'}
  | {type: 'relative'} {
  const key = contentKeyOf(target);
  if (key) return {type: 'content', key};
  if (/^cms:\/\//i.test(target)) return {type: 'dam'};
  if (!/^(\/|https?:\/\/)/i.test(target)) return {type: 'relative'};
  // Resolved the way a browser on the site would: "//host/x" and "/\host/x" leave the site.
  const site = new URL(siteUrl);
  const url = parseUrl(target, site);
  if (!url) return {type: 'relative'};
  if (url.origin === site.origin) return {type: 'internal', path: `${url.pathname}${url.search}`};
  return {type: 'external', url: url.href};
}

/**
 * The site to open internal links on, for one request: the saved Site URL when there is one,
 * else the open page's own site, or the only site, from the CMS's application hosts (see
 * pickSiteUrl). Either way it must pass the guard a saved Site URL passes - https, a public
 * host name, every address it resolves to public - since an application host can be
 * misconfigured too.
 */
export async function resolveSite(
  cfg: Pick<LoadedSettings, 'siteUrl' | 'cms'>,
  publicUrl: string | null,
  cms: Pick<CmsApi, 'listApplications'>,
  outbound: Pick<OutboundDeps, 'resolve'> = systemDeps,
): Promise<URL> {
  // The override needs no list: pickSiteUrl would return it whatever the CMS says.
  const picked = cfg.siteUrl || pickSiteUrl('', publicUrl, await siteOrigins(cfg.cms.clientId, () => cms.listApplications()));
  if (!picked) throw new ActionError('site_unknown', SITE_UNKNOWN);
  const refusedMessage = cfg.siteUrl ? OVERRIDE_REFUSED : SITE_REFUSED;
  const normalized = normalizeSiteUrl(picked);
  if (!normalized) throw new ActionError('site_refused', refusedMessage);
  const site = new URL(normalized);
  let refused: Refusal | null = null;
  try {
    refused = await screen(site, outbound.resolve, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  } catch {
    // The name doesn't resolve right now: each request then fails on its own, reported per link.
  }
  if (refused) throw new ActionError('site_refused', refusedMessage);
  return site;
}

export interface Checker {
  checkLinks(params: ActionParams['checkLinks']): Promise<CheckOutcome>;
}

export function createChecker(cfg: LoadedSettings, deps: CheckerDeps = {}): Checker {
  const cms = deps.cms ?? new CmsClient(cfg.cms);
  const outbound = deps.outbound ?? systemDeps;
  const hosts = {checked: new Set<string>(), refused: new Set<string>()};
  const item = once((key: string) => cms.getItem(key));
  const published = once((id: string) => {
    const [key, locale] = id.split('|');
    return publishedItem(cfg.graph, key, locale);
  });
  const draftName = once(async (id: string) => {
    const [key, locale] = id.split('|');
    try {
      return (await cms.listVersions(key, locale, 1))[0]?.displayName || undefined;
    } catch {
      // Only a label: never fail the run over it.
      return undefined;
    }
  });
  const external = once(async (url: string) => {
    const options = {timeoutMs: REQUEST_TIMEOUT_MS, onRequest: (u: URL) => hosts.checked.add(u.hostname)};
    let result = await guardedFetch(url, 'HEAD', options, outbound);
    // Plenty of sites refuse HEAD; ask again the way a browser would.
    if ('status' in result && [400, 403, 405, 501].includes(result.status)) result = await guardedFetch(url, 'GET', options, outbound);
    if ('refused' in result) hosts.refused.add(result.host);
    return judgeExternal(result);
  });

  /** The checks that open pages on `site`, the site resolved for this request. */
  function onSite(site: URL) {
    /** `href` (a path or a URL) on the site, or null when it leads anywhere else. */
    const within = (href: string): URL | null => {
      const url = parseUrl(href, site);
      return url && url.origin === site.origin ? url : null;
    };

    const internal = once(async (path: string): Promise<Judgement> => {
      const start = sitePage(site, path);
      if (!start) return {verdict: 'unchecked', status: "Not checked: the address can't be read"};
      let current = start;
      // Follow slash and case redirects (/en/about/ -> /en/about): what counts is where they land.
      for (let hop = 0; ; hop++) {
        const here = `${current.pathname}${current.search}`;
        const result = await answerFromSite(current, outbound.fetch);
        const location = 'status' in result && result.status >= 300 && result.status < 400 ? result.location : null;
        const next = location ? parseUrl(location, current) : null;
        if (!location || !next || next.origin !== site.origin || hop === MAX_COSMETIC_HOPS || !isCosmeticRedirect(here, location)) {
          return judgeInternal(here, result, site.origin);
        }
        current = next;
      }
    });

    async function judgePage(path: string): Promise<Judgement & {openUrl?: string}> {
      const j = await internal(path);
      // A redirect off the site resolves to a full URL; everything else is a site path.
      const openUrl = j.resolved && !j.resolved.startsWith('/') ? j.resolved : sitePage(site, j.resolved ?? path)?.href;
      return {...j, openUrl};
    }

    async function judgeContent(link: FoundLink, key: string, locale: string): Promise<Partial<CheckedLink> & Judgement> {
      const isLink = link.kind === 'link';
      if (!(await item(key))) {
        return isLink
          ? {
              verdict: 'broken',
              status: 'Deleted',
              hint: "It points at content that was deleted, so the site doesn't show the link. Pick the target again, or remove the link.",
            }
          : {verdict: 'broken', status: 'Deleted', hint: 'This leaves a gap on the page. Remove it, or pick other content.'};
      }
      const live: PublishedItem | null = await published(`${key}|${locale}`);
      if (!live) {
        const name = await draftName(`${key}|${locale}`);
        const language = languageName(locale);
        return isLink
          ? {
              verdict: 'broken',
              status: 'Not published',
              name,
              hint: `The site hides links to pages visitors can't see. Publish it in ${language}, or link to another page.`,
            }
          : {verdict: 'warning', status: 'Not published', name, hint: `Visitors don't see it until it is published in ${language}.`};
      }
      const name = live.displayName;
      if (live.url && (isLink || live.isPage)) {
        const url = within(live.url);
        if (url) {
          const path = `${url.pathname}${url.search}`;
          return {...(await judgePage(path)), name, resolved: path};
        }
        // The CMS gives the page an address on another host, and the site links there as is.
        const href = parseUrl(live.url)?.href;
        if (!href) return {verdict: 'unchecked', status: "Not checked: the page's address can't be read", name};
        return {...(await external(href)), name, resolved: href, openUrl: href};
      }
      if (isLink) return {verdict: 'warning', status: 'Not a page', name, hint: 'Only pages can be linked to. Pick a page instead.'};
      return {verdict: 'ok', status: 'Published', name};
    }

    return async function judge(link: FoundLink, locale: string, deadline: number): Promise<CheckedLink> {
      if (Date.now() > deadline) {
        return {...link, verdict: 'unchecked', status: 'Not checked: ran out of time', hint: 'Check again to pick up the rest.'};
      }
      const target = classify(link.target, site.href);
      switch (target.type) {
        case 'content':
          return {...link, ...(await judgeContent(link, target.key, locale))};
        case 'internal':
          return {...link, ...(await judgePage(target.path))};
        case 'external':
          return {...link, ...(await external(target.url)), openUrl: target.url};
        case 'dam':
          return {...link, verdict: 'ok', status: 'From the asset library'};
        case 'relative':
          return {...link, verdict: 'warning', status: 'Incomplete address', hint: 'Start it with / or https:// so it works on every page.'};
      }
    };
  }

  async function sharedBlockLinks(found: FoundLink[], locale: string, types: Types, deadline: number) {
    const keys = [...new Set(found.filter((l) => l.kind === 'reference').map((l) => contentKeyOf(l.target)))]
      .filter((k): k is string => Boolean(k))
      .slice(0, MAX_SHARED_BLOCKS);
    let blocks = 0;
    const links = (
      await mapLimit(keys, CONCURRENCY, async (key) => {
        if (Date.now() > deadline) return [];
        const it: CmsItem | null = await item(key);
        if (!it?.contentType) return [];
        await types.load([it.contentType]);
        if (types.lookup(it.contentType)?.baseType !== '_component') return [];
        const locales = (it.locales ?? []).filter(Boolean);
        const loc = locales.includes(locale) ? locale : it.primaryLocale || locales[0];
        if (!loc) return [];
        const version = (await cms.listVersions(key, loc)).find((v) => v.status === 'published' && !v.variation);
        if (!version) return [];
        await types.load(contentTypesIn(version));
        blocks++;
        return collectLinks(version, types.lookup, `${version.displayName || it.contentType} (shared block)`);
      })
    ).flat();
    return {links, blocks};
  }

  return {
    async checkLinks({key, version: requested, locale: editorLocale, publicUrl}) {
      const deadline = Date.now() + BUDGET_MS;
      if (!KEY.test(key)) throw new ActionError('invalid_input', 'key: not a CMS content key.');
      const it = await item(key);
      if (!it) throw new ActionError('not_found', 'This item no longer exists in the CMS - it may have just been deleted.');
      const locales = (it.locales ?? []).filter(Boolean);
      if (locales.length === 0) return {kind: 'nothing', reason: 'Images, media and folders have no links to check.'};
      const locale = locales.includes(editorLocale) ? editorLocale : it.primaryLocale || locales[0];

      let version: CmsVersion | null = requested ? await cms.getVersion(key, requested) : null;
      version ??= (await cms.listVersions(key, locale, 1))[0] ?? null;
      if (!version) return {kind: 'nothing', reason: `This item has no ${languageName(locale)} version yet.`};
      if (version.variation) {
        const base = (await cms.listVersions(key, version.locale || locale, 50)).filter((v) => !v.variation);
        const original = base.find((v) => v.status === 'published') ?? base[0];
        return {kind: 'variation', variation: version.variation, baseVersion: original?.version ?? null};
      }

      const types = new Types(cms);
      await types.load([version.contentType, ...contentTypesIn(version)]);
      const found = collectLinks(version, types.lookup);
      // Each shared block costs a few requests: once the budget is spent, check what was found.
      const shared =
        Date.now() < deadline ? await sharedBlockLinks(found, version.locale || locale, types, deadline) : {links: [], blocks: 0};

      const all = [...found, ...shared.links];
      // Resolved per request, and only when there is something to open on it.
      const judge = all.length > 0 ? onSite(await resolveSite(cfg, publicUrl, cms, outbound)) : null;
      const checked = judge
        ? await mapLimit(all.slice(0, MAX_LINKS), CONCURRENCY, (link) => judge(link, version.locale || locale, deadline))
        : [];
      // Host names only: paths and query strings can carry tokens.
      if (hosts.checked.size || hosts.refused.size) {
        logger.info('checkLinks external hosts', {checked: [...hosts.checked].sort(), refused: [...hosts.refused].sort()});
      }
      return {
        kind: 'checked',
        result: {
          key,
          version: version.version,
          locale: version.locale || locale,
          displayName: version.displayName || 'Untitled',
          links: checked.sort(byVerdict),
          skipped: Math.max(0, all.length - MAX_LINKS),
          sharedBlocks: shared.blocks,
          checkedAt: new Date().toISOString(),
        },
      };
    },
  };
}
