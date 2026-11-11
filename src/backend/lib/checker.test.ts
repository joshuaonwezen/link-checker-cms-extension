import {describe, expect, it, vi} from 'vitest';

import {createChecker, type CmsApi} from './checker';
import type {CmsVersion} from './cms';
import type {OutboundDeps} from './outbound';
import type {LoadedSettings} from './settings';
import type {CmsApplication} from './siteUrl';

const KEY = '0f8e2d6c4b1a49e7a3c5d7f9b2e4c6a8';
const PUBLIC = '93.184.216.34';

// GET /v1/applications on an instance with two sites and a preview host.
const SITE_A = {key: 'site_a', hosts: [{authority: 'www.example.com', type: 'primary', preferredUrlScheme: 'https'}]};
const SITE_B = {key: 'site_b', hosts: [{authority: 'shop.example.org', type: 'primary', preferredUrlScheme: 'https'}]};
const PREVIEW = {key: 'preview', hosts: [{authority: 'preview.example.com', type: 'preview', preferredUrlScheme: 'https'}]};

const PAGE: CmsVersion = {
  key: KEY,
  version: '7',
  locale: 'en',
  status: 'draft',
  contentType: 'StandardPage',
  displayName: 'About us',
  properties: {ctaUrl: {value: '/contact'}},
};

/** A CMS with one page whose only link is the site path /contact. */
function fakeCms(apps: CmsApplication[], version: CmsVersion = PAGE) {
  const listApplications = vi.fn(async () => apps);
  const cms: CmsApi = {
    getItem: async (key) => ({key, contentType: 'StandardPage', primaryLocale: 'en', locales: ['en']}),
    listVersions: async () => [version],
    getVersion: async () => version,
    getContentType: async () => ({displayName: 'Standard page', baseType: '_page', properties: {ctaUrl: {displayName: 'Call to action', type: 'url'}}}),
    listApplications,
  };
  return {cms, listApplications};
}

/** Every host resolves to `addresses`; every request answers 200. */
function fakeNetwork(addresses: Record<string, string[]> = {}) {
  const requested: string[] = [];
  const outbound: OutboundDeps = {
    resolve: async (host) => addresses[host] ?? [PUBLIC],
    fetch: async (input) => {
      requested.push(String(input));
      return new Response(null, {status: 200});
    },
  };
  return {outbound, requested};
}

// The application list is cached per API client for five minutes: a fresh client per test.
let installs = 0;
function settings(siteUrl = ''): LoadedSettings {
  return {siteUrl, graph: {singleKey: 'graph-key'}, cms: {clientId: `client-${++installs}`, clientSecret: 'secret'}};
}

const check = (publicUrl: string | null) => ({key: KEY, version: null, locale: 'en', publicUrl});

describe('createChecker: the site is resolved per request', () => {
  it("opens internal links on the open page's own site", async () => {
    const {cms} = fakeCms([SITE_A, SITE_B, PREVIEW]);
    const net = fakeNetwork();
    const outcome = await createChecker(settings(), {cms, outbound: net.outbound}).checkLinks(
      check('https://shop.example.org/en/about-us/'),
    );
    expect(net.requested).toEqual(['https://shop.example.org/contact']);
    expect(outcome).toMatchObject({kind: 'checked', result: {links: [{target: '/contact', verdict: 'ok', status: 'Works'}]}});
  });

  it('uses the saved Site URL over the page, without listing the applications', async () => {
    const {cms, listApplications} = fakeCms([SITE_A, SITE_B]);
    const net = fakeNetwork();
    await createChecker(settings('https://override.example.net'), {cms, outbound: net.outbound}).checkLinks(
      check('https://shop.example.org/en/about-us/'),
    );
    expect(net.requested).toEqual(['https://override.example.net/contact']);
    expect(listApplications).not.toHaveBeenCalled();
  });

  it('refuses a page URL on a host the CMS does not list, and opens nothing', async () => {
    const {cms} = fakeCms([SITE_A, SITE_B]);
    const net = fakeNetwork();
    const run = createChecker(settings(), {cms, outbound: net.outbound}).checkLinks(check('https://169.254.169.254/latest/'));
    await expect(run).rejects.toMatchObject({code: 'site_unknown'});
    expect(net.requested).toEqual([]);
  });

  it('falls back to the only site when the page has no address of its own', async () => {
    const {cms} = fakeCms([SITE_A, PREVIEW]);
    const net = fakeNetwork();
    await createChecker(settings(), {cms, outbound: net.outbound}).checkLinks(check(null));
    expect(net.requested).toEqual(['https://www.example.com/contact']);
  });

  it('guards an application host like a saved Site URL', async () => {
    const internal = {key: 'intranet', hosts: [{authority: 'intranet.example.com', type: 'primary'}]};
    const numeric = {key: 'numeric', hosts: [{authority: '127.0.0.1', type: 'primary'}]};
    const port = {key: 'port', hosts: [{authority: 'www.example.com:8443', type: 'primary'}]};
    for (const app of [internal, numeric, port]) {
      const {cms} = fakeCms([app]);
      const net = fakeNetwork({'intranet.example.com': ['10.0.0.5']});
      await expect(createChecker(settings(), {cms, outbound: net.outbound}).checkLinks(check(null)), app.key).rejects.toMatchObject({
        code: 'site_refused',
      });
      expect(net.requested, app.key).toEqual([]);
    }
  });

  it('re-checks a saved Site URL that now resolves to a private address', async () => {
    const {cms} = fakeCms([SITE_A]);
    const net = fakeNetwork({'override.example.net': ['192.168.1.10']});
    await expect(
      createChecker(settings('https://override.example.net'), {cms, outbound: net.outbound}).checkLinks(check(null)),
    ).rejects.toMatchObject({code: 'site_refused', message: expect.stringMatching(/Site URL in the app settings/)});
    expect(net.requested).toEqual([]);
  });

  it('needs no site when the page has no links', async () => {
    const {cms, listApplications} = fakeCms([SITE_A, SITE_B], {...PAGE, properties: {}});
    const outcome = await createChecker(settings(), {cms, outbound: fakeNetwork().outbound}).checkLinks(check(null));
    expect(outcome).toMatchObject({kind: 'checked', result: {links: []}});
    expect(listApplications).not.toHaveBeenCalled();
  });
});
