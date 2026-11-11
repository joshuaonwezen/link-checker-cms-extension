# Link checker

## Setup
1. **Site**: the public https address of the website this CMS publishes to. Links to your own pages are opened there.
2. **Optimizely Graph**: the instance's single key, to find the URL a content link points at.
3. **CMS API client**: a client ID and secret, to read the version open in the editor.

## Using it
Open a page and open the **Link checker** tab on the right-hand rail. It lists every link it found with
where it sits on the page: broken links and those worth a look first, then (collapsed) the ones it couldn't
check and the ones that are fine. Saving a draft doesn't re-run it, so press **Check again** after you edit.

Variations can't be read, so on a variation it offers to check the original page.

Links that point to a private network address (for example `localhost` or an intranet name) are never opened:
they are listed as not checked.
