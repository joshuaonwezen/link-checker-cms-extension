import type {CheckedLink, CheckOutcome, FoundLink} from '../../shared/types';
import {CmsClient, type CmsItem, type CmsVersion} from './cms';
import {collectLinks, contentKeyOf, contentTypesIn, type TypeInfo} from './collect';
import {publishedItem, type PublishedItem} from './graph';
import type {LoadedSettings} from './settings';
import {byVerdict, isCosmeticRedirect, judgeExternal, judgeInternal, type Answer, type Judgement} from './verdict';

export class ActionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

const MAX_LINKS = 60;
const MAX_SHARED_BLOCKS = 25;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 8_000;
// Stay well inside the function's time limit: links not started by then are reported unchecked.
const BUDGET_MS = 25_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; OptimizelyCmsLinkChecker/1.0)';
const KEY = /^[0-9a-f]{32}$/i;
const MAX_COSMETIC_HOPS = 3;

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

  public constructor(private readonly cms: CmsClient) {}

  public async load(keys: Iterable<string | undefined>): Promise<void> {
    const missing = [...new Set(keys)].filter((k): k is string => Boolean(k) && !this.known.has(k!));
    await mapLimit(missing, CONCURRENCY, async (key) => this.known.set(key, await this.cms.getContentType(key)));
  }

  public readonly lookup = (key: string | undefined): TypeInfo | undefined => (key ? this.known.get(key) ?? undefined : undefined);
}

async function answer(url: string, init: RequestInit): Promise<Answer> {
  try {
    const res = await fetch(url, {...init, headers: {'User-Agent': USER_AGENT}, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    void res.body?.cancel();
    return {status: res.status, location: res.headers.get('location')};
  } catch (error) {
    return {failure: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error'};
  }
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
  if (target.startsWith('//')) return {type: 'external', url: `https:${target}`};
  if (target.startsWith('/')) return {type: 'internal', path: target};
  if (/^https?:\/\//i.test(target)) {
    const site = new URL(siteUrl);
    try {
      const url = new URL(target);
      if (url.origin === site.origin) return {type: 'internal', path: `${url.pathname}${url.search}`};
    } catch {
      return {type: 'relative'};
    }
    return {type: 'external', url: target};
  }
  return {type: 'relative'};
}

export interface Checker {
  checkLinks(params: {key: string; version: string | null; locale: string}): Promise<CheckOutcome>;
}

export function createChecker(cfg: LoadedSettings): Checker {
  const cms = new CmsClient(cfg.cms);
  const item = once((key: string) => cms.getItem(key));
  const published = once((id: string) => {
    const [key, locale] = id.split('|');
    return publishedItem(cfg.graph, key, locale);
  });
  const internal = once(async (path: string) => {
    // Follow slash and case redirects (/en/about/ -> /en/about): what counts is where they land.
    let current = path;
    for (let hop = 0; ; hop++) {
      const result = await answer(`${cfg.siteUrl}${current}`, {redirect: 'manual'});
      const location = 'status' in result && result.status >= 300 && result.status < 400 ? result.location : null;
      if (!location || hop === MAX_COSMETIC_HOPS || !isCosmeticRedirect(current, location)) return judgeInternal(current, result);
      const next = new URL(location, cfg.siteUrl);
      current = `${next.pathname}${next.search}`;
    }
  });
  const external = once(async (url: string) => {
    let result = await answer(url, {method: 'HEAD', redirect: 'follow'});
    // Plenty of sites refuse HEAD; ask again the way a browser would.
    if ('status' in result && [400, 403, 405, 501].includes(result.status)) result = await answer(url, {redirect: 'follow'});
    return judgeExternal(result);
  });

  const openUrl = (path: string) => `${cfg.siteUrl}${path}`;

  async function judgePage(path: string, resolvedFrom?: string): Promise<Judgement & {openUrl: string}> {
    const j = await internal(path);
    return {...j, resolved: j.resolved ?? resolvedFrom, openUrl: openUrl(j.resolved ?? path)};
  }

  async function judgeContent(link: FoundLink, key: string, locale: string): Promise<Partial<CheckedLink> & Judgement> {
    const isLink = link.kind === 'link';
    if (!(await item(key))) {
      return isLink
        ? {
            verdict: 'broken',
            status: 'Points at deleted content',
            hint: "The site renders nothing for this link. Pick the target again, or remove the link.",
          }
        : {verdict: 'broken', status: 'Deleted content', hint: 'This leaves a gap on the page. Remove it, or pick other content.'};
    }
    const live: PublishedItem | null = await published(`${key}|${locale}`);
    if (!live) {
      return isLink
        ? {
            verdict: 'broken',
            status: `Target not published in ${locale}`,
            hint: "The site hides links to content visitors can't see. Publish the target, or pick another page.",
          }
        : {verdict: 'warning', status: `Not published in ${locale}`, hint: "Visitors don't see it until it is published."};
    }
    if (live.url && (isLink || live.isPage)) {
      const page = await judgePage(live.url, live.url);
      return {...page, status: `${live.url}: ${page.status}`};
    }
    if (isLink) return {verdict: 'warning', status: 'Links to an item with no URL', hint: 'Only pages can be linked to.'};
    return {verdict: 'ok', status: 'Published'};
  }

  async function judge(link: FoundLink, locale: string, deadline: number): Promise<CheckedLink> {
    if (Date.now() > deadline) {
      return {...link, verdict: 'unchecked', status: 'Not checked: ran out of time', hint: 'Check again to pick up the rest.'};
    }
    const target = classify(link.target, cfg.siteUrl);
    switch (target.type) {
      case 'content':
        return {...link, ...(await judgeContent(link, target.key, locale))};
      case 'internal':
        return {...link, ...(await judgePage(target.path))};
      case 'external':
        return {...link, ...(await external(target.url)), openUrl: target.url};
      case 'dam':
        return {...link, verdict: 'ok', status: 'DAM asset, served by the DAM'};
      case 'relative':
        return {...link, verdict: 'warning', status: 'Relative link', hint: 'Start it with / or https:// so it works on every page.'};
    }
  }

  async function sharedBlockLinks(found: FoundLink[], locale: string, types: Types) {
    const keys = [...new Set(found.filter((l) => l.kind === 'reference').map((l) => contentKeyOf(l.target)))]
      .filter((k): k is string => Boolean(k))
      .slice(0, MAX_SHARED_BLOCKS);
    let blocks = 0;
    const links = (
      await mapLimit(keys, CONCURRENCY, async (key) => {
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
    async checkLinks({key, version: requested, locale: editorLocale}) {
      if (!KEY.test(key)) throw new ActionError('invalid_key', 'That is not a content key.');
      const it = await item(key);
      if (!it) throw new ActionError('not_found', "The CMS has no item with this key - it may have just been deleted.");
      const locales = (it.locales ?? []).filter(Boolean);
      if (locales.length === 0) return {kind: 'nothing', reason: 'Images, media and folders have no links to check.'};
      const locale = locales.includes(editorLocale) ? editorLocale : it.primaryLocale || locales[0];

      let version: CmsVersion | null = requested ? await cms.getVersion(key, requested) : null;
      version ??= (await cms.listVersions(key, locale, 1))[0] ?? null;
      if (!version) return {kind: 'nothing', reason: `This item has no ${locale} version yet.`};
      if (version.variation) {
        const base = (await cms.listVersions(key, version.locale || locale, 50)).filter((v) => !v.variation);
        const original = base.find((v) => v.status === 'published') ?? base[0];
        return {kind: 'variation', variation: version.variation, baseVersion: original?.version ?? null};
      }

      const deadline = Date.now() + BUDGET_MS;
      const types = new Types(cms);
      await types.load([version.contentType, ...contentTypesIn(version)]);
      const found = collectLinks(version, types.lookup);
      const shared = await sharedBlockLinks(found, version.locale || locale, types);

      const all = [...found, ...shared.links];
      const checked = await mapLimit(all.slice(0, MAX_LINKS), CONCURRENCY, (link) => judge(link, version.locale || locale, deadline));
      return {
        kind: 'checked',
        result: {
          key,
          version: version.version,
          locale: version.locale || locale,
          displayName: version.displayName || key,
          links: checked.sort(byVerdict),
          skipped: Math.max(0, all.length - MAX_LINKS),
          sharedBlocks: shared.blocks,
          checkedAt: new Date().toISOString(),
        },
      };
    },
  };
}
