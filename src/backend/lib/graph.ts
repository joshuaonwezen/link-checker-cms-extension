import {ApiError, requestJson} from './http';

const GRAPH = 'https://cg.optimizely.com/content/v2';

export interface GraphConfig {
  singleKey: string;
}

/** Graph's Locales enum spells region locales with an underscore: ja-JP -> ja_JP. */
export function graphLocale(locale: string): string {
  return locale.replace(/-/g, '_');
}

export async function graphQuery<T>(cfg: GraphConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = await requestJson<{data?: T; errors?: Array<{message?: string}>}>(
    'graph',
    'Graph query',
    `${GRAPH}?auth=${encodeURIComponent(cfg.singleKey)}`,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query, variables})},
  );
  if (body?.errors?.length) {
    throw new ApiError(400, 'graph_rejected', `Graph query: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  }
  if (!body?.data) throw new ApiError(502, 'graph_unavailable', 'Graph query: no data in the response');
  return body.data;
}

const PUBLISHED_ITEM = /* GraphQL */ `
  query PublishedItem($key: String!, $locale: [Locales]) {
    _Content(where: {_metadata: {key: {eq: $key}}}, locale: $locale, limit: 1) {
      items {
        _metadata {
          url {
            default
          }
          types
        }
      }
    }
  }
`;

export interface PublishedItem {
  /** The page's URL on the site; null for blocks and media. */
  url: string | null;
  isPage: boolean;
}

/** The published item in `locale` (or a locale-less one, like media), or null when visitors can't see it. */
export async function publishedItem(cfg: GraphConfig, key: string, locale: string): Promise<PublishedItem | null> {
  const data = await graphQuery<{_Content?: {items?: Array<{_metadata?: {url?: {default?: string | null}; types?: string[]}}>}}>(
    cfg,
    PUBLISHED_ITEM,
    {key, locale: [graphLocale(locale), 'NEUTRAL']},
  );
  const meta = data._Content?.items?.[0]?._metadata;
  if (!meta) return null;
  const isPage = (meta.types ?? []).some((t) => t === '_Page' || t === '_Experience');
  return {url: meta.url?.default ?? null, isPage};
}

/** Throws ApiError when the key is rejected. */
export async function checkKey(cfg: GraphConfig): Promise<void> {
  await graphQuery(cfg, '{ _Content(limit: 1) { total } }');
}
