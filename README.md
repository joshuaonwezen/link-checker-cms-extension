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
  - **Site paths**: opened on the site with redirects off. A 404 is broken. A redirect to a different page is "worth a look" (link to the target directly). Trailing-slash and case redirects are followed.
  - **External URLs**: `HEAD`, falling back to `GET`. A 401/403/429 means "couldn't check", not broken.
- Shows the results worst first, each with where it sits ("Product Cards > Savings Card > Link URL"), the link text and a fix hint. Up to 60 links are checked per run, within a time budget.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend reads the version itself.
- **Variation versions can't be read:** the CMS API returns their blocks without values. On a variation, the sidebar says so and offers to check the original page.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime. `readSection` treats that as empty.

## Settings
- **Site:** the front end for this CMS instance, e.g. `https://optimizely-onboarding.vercel.app` for joshCMS.
- **Optimizely Graph:** the instance's single key (published content only, which is what visitors see).
- **CMS API client:** read access is enough.

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
| `src/backend/functions/CmsUiExtension.ts` | The `checkLinks` action, using the `{ok, result}` envelope |
| `src/backend/lib/collect.ts` | Finds links and references in a version: pure, no network |
| `src/backend/lib/checker.ts` | Reads the version and shared blocks, then checks each link |
| `src/backend/lib/verdict.ts` | HTTP answer → broken / worth a look / couldn't check / fine |
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
