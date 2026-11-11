import {writeFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {createChecker} from '../../src/backend/lib/checker';

// Read-only: reads one CMS version and opens its links on the real site.
// LINKS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… OPTIMIZELY_GRAPH_SINGLE_KEY=… \
// LINKS_LIVE_KEY=<content key> yarn vitest run tests/live
// Optional: LINKS_SITE_URL=https://www.example.com (the Site URL override) and
// LINKS_LIVE_PAGE_URL=https://www.example.com/about/ (the page's address, as the editor reports
// it). With neither, the site is the CMS's only primary application host.
const live = process.env.LINKS_LIVE === '1';

describe.skipIf(!live)('link checker against a real CMS', () => {
  const checker = () =>
    createChecker({
      siteUrl: process.env.LINKS_SITE_URL ?? '',
      graph: {singleKey: process.env.OPTIMIZELY_GRAPH_SINGLE_KEY ?? ''},
      cms: {clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '', clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? ''},
    });
  const page = {key: process.env.LINKS_LIVE_KEY ?? '', locale: 'en', publicUrl: process.env.LINKS_LIVE_PAGE_URL || null};

  it('checks the newest version of a page', async () => {
    const outcome = await checker().checkLinks({...page, version: null});
    expect(outcome.kind).toBe('checked');
    if (outcome.kind !== 'checked') return;
    // LINKS_LIVE_OUT=<file> keeps the full result to read through.
    if (process.env.LINKS_LIVE_OUT) writeFileSync(process.env.LINKS_LIVE_OUT, JSON.stringify(outcome.result, null, 2));
    expect(outcome.result.links.length).toBeGreaterThan(0);
  });

  it('refuses a variation version and names the original', async () => {
    const version = process.env.LINKS_LIVE_VARIATION_VERSION;
    if (!version) return;
    const outcome = await checker().checkLinks({...page, version});
    expect(outcome).toMatchObject({kind: 'variation'});
  });
});
