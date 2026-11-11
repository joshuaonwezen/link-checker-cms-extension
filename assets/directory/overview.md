# Link checker

Check every link on the page open in the editor, before visitors find the broken ones.

- A **Link checker** sidebar in the CMS editor:
  - opens each link to your own pages on your site, the way a visitor would, and checks external links;
  - flags links to content that was deleted or isn't published in the page's language - visitors can't reach it, and a site that builds links from Optimizely Graph usually drops such a link without any error;
  - flags blocks and images that no longer exist, and links that go through a redirect;
  - puts problems first, each with where it sits on the page and what to do about it.

It reads the page, its blocks and the shared blocks it uses, including links inside rich text and HTML, drafts included.

Works with any Optimizely SaaS CMS instance and any front end that serves pages at the URLs Optimizely Graph reports. On a CMS with several sites, each page is checked on its own site, taken from CMS Settings > Applications. Private network addresses are never opened.

Setup needs a Graph single key and a read-only CMS API client. Walkthrough: https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#link-checker
