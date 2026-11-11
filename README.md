# Link checker

A sidebar in the Optimizely CMS editor that checks every link on the page you have open, before visitors find the broken ones. It lists links to deleted or unpublished content, pages that no longer exist, links that go through a redirect and external sites that don't answer. Problems come first, each with where it sits on the page and what to do about it.

Documentation: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#link-checker

## What editors get
- A **Link checker** tab on the editor's right-hand rail. It checks the version that is open, drafts included, as soon as the tab opens.
- It reads the page's properties and its Visual Builder composition, with no setup per content type, and the shared blocks the page uses (one level deep).
- It finds:
  - url fields;
  - links and images in rich text and HTML (a raw HTML block included);
  - blocks in content areas, image fields and shared blocks placed on the page.
- It checks each one:
  - **Links to CMS content** are looked up in Optimizely Graph, so only published content counts, then opened on the site. Content that was deleted, or isn't published in the page's language, is **broken**: visitors can't reach it, and a site that builds links from Graph usually drops such a link without any error.
  - **Blocks and images shown on the page** must exist and be published.
  - **Paths on your site** are opened on the site. "Page not found" is broken. A redirect to a different page is "worth a look" (link to the target directly). Redirects that only add or drop a trailing slash or change letter case count as working.
  - **External links** are opened through the outbound guard (see [Security](#security)). A site that refuses automated checks is listed as "couldn't check", not as broken.
- Results are grouped: **Broken** and **Worth a look** open, **Couldn't check** and **Fine** folded away. Each row shows the link text or the content's name, the address, where it sits ("Product cards > Savings card > Link URL"), a status in plain words and a hint.
- **Check again** re-runs it. Saving a draft keeps the version, so the sidebar doesn't re-run on its own.

## Setup
1. Install the app on your CMS instance from the OCP App Directory (or with the CLI, see [Deploy](#deploy)).
2. Fill in the settings and save each section. Every value you enter is checked when you save it.

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| Site URL | No | Your site's public https address, e.g. `https://www.example.com` | Overrides the site address from CMS Settings > Applications. Leave it blank unless that address is wrong for checking. |
| Optimizely Graph single key | Yes | CMS: Settings > API Keys | Reading published content: whether linked content is live, and the URL Graph gives it. |
| CMS API client ID and secret | Yes | CMS: Settings > API Keys > create an API client. Read access is enough. The secret is shown once. | Reading the version open in the editor, telling deleted content from unpublished content, and reading the site hosts in Settings > Applications. |

**How the site is found.** On each check the app uses, in this order:
1. the Site URL setting, when it is filled in;
2. the open page's own host, when it is one of the hosts listed in CMS Settings > Applications (so a CMS with several sites checks each page on its own site);
3. the only primary host in Settings > Applications.

When none applies (several sites and a page whose address isn't one of them), the sidebar asks editors to have an admin set the Site URL.

Common setup problems and the sidebar messages they cause: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting

## What your site needs
- **Any Optimizely SaaS CMS instance and any front end.** The app doesn't depend on a framework or on code in your site.
- **Pages served at the URLs Graph reports.** A link to CMS content is checked at the page's URL in Graph (`_metadata.url`), on the site found above. A site that routes requests by Graph URL already does this.
- **Your own URL rules can cause false "Page not found".** If the site rewrites page URLs, for example a different domain per language or an extra prefix such as `/shop`, the app opens a path the site doesn't serve. Make the site answer at Graph's URLs too (a redirect to the real address shows as "worth a look" rather than broken), or keep the Graph URLs and site URLs the same.
- **A public https address.** The host in Settings > Applications (or the Site URL) must be the address visitors use: https, a host name rather than a numeric address, the standard port, and reachable from the internet.
- **Automated requests allowed.** The checks come from a server, with `OptimizelyCmsLinkChecker` in the user agent. Bot protection or a login in front of the site turns every result into "The site refused the check".

## Limits
- **Variations can't be read.** The CMS API returns a variation's blocks without their values, so on a variation the sidebar says so and offers to check the original page.
- **The extension only knows which item is open** (key, version, language and page address), and gets no CMS token. That is why the app needs its own API client.
- **Up to 60 links per check**, within about 25 seconds. Shared blocks are read one level deep, up to 25 of them. The sidebar says how many links it skipped, and lists links it ran out of time for as not checked.
- **Only published content counts** for links to CMS content, because that is what visitors see.
- **A shared block opened on its own has no page address.** On a CMS with several sites, checking it needs the Site URL setting.

## Security
Links come from content, and the sidebar opens them from the app's server every time it runs. An outbound guard stops that being used to reach private networks or cloud metadata services:
- only `http` and `https`, only the standard ports (80 and 443), and no user name or password in the address;
- no numeric addresses, and no `localhost`, `*.local`, `*.internal` or single-word host names;
- the host name is looked up first, and refused if **any** address it resolves to is private, loopback, link-local, shared (carrier-grade NAT), multicast or reserved, for IPv4 and IPv6, including IPv6 forms that wrap a private IPv4 address;
- redirects are followed by hand, up to five, and each new address is checked again;
- a refused link is listed as "Not checked" with the reason, not as an error.

The site address gets the same treatment on every check, whether it is the Site URL setting or a host from Settings > Applications: https, a public host name, and public addresses only. The page address the editor sends is never requested; it only picks one of the hosts your CMS lists.

Only a status code comes back from any request, never the response body. The logs hold host names, never paths or query strings. The Graph key and the API client secret stay in the app's settings and never reach the browser.

Remaining risk: **DNS rebinding.** The host is looked up, then looked up again when the request is made, so a hostile DNS server could answer with a public address the first time and a private one the second. Closing that needs the checked address pinned into the connection, which the runtime's built-in `fetch` doesn't allow.

## Develop

```bash
yarn install
yarn validate      # lint, typecheck, unit tests, build and ocp-app-sdk validate
ocp dev -p 3100    # the sidebar in a simulated CMS editor, calling the local backend
```

The live tests in `tests/live/` read one real version and open its links on the real site. They only read:

```bash
LINKS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=<client id> OPTIMIZELY_CMS_CLIENT_SECRET=<client secret> \
OPTIMIZELY_GRAPH_SINGLE_KEY=<single key> LINKS_LIVE_KEY=<content key> \
LINKS_LIVE_PAGE_URL=https://www.example.com/about/ LINKS_LIVE_OUT=/tmp/links.json \
yarn vitest run tests/live
```

`LINKS_LIVE_PAGE_URL` (the page's address) and `LINKS_SITE_URL` (the Site URL override) are optional, like in the app.

## Deploy
The app is installed once per CMS instance. Run each command through `npx -p @optimizely/ocp-cli-v2` when the `ocp` CLI isn't installed. To publish your own copy, set your own `app_id`, `vendor` and `contact_email` in `app.yml` first.

```bash
npx -p @optimizely/ocp-cli-v2 ocp app register                         # once
ocp app prepare --bump-dev-version --publish
ocp directory install <app_id>@<version> --scope <cms-instance-uuid>
```

Publishing a new dev version moves existing installs onto it. After the first install, fill in the settings (see [Setup](#setup)). Installing on another CMS instance: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | The `checkLinks` action, answering with an `{ok, result}` envelope; upstream error detail goes to the logs, not the editor |
| `src/backend/lib/validate.ts` | One parser per action: allow-listed key, version, locale and page URL, unknown fields dropped |
| `src/backend/lib/siteUrl.ts` | Picks the site for a request from the Site URL setting and the CMS application hosts |
| `src/backend/lib/outbound.ts` | The outbound guard for every request to a URL from content |
| `src/backend/lib/collect.ts` | Finds links and references in a version: pure, no network |
| `src/backend/lib/checker.ts` | Resolves the site, reads the version and shared blocks, then checks each link |
| `src/backend/lib/verdict.ts` | HTTP answer to broken / worth a look / couldn't check / fine, in editor wording |
| `src/backend/lib/cms.ts`, `graph.ts` | CMS REST (content, versions, content types, applications) and Graph clients |
| `src/backend/lifecycle/Lifecycle.ts` | Checks each settings section before saving |
| `src/shared/` | The contract between the sidebar and the backend |
| `src/cms-ui-extensions/links/` | `LinkChecker.sidebar.tsx` |
| `tests/live/` | Read-only tests against a real CMS and site |
