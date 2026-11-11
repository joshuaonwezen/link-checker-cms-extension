import {writeFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {createChecker} from '../../src/backend/lib/checker';

// Read-only: reads one CMS version and opens its links on the real site.
// LINKS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… OPTIMIZELY_GRAPH_SINGLE_KEY=… \
// LINKS_SITE_URL=https://optimizely-onboarding.vercel.app LINKS_LIVE_KEY=<content key> yarn vitest run tests/live
const live = process.env.LINKS_LIVE === '1';

describe.skipIf(!live)('link checker against a real CMS', () => {
  // Built inside each test: describe bodies run even when skipped, and the checker parses the site URL.
  const checker = () =>
    createChecker({
      siteUrl: process.env.LINKS_SITE_URL ?? '',
      graph: {singleKey: process.env.OPTIMIZELY_GRAPH_SINGLE_KEY ?? ''},
      cms: {clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '', clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? ''},
    });

  it('checks the newest version of a page', async () => {
    const outcome = await checker().checkLinks({key: process.env.LINKS_LIVE_KEY ?? '', version: null, locale: 'en'});
    expect(outcome.kind).toBe('checked');
    if (outcome.kind !== 'checked') return;
    // LINKS_LIVE_OUT=<file> keeps the full result to read through.
    if (process.env.LINKS_LIVE_OUT) writeFileSync(process.env.LINKS_LIVE_OUT, JSON.stringify(outcome.result, null, 2));
    expect(outcome.result.links.length).toBeGreaterThan(0);
  });

  it('refuses a variation version and names the original', async () => {
    const version = process.env.LINKS_LIVE_VARIATION_VERSION;
    if (!version) return;
    const outcome = await checker().checkLinks({key: process.env.LINKS_LIVE_KEY ?? '', version, locale: 'en'});
    expect(outcome).toMatchObject({kind: 'variation'});
  });
});
