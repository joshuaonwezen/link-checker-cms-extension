import type {ActionName, ActionParams} from '../../shared/types';
import {ActionError} from './errors';

// Every value below ends up in a CMS REST URL path or a Graph query, so each is checked
// against an allow-list here, before any handler runs. publicUrl is never requested: it is
// only matched against the CMS's own application hosts (pickSiteUrl).

const CONTENT_KEY = /^[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
const VERSION = /^\d{1,12}$/;
const DEFAULT_LOCALE = 'en';
const MAX_URL = 2048;

function invalid(field: string, why: string): never {
  throw new ActionError('invalid_input', `${field}: ${why}`);
}

function str(raw: unknown, field: string, {optional = false, max = 200} = {}): string {
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return '';
    invalid(field, 'required.');
  }
  if (typeof raw !== 'string') invalid(field, 'expected text.');
  if (raw.length > max) invalid(field, `at most ${max} characters.`);
  return raw.trim();
}

/** An https:// URL that parses, or null when absent. */
function httpsUrl(raw: unknown, field: string): string | null {
  const value = str(raw, field, {optional: true, max: MAX_URL});
  if (!value) return null;
  if (!/^https:\/\//i.test(value)) invalid(field, 'expected an https:// address.');
  try {
    return new URL(value).href;
  } catch {
    return invalid(field, 'not a URL.');
  }
}

/** The editor reports keys with or without dashes, in either case. */
export function normalizeKey(key: string): string {
  return key.replace(/-/g, '').toLowerCase();
}

type Parsers = {[A in ActionName]: (raw: Record<string, unknown>) => ActionParams[A]};

/** One parser per action: unknown fields are dropped, every kept field is checked. */
export const PARSERS: Parsers = {
  checkLinks: (p) => {
    const key = normalizeKey(str(p.key, 'key', {max: 64}));
    if (!CONTENT_KEY.test(key)) invalid('key', 'not a CMS content key.');
    const version = str(p.version, 'version', {optional: true, max: 12});
    if (version && !VERSION.test(version)) invalid('version', 'not a version number.');
    const locale = str(p.locale, 'locale', {optional: true, max: 35});
    if (locale && !LOCALE.test(locale)) invalid('locale', 'not a locale code.');
    const publicUrl = httpsUrl(p.publicUrl, 'publicUrl');
    return {key, version: version || null, locale: locale || DEFAULT_LOCALE, publicUrl};
  },
};

export function isAction(action: string): action is ActionName {
  return Object.prototype.hasOwnProperty.call(PARSERS, action);
}
