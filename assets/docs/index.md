# Link checker

## Setup
1. **Site**: the front end that renders this CMS instance. Internal links are opened there.
2. **Optimizely Graph**: the instance's single key, to find the URL a content link points at.
3. **CMS API client**: a client ID and secret, to read the version open in the editor.

## Using it
Open a page and open the **Link checker** tab on the right-hand rail. It lists every link it found with
where it sits on the page, grouped as broken, worth a look, and fine. **Check again** re-runs it after you edit.

Variation versions can't be read through the CMS API, so on a variation it offers to check the original page.
