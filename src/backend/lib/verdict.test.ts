import {describe, expect, it} from 'vitest';

import {classify} from './checker';
import {isCosmeticRedirect, judgeExternal, judgeInternal} from './verdict';

describe('judgeInternal', () => {
  it('passes 200 and a trailing-slash redirect, warns on a real redirect, breaks on 404', () => {
    expect(judgeInternal('/a', {status: 200}).verdict).toBe('ok');
    expect(judgeInternal('/en/about/', {status: 308, location: '/en/about'}).verdict).toBe('ok');
    expect(judgeInternal('/savings', {status: 308, location: 'https://site.example/personal/savings'})).toMatchObject({
      verdict: 'warning',
      resolved: '/personal/savings',
    });
    expect(judgeInternal('/gone', {status: 404}).verdict).toBe('broken');
    expect(judgeInternal('/x', {failure: 'timeout'}).verdict).toBe('unchecked');
  });

  it('treats only slash and case changes as cosmetic', () => {
    expect(isCosmeticRedirect('/A/b/', '/a/b')).toBe(true);
    expect(isCosmeticRedirect('/a', '/b')).toBe(false);
  });
});

describe('judgeExternal', () => {
  it('maps statuses to verdicts', () => {
    expect(judgeExternal({status: 200}).verdict).toBe('ok');
    expect(judgeExternal({status: 404}).verdict).toBe('broken');
    expect(judgeExternal({status: 403}).verdict).toBe('unchecked');
    expect(judgeExternal({status: 503}).verdict).toBe('warning');
    expect(judgeExternal({failure: 'error'}).verdict).toBe('unchecked');
  });
});

describe('classify', () => {
  const site = 'https://site.example';
  it('separates content, site, external and DAM targets', () => {
    expect(classify('cms://content/4fb677b1b09c4916bcf7a2a66bd2baae', site)).toEqual({type: 'content', key: '4fb677b1b09c4916bcf7a2a66bd2baae'});
    expect(classify('/a?b=1', site)).toEqual({type: 'internal', path: '/a?b=1'});
    expect(classify('https://site.example/a?b=1', site)).toEqual({type: 'internal', path: '/a?b=1'});
    expect(classify('https://other.example/a', site)).toEqual({type: 'external', url: 'https://other.example/a'});
    expect(classify('//cdn.example/x.png', site)).toEqual({type: 'external', url: 'https://cdn.example/x.png'});
    expect(classify('cms://content/DamImageSourceRendition/1', site)).toEqual({type: 'dam'});
    expect(classify('page.html', site)).toEqual({type: 'relative'});
  });
});
