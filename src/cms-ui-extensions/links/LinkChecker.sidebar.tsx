import {Alert, Button, Disclosure, DisclosureContent, DisclosureTrigger, Group, Separator, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {CheckedLink, CheckOutcome, CheckResult, Verdict} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {OpenLink} from '../common/OpenLink';
import {useContent} from '../common/useContent';

// Problems first and open; what needs no action is collapsed.
const GROUPS: Array<{verdict: Verdict; title: string; collapsed: boolean}> = [
  {verdict: 'broken', title: 'Broken', collapsed: false},
  {verdict: 'warning', title: 'Worth a look', collapsed: false},
  {verdict: 'unchecked', title: "Couldn't check", collapsed: true},
  {verdict: 'ok', title: 'Fine', collapsed: true},
];

const MONO = {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere'} as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The editor's item a request was made for: results never outlive a switch to another one. */
function tagOf(key: string, version: string | null, locale: string): string {
  return `${key}|${version ?? ''}|${locale}`;
}

/**
 * What a row leads with: the link text, the content's name, or the address it opens. A
 * cms://content target is never shown: it means nothing to an editor.
 */
function describeLink(link: CheckedLink): {lead: string; detail?: string} {
  const address = /^cms:\/\//i.test(link.target) ? link.resolved : link.target;
  const text = link.text === 'image' ? 'Image' : link.text ? `“${link.text}”` : undefined;
  const lead = text ?? link.name ?? address ?? (link.kind === 'link' ? 'Linked page' : 'Block or image');
  return {lead, detail: address && address !== lead ? address : undefined};
}

function LinkRow({link}: {link: CheckedLink}) {
  const {lead, detail} = describeLink(link);
  return (
    <Group flexDirection="column" gap="2">
      <Text fontSize="sm" fontWeight="600" style={{overflowWrap: 'anywhere'}}>
        {lead}
      </Text>
      {detail && (
        <Text color="fg.secondary" fontSize="xs" style={MONO}>
          {detail}
        </Text>
      )}
      <Text color="fg.secondary" fontSize="xs">
        {link.kind === 'reference' ? 'Shown on the page' : 'Link'} · {link.where || 'Page properties'}
      </Text>
      <Text fontSize="xs" fontWeight="600">
        {link.status}
      </Text>
      {link.hint && (
        <Text color="fg.secondary" fontSize="xs">
          {link.hint}
        </Text>
      )}
      {link.openUrl && (
        <OpenLink appearance="subtle" size="sm" url={link.openUrl}>
          Open
        </OpenLink>
      )}
    </Group>
  );
}

function LinkList({links}: {links: CheckedLink[]}) {
  return (
    <Group flexDirection="column" gap="12" pt="8">
      {links.map((link, i) => (
        <LinkRow key={`${link.target}|${link.where}|${i}`} link={link} />
      ))}
    </Group>
  );
}

function Results({result}: {result: CheckResult}) {
  if (result.links.length === 0) {
    return (
      <Alert intent="information">
        <Text fontSize="sm">No links found on this version.</Text>
      </Alert>
    );
  }

  const groups = GROUPS.map((g) => ({...g, links: result.links.filter((l) => l.verdict === g.verdict)})).filter(
    (g) => g.links.length > 0,
  );
  const problems = result.links.some((l) => l.verdict === 'broken' || l.verdict === 'warning');

  return (
    <Group flexDirection="column" gap="12">
      {!problems && (
        <Alert intent="success">
          <Text fontSize="sm">Nothing to fix on this version.</Text>
        </Alert>
      )}
      {groups.map((g) => (
        <Group flexDirection="column" gap="8" key={g.verdict}>
          <Separator />
          {g.collapsed ? (
            <Disclosure>
              <DisclosureTrigger>
                {g.title} ({g.links.length})
              </DisclosureTrigger>
              <DisclosureContent>
                <LinkList links={g.links} />
              </DisclosureContent>
            </Disclosure>
          ) : (
            <>
              <Text fontSize="sm" fontWeight="600">
                {g.title} ({g.links.length})
              </Text>
              <LinkList links={g.links} />
            </>
          )}
        </Group>
      ))}
      {result.skipped > 0 && (
        <Text color="fg.tertiary" fontSize="xs">
          {result.skipped === 1 ? '1 more link wasn’t' : `${result.skipped} more links weren’t`} checked: the sidebar
          checks the first 60.
        </Text>
      )}
    </Group>
  );
}

interface Shown {
  tag: string;
  outcome: CheckOutcome | null;
  error: unknown;
}

function LinkChecker({context}: {context: ExtensionContext}) {
  const {content, ready} = useContent(context);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  // The version last asked for: the original page's, after "Check the original page instead".
  const lastVersion = useRef<{tag: string; version: string | null} | null>(null);

  const run = useCallback(
    async (key: string, version: string | null, locale: string, tag: string) => {
      const id = ++requestId.current;
      lastVersion.current = {tag, version};
      setBusy(true);
      try {
        const outcome = await call(context, 'checkLinks', {key, version, locale});
        if (id === requestId.current) setShown({tag, outcome, error: null});
      } catch (error) {
        if (id === requestId.current) setShown((prev) => ({tag, outcome: prev?.tag === tag ? prev.outcome : null, error}));
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [context],
  );

  // Draft edits keep the version, so this only re-runs on a switch; "Check again" covers edits.
  useEffect(() => {
    if (content?.key) {
      void run(content.key, content.version, content.locale, tagOf(content.key, content.version, content.locale));
    } else {
      // Nothing open: drop whatever is still in flight.
      requestId.current += 1;
      setBusy(false);
    }
  }, [content?.key, content?.version, content?.locale, run]);

  if (!ready) return <Frame busy />;
  if (!content) {
    return (
      <Frame>
        <Text color="fg.secondary">Open a page to check its links.</Text>
      </Frame>
    );
  }

  const tag = tagOf(content.key, content.version, content.locale);
  // Between a switch and the new answer, `shown` still describes the previous item: hide it.
  const current = shown?.tag === tag ? shown : null;
  const outcome = current?.outcome ?? null;
  const result = outcome?.kind === 'checked' ? outcome.result : null;
  const again = () => {
    const version = lastVersion.current?.tag === tag ? lastVersion.current.version : content.version;
    void run(content.key, version, content.locale, tag);
  };

  const original = Boolean(result && content.version && result.version !== content.version);
  const subtitle = result
    ? `${original ? 'Original page: ' : ''}${plural(result.links.length, 'link')} checked${
        result.sharedBlocks ? `, across the page and ${plural(result.sharedBlocks, 'shared block')}` : ''
      }`
    : busy && !outcome
      ? 'Opening every link on the page...'
      : undefined;

  return (
    <Frame busy={busy} error={current?.error} heading={result?.displayName} onRetry={again} subtitle={subtitle}>
      {outcome && outcome.kind !== 'variation' && (
        <Group alignItems="center" gap="8" justifyContent="space-between">
          <Button appearance="primary" disabled={busy} onClick={again}>
            Check again
          </Button>
          {result && (
            <Text color="fg.tertiary" fontSize="xs">
              Checked {new Date(result.checkedAt).toLocaleTimeString()}
            </Text>
          )}
        </Group>
      )}
      <div style={{opacity: busy && outcome ? 0.6 : 1, transition: 'opacity 120ms'}}>
        {outcome?.kind === 'nothing' && (
          <Alert intent="information">
            <Text fontSize="sm">{outcome.reason}</Text>
          </Alert>
        )}
        {outcome?.kind === 'variation' && (
          <Group flexDirection="column" gap="8">
            <Alert intent="information">
              <Text fontSize="sm">
                This is the {outcome.variation} variation. The link checker can only read the original page, not its
                variations.
              </Text>
            </Alert>
            {outcome.baseVersion && (
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => void run(content.key, outcome.baseVersion, content.locale, tag)}
              >
                Check the original page instead
              </Button>
            )}
          </Group>
        )}
        {result && <Results result={result} />}
      </div>
    </Frame>
  );
}

register((context) => <LinkChecker context={context} />);
