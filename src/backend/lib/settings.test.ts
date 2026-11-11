import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {loadConfig, normalizeSiteUrl} from './settings';

describe('settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('treats an unreadable store as empty', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/1/settings'));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await loadConfig()).toEqual({
      ok: false,
      missing: [
        'the site address',
        'the key for reading published content',
        'the CMS API client ID',
        'the CMS API client secret',
      ],
    });
  });

  it('normalizes the site URL', () => {
    expect(normalizeSiteUrl(' https://site.example/ ')).toBe('https://site.example');
    expect(normalizeSiteUrl('https://site.example/sub/')).toBe('https://site.example/sub');
    expect(normalizeSiteUrl('site.example')).toBeNull();
  });

  it('accepts only an https URL with a public host name', () => {
    expect(normalizeSiteUrl('http://site.example')).toBeNull();
    expect(normalizeSiteUrl('https://127.0.0.1')).toBeNull();
    expect(normalizeSiteUrl('https://93.184.216.34')).toBeNull();
    expect(normalizeSiteUrl('https://[::1]')).toBeNull();
    expect(normalizeSiteUrl('https://localhost')).toBeNull();
    expect(normalizeSiteUrl('https://metadata.google.internal')).toBeNull();
    expect(normalizeSiteUrl('https://site.example:8443')).toBeNull();
    expect(normalizeSiteUrl('https://user:pass@site.example')).toBeNull();
  });
});
