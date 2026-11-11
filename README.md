# Link checker: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app. A sidebar checks every link on the version open in the editor, before visitors find the broken ones.

It is built for `optimizely-nextjs-demo`, where an internal link in a `type: "url"` field is stored as `cms://content/{key}`. When that content is deleted or unpublished, Graph can't resolve it, and the site's `resolveLinkHref()` returns nothing, so **the link disappears from the page without any error**. That is the case this sidebar exists to catch.

## What it does
- Reads the open version through the CMS REST API: its properties and its Visual Builder composition, with no per-type code. It also reads the shared blocks the page uses, one level deep.
- Collects:
  - url fields;
  - `<a href>` and `<img src>` in rich text and HTML strings (a Raw HTML block included);
  - references: blocks in content areas, image fields, shared blocks placed in the composition.
- Checks each one:
  - **Content links** (`cms://content/{key}`): resolved through Graph, so only published content counts, then opened on the site. Deleted content and content that isn't published in the page's locale are both **broken**, because the site hides those links.
  - **References**: they must exist and be published.
  - **Site paths**: opened on the site with redirects off. A 404 is broken. A redirect to a different page is "worth a look" (link to the target directly). Trailing-slash and case redirects are followed. Paths are appended to the site's origin, never resolved against it, and every request must stay on that origin, so `//host/x`, `/\host/x` or an absolute Graph `url.default` can't turn a site check into a request to another host. A Graph URL on another host is checked as an external link.
  - **External URLs**: `HEAD`, falling back to `GET`, through the outbound guard below. A 401/403/429 means "couldn't check", not broken.
- Shows the results worst first: broken and "worth a look" open, "couldn't check" and "fine" collapsed. Each row leads with the link text or the target's name (never a `cms://` key), then the address, where it sits ("Product Cards > Savings Card > Link URL"), a status in plain words ("Works", "Page not found", "Redirects to /x", "Not published", "Deleted") and a fix hint. **Check again** sits at the top: saving a draft keeps the version, so the panel doesn't re-run on its own. Up to 60 links are checked per run, within a 25-second budget that also cuts the shared-block step short.

## Outbound guard (SSRF)
External links come from content, and the sidebar opens them from the app's backend on every panel open. `src/backend/lib/outbound.ts` stops that being used to probe internal hosts or cloud metadata:
- only `http:`/`https:`, only the default ports (80/443), no user name or password in the URL;
- no IP literals, and no `localhost`, `*.localhost`, `*.local`, `*.internal` or single-label host names;
- the host is resolved (`dns.lookup`, all addresses) and refused if **any** address is loopback, private, link-local, CGNAT, unspecified, multicast or reserved: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 198.18/15, 224/4 and above, the documentation ranges, and for IPv6 anything outside global unicast (`::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`) plus IPv4-mapped, NAT64 and 6to4 forms of a private IPv4 address;
- redirects are off (`redirect: 'manual'`); up to 5 hops are followed by hand, each `Location` screened again;
- a refused URL is reported as "Not checked: points to a private address" (or the reason), not as an error;
- the external host names checked and refused are logged (host only, never the path).

The same guard runs when the Site URL is saved, which must be `https://` with a public host name.

Residual risk: **DNS rebinding.** The guard resolves the host, then `fetch` resolves it again; a hostile DNS server could answer a public address the first time and a private one the second. Pinning the checked address into the connection needs a custom undici dispatcher, which the runtime's built-in `fetch` doesn't expose. Only a status code ever comes back, never a response body.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend reads the version itself.
- **Variation versions can't be read:** the CMS API returns their blocks without values. On a variation, the sidebar says so in plain words and offers to check the original page.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime. `readSection` treats that as empty.

## Settings
- **Site:** the public `https://` address of the front end for this CMS instance. IP addresses, private host names and non-standard ports are refused, and so is a name or redirect that leads to a private address.
- **Optimizely Graph:** the instance's single key (published content only, which is what visitors see).
- **CMS API client:** read access is enough.

Editors never see these names: when something is missing, the sidebar lists it in plain words and asks them to contact a CMS admin.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev -p 3100    # the sidebar in a simulated CMS host, invokeFunction against the local backend
```

The live suite in `tests/live/` reads one real version and opens its links on the real site. It only reads:

```bash
LINKS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… OPTIMIZELY_GRAPH_SINGLE_KEY=… \
LINKS_SITE_URL=https://optimizely-onboarding.vercel.app LINKS_LIVE_KEY=<content key> \
LINKS_LIVE_OUT=/tmp/links.json yarn vitest run tests/live
```

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | The `checkLinks` action, using the `{ok, result}` envelope; upstream error detail goes to the logs, not the editor |
| `src/backend/lib/validate.ts` | One parser per action: allow-listed key, version and locale, unknown fields dropped |
| `src/backend/lib/outbound.ts` | The outbound guard for every request to a URL from content |
| `src/backend/lib/collect.ts` | Finds links and references in a version: pure, no network |
| `src/backend/lib/checker.ts` | Reads the version and shared blocks, then checks each link |
| `src/backend/lib/verdict.ts` | HTTP answer → broken / worth a look / couldn't check / fine, in editor wording |
| `src/backend/lib/cms.ts`, `graph.ts` | CMS REST and Graph clients |
| `src/backend/lifecycle/Lifecycle.ts` | Validates each settings section before saving |
| `src/shared/` | The UI ↔ backend contract |
| `src/cms-ui-extensions/links/` | `LinkChecker.sidebar.tsx` |

## Deploy
The app is CMS-scoped, so it is installed once per CMS instance:

```bash
ocp app register --appId cms_link_checker --name "Link checker" --product HUB --personal   # once
ocp app prepare --bump-dev-version --publish
ocp directory install cms_link_checker@<version> --scope <cms-instance-uuid>
```

Later dev versions published the same way replace the running one on existing installs. After installing, fill in all three settings sections.
