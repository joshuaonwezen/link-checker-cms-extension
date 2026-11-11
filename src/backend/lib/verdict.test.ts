import {describe, expect, it} from 'vitest';

import {classify, sitePage} from './checker';
import {isCosmeticRedirect, judgeExternal, judgeInternal} from './verdict';

describe('judgeInternal', () => {
  it('passes 200 and a trailing-slash redirect, warns on a real redirect, breaks on 404', () => {
    expect(judgeInternal('/a', {status: 200})).toEqual({verdict: 'ok', status: 'Works'});
    expect(judgeInternal('/en/about/', {status: 308, location: '/en/about'})).toEqual({verdict: 'ok', status: 'Works'});
    expect(judgeInternal('/savings', {status: 308, location: 'https://site.example/personal/savings'})).toMatchObject({
      verdict: 'warning',
      status: 'Redirects to /personal/savings',
      resolved: '/personal/savings',
    });
    expect(judgeInternal('/gone', {status: 404})).toMatchObject({verdict: 'broken', status: 'Page not found'});
    expect(judgeInternal('/x', {failure: 'timeout'})).toMatchObject({verdict: 'unchecked', status: 'The site took too long to answer'});
    expect(judgeInternal('/x', {failure: 'error'})).toMatchObject({verdict: 'unchecked', status: "Couldn't reach the site"});
  });

  it('names the full URL of a redirect that leaves the site', () => {
    expect(judgeInternal('/out', {status: 302, location: 'https://other.example/x'}, 'https://site.example')).toMatchObject({
      status: 'Redirects to https://other.example/x',
      resolved: 'https://other.example/x',
    });
  });

  it('never shows a status code', () => {
    for (const status of [200, 301, 401, 403, 404, 410, 429, 500, 503, 418]) {
      expect(judgeInternal('/a', {status, location: '/b'}).status).not.toMatch(/\d{3}/);
    }
  });

  it('treats only slash and case changes as cosmetic', () => {
    expect(isCosmeticRedirect('/A/b/', '/a/b')).toBe(true);
    expect(isCosmeticRedirect('/a', '/b')).toBe(false);
  });
});

describe('judgeExternal', () => {
  it('maps answers to verdicts in plain words', () => {
    expect(judgeExternal({status: 200})).toEqual({verdict: 'ok', status: 'Works'});
    expect(judgeExternal({status: 404})).toMatchObject({verdict: 'broken', status: 'Page not found'});
    expect(judgeExternal({status: 403})).toMatchObject({verdict: 'unchecked', status: 'The site refused the check'});
    expect(judgeExternal({status: 503})).toMatchObject({verdict: 'warning', status: 'The site had an error'});
    expect(judgeExternal({failure: 'error'})).toMatchObject({verdict: 'unchecked', status: "Couldn't reach it"});
    expect(judgeExternal({failure: 'redirects'})).toMatchObject({verdict: 'unchecked', status: 'Redirects too many times'});
  });

  it('reports a refused URL as not checked, not as an error', () => {
    expect(judgeExternal({refused: 'private', host: '127.0.0.1'})).toMatchObject({
      verdict: 'unchecked',
      status: 'Not checked: points to a private address',
    });
    expect(judgeExternal({refused: 'credentials', host: 'site.example'}).verdict).toBe('unchecked');
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

  it('sends paths that name another host to the guarded external check', () => {
    expect(classify('/\\169.254.169.254/latest', site)).toEqual({type: 'external', url: 'https://169.254.169.254/latest'});
  });
});

describe('sitePage', () => {
  const site = new URL('https://site.example');
  it('keeps every path on the site', () => {
    expect(sitePage(site, '/en/about')?.href).toBe('https://site.example/en/about');
    expect(sitePage(site, '//169.254.169.254/latest')?.origin).toBe('https://site.example');
    expect(sitePage(site, '/\\evil.example/x')?.origin).toBe('https://site.example');
  });
});
