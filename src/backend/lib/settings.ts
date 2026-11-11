import {logger, storage, ValueHash} from '@zaiusinc/app-sdk';

import type {CmsConfig} from './cms';
import type {GraphConfig} from './graph';
import {refusal} from './outbound';

// Section keys match forms/settings.yml.
// Type aliases, not interfaces: the settings store requires an index-signature-compatible shape.
export type SiteSettings = {
  siteUrl?: string;
};

export type GraphSettings = {
  singleKey?: string;
};

export type CmsSettings = {
  clientId?: string;
  clientSecret?: string;
};

export interface LoadedSettings {
  /**
   * The admin's override: origin (plus optional path) without a trailing slash. '' when not
   * set, and then each request finds the site in the CMS's application hosts.
   */
  siteUrl: string;
  graph: GraphConfig;
  cms: CmsConfig;
}

export type LoadedConfig = {ok: true; config: LoadedSettings} | {ok: false; missing: string[]};

/**
 * https://host[/path] without a trailing slash, or null. Only https, and only a public host
 * name: no IP address, localhost, *.local or *.internal, port or credentials. Whether the name
 * resolves to a public address is checked when the setting is saved.
 */
export function normalizeSiteUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!/^https:\/\/[^\s/]+/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (refusal(url)) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * One settings section, or {} when the store can't be read. On a CMS-scoped install that has
 * never saved its settings, the production store throws "Failed to get value at
 * app-data/<install>/settings" instead of returning {}.
 */
export async function readSection<T extends ValueHash>(section: string): Promise<T> {
  try {
    return await storage.settings.get<T>(section);
  } catch (error) {
    logger.warn('Could not read settings section', section, error);
    return {} as T;
  }
}

export async function loadConfig(): Promise<LoadedConfig> {
  const [site, graph, cms] = await Promise.all([
    readSection<SiteSettings>('site'),
    readSection<GraphSettings>('graph'),
    readSection<CmsSettings>('cms'),
  ]);
  // Optional: blank means the site comes from CMS Settings > Applications.
  const siteUrl = normalizeSiteUrl(site.siteUrl) ?? '';
  const singleKey = graph.singleKey?.trim() ?? '';
  const clientId = cms.clientId?.trim() ?? '';
  const clientSecret = cms.clientSecret?.trim() ?? '';

  // Editors read this list, so it names what is missing in plain words.
  const missing = [
    !singleKey && 'the key for reading published content',
    !clientId && 'the CMS API client ID',
    !clientSecret && 'the CMS API client secret',
  ].filter((m): m is string => Boolean(m));

  return missing.length > 0
    ? {ok: false, missing}
    : {ok: true, config: {siteUrl, graph: {singleKey}, cms: {clientId, clientSecret}}};
}
