import {describe, expect, it} from 'vitest';

import {isAction, PARSERS} from './validate';

const KEY = '3525e1552b6f46158be2850ff6e6fb74';

describe('PARSERS.checkLinks', () => {
  it('normalizes the key and keeps known fields only', () => {
    expect(PARSERS.checkLinks({key: '3525E155-2b6f-4615-8be2-850ff6e6fb74', version: '6882', locale: 'nl', extra: 1})).toEqual({
      key: KEY,
      version: '6882',
      locale: 'nl',
    });
  });

  it('defaults a missing version and locale', () => {
    expect(PARSERS.checkLinks({key: KEY})).toEqual({key: KEY, version: null, locale: 'en'});
    expect(PARSERS.checkLinks({key: KEY, version: null, locale: ''})).toEqual({key: KEY, version: null, locale: 'en'});
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
