# Link checker

The Link checker adds a sidebar to the CMS editor that checks every link on the open page: links to deleted or unpublished content, pages that no longer exist, redirects and external sites that don't answer.

Full walkthrough: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#link-checker

## Before you start
You need admin access to the CMS, to create two credentials under **Settings > API Keys**:
- the instance's **single key** for Optimizely Graph;
- an **API client** with read access. Copy its secret when you create it: it is shown only once.

Check **Settings > Applications** too: the host listed for each site should be the public https address visitors use.

## Settings
Save each section on its own. Every value you enter is checked when you save it.

1. **Site URL** (optional). Leave it blank in most cases: each page is then checked on the site set for its application in CMS Settings > Applications. Fill it in only to override that, with the site's public https address, for example `https://www.example.com`.
2. **Optimizely Graph single key** (required). Used to read published content, which is what visitors see.
3. **CMS API client ID and secret** (required). Used to read the version open in the editor (drafts included), to tell deleted content from unpublished content, and to read the site hosts in Settings > Applications.

### How the site is found
On each check the app uses the Site URL setting when it is filled in. Otherwise it uses the open page's own host, when that host is listed in Settings > Applications, so a CMS with several sites checks each page on its own site. Otherwise it uses the only primary host. If none applies, editors are asked to contact an admin to set the Site URL.

## What your site needs
- **Pages served at the URLs Graph reports.** A link to CMS content is checked at the page's URL in Graph (`_metadata.url`). A site that routes requests by Graph URL does this already.
- **No hidden URL rewriting.** If your site serves pages at other addresses than Graph reports, for example a different domain per language or an extra prefix, links show a false "Page not found". Make the site answer at Graph's URLs too; a redirect to the real address shows as "worth a look" rather than broken.
- **A public https address**, by host name, on the standard port.
- **Automated requests allowed.** Checks come from a server with `OptimizelyCmsLinkChecker` in the user agent. Bot protection or a login in front of the site makes every result "The site refused the check".

## Using it
Open a page and choose the **Link checker** tab on the right-hand rail. Broken links and links worth a look come first, each with where it sits on the page and what to do; links it couldn't check and links that are fine are folded away. Saving a draft doesn't re-run it, so press **Check again** after editing.

## Limits
- Variations can't be read through the CMS API, so on a variation the sidebar offers to check the original page.
- Up to 60 links per check, and shared blocks one level deep.
- A shared block opened on its own has no page address: on a CMS with several sites, checking it needs the Site URL setting.

## Security
The app opens links from its own server, so every request goes through a guard:
- only `http` and `https` on the standard ports, with no user name or password in the address;
- no numeric addresses, `localhost`, `*.local`, `*.internal` or single-word host names;
- the host name must resolve to public addresses only, and every redirect is checked again;
- links that fail the guard are listed as "Not checked", never opened.

The site address passes the same guard on every check, whether it comes from the Site URL setting or from Settings > Applications. The page address the editor sends is never opened; it only picks one of the hosts your CMS lists. Only status codes come back from a request, never page content.

## Troubleshooting
- **"The app is missing settings"**: fill in the Graph key and the API client, and save each section.
- **"This CMS has more than one site and this page's address isn't one of them"**: set the Site URL, or add the page's host to its application in Settings > Applications.
- **"This page's site address isn't a public https address"**: the page's host in Settings > Applications is a numeric address, a private name, uses another port or resolves to a private network. Correct it, or set the Site URL.
- **"The Site URL in the app settings doesn't lead to a public address any more"**: the Site URL now resolves to a private network. Correct it, or clear it to use Settings > Applications.
- **Every internal link shows "Page not found"**: the site serves pages at other addresses than Graph reports. See "What your site needs".

More: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting

Installing on another CMS instance: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse
