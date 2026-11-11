import {describe, expect, it} from 'vitest';

import {isAction, PARSERS} from './validate';

const KEY = '3525e1552b6f46158be2850ff6e6fb74';

describe('PARSERS.checkLinks', () => {
  it('normalizes the key and keeps known fields only', () => {
    expect(PARSERS.checkLinks({key: '3525E155-2b6f-4615-8be2-850ff6e6fb74', version: '6882', locale: 'nl', extra: 1})).toEqual({
      key: KEY,
      version: '6882',
      locale: 'nl',
      publicUrl: null,
    });
  });

  it('defaults a missing version, locale and page URL', () => {
    expect(PARSERS.checkLinks({key: KEY})).toEqual({key: KEY, version: null, locale: 'en', publicUrl: null});
    expect(PARSERS.checkLinks({key: KEY, version: null, locale: '', publicUrl: null})).toEqual({
      key: KEY,
      version: null,
      locale: 'en',
      publicUrl: null,
    });
  });

  it('accepts the page URL only as an https URL that parses', () => {
    expect(PARSERS.checkLinks({key: KEY, publicUrl: 'https://www.example.com/en/about/'}).publicUrl).toBe(
      'https://www.example.com/en/about/',
    );
    expect(() => PARSERS.checkLinks({key: KEY, publicUrl: 'http://www.example.com/'})).toThrow(/publicUrl: expected an https/);
    expect(() => PARSERS.checkLinks({key: KEY, publicUrl: 'file:///etc/passwd'})).toThrow(/publicUrl/);
    expect(() => PARSERS.checkLinks({key: KEY, publicUrl: 'https://exa mple.com/'})).toThrow(/publicUrl: not a URL/);
    expect(() => PARSERS.checkLinks({key: KEY, publicUrl: {href: 'https://www.example.com'}})).toThrow(/publicUrl: expected text/);
    expect(() => PARSERS.checkLinks({key: KEY, publicUrl: `https://www.example.com/${'a'.repeat(2048)}`})).toThrow(/at most 2048/);
  });

  it('rejects values that would reach an API path', () => {
    expect(() => PARSERS.checkLinks({})).toThrow(/key: required/);
    expect(() => PARSERS.checkLinks({key: '../../v1/contenttypes'})).toThrow(/content key/);
    expect(() => PARSERS.checkLinks({key: KEY, version: '1/../2'})).toThrow(/version/);
    expect(() => PARSERS.checkLinks({key: KEY, version: 6882})).toThrow(/version/);
    expect(() => PARSERS.checkLinks({key: KEY, locale: 'en/../x'})).toThrow(/locale/);
    expect(() => PARSERS.checkLinks({key: KEY, locale: 'en-US'})).not.toThrow();
  });
});

describe('isAction', () => {
  it('knows only the declared actions', () => {
    expect(isAction('checkLinks')).toBe(true);
    expect(isAction('toString')).toBe(false);
    expect(isAction('deleteEverything')).toBe(false);
  });
});
