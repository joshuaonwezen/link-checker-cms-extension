import {Alert, Button, Disclosure, DisclosureContent, DisclosureTrigger, Group, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {CheckedLink, CheckOutcome, CheckResult, Verdict} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {OpenLink} from '../common/OpenLink';
import {Chip, Code, count, type ChipState} from '../common/ui';
import {useContent} from '../common/useContent';

// Problems first and open; what needs no action is folded away.
const GROUPS: Array<{verdict: Verdict; title: string; collapsed: boolean}> = [
  {verdict: 'broken', title: 'Broken', collapsed: false},
  {verdict: 'warning', title: 'Worth a look', collapsed: false},
  {verdict: 'unchecked', title: "Couldn't check", collapsed: true},
  {verdict: 'ok', title: 'Fine', collapsed: true},
];

const STATE: Record<Verdict, ChipState> = {broken: 'bad', warning: 'warn', unchecked: 'neutral', ok: 'good'};

const SUMMARY: Record<Verdict, (n: number) => string> = {
  broken: (n) => `${n} broken`,
  warning: (n) => `${n} worth a look`,
  unchecked: (n) => `${n} not checked`,
  ok: (n) => `${n} fine`,
};

const TIME = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit'});

/**
 * The page's address, for the backend to tell which of the CMS's sites it is on: sent only
 * when it is a full https URL, the only kind the backend accepts.
 */
function pageUrlOf(publicUrl: string | null): string | null {
  return publicUrl && /^https:\/\//i.test(publicUrl) && publicUrl.length <= 2048 ? publicUrl : null;
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

/**
 * The status as a short chip, and the rest of it as a line under it: "Not checked: points to
 * a private address" becomes "Not checked" + "Points to a private address", and "Redirects to
 * /x" becomes "Redirects" (its hint says where to).
 */
function splitStatus(status: string): {label: string; more?: string} {
  // The hint already names where it goes ("Link to /x directly").
  if (/^Redirects to /.test(status)) return {label: 'Redirects'};
  const at = status.indexOf(': ');
  if (at < 0) return {label: status};
  const rest = status.slice(at + 2);
  return {label: status.slice(0, at), more: rest.charAt(0).toUpperCase() + rest.slice(1)};
}

function LinkRow({link}: {link: CheckedLink}) {
  const {lead, detail} = describeLink(link);
  const {label, more} = splitStatus(link.status);
  return (
    <div className="ui-item">
      <div className="ui-row" style={{minHeight: 24}}>
        <span className="ui-name" title={lead}>
          {lead}
        </span>
        {link.openUrl && (
          <OpenLink appearance="subtle" iconOnly size="sm" url={link.openUrl}>
            Open
          </OpenLink>
        )}
      </div>
      {link.verdict !== 'ok' && (
        <div>
          <Chip label={label} state={STATE[link.verdict]} />
        </div>
      )}
      {detail && <Code wrap>{detail}</Code>}
      <span className="ui-faint ui-small">
        {link.kind === 'reference' ? 'Shown on the page' : 'Link'} · {link.where || 'Page properties'}
      </span>
      {link.verdict !== 'ok' && (more || link.hint) && (
        <span className="ui-muted ui-small">{[more, link.hint].filter(Boolean).join('. ')}</span>
      )}
    </div>
  );
}

function LinkList({links}: {links: CheckedLink[]}) {
  return (
    <div>
      {links.map((link, i) => (
        <LinkRow key={`${link.target}|${link.where}|${i}`} link={link} />
      ))}
    </div>
  );
}

/** One verdict's links in a card: problems open, the rest folded away. */
function GroupCard({title, links, collapsed}: {title: string; links: CheckedLink[]; collapsed: boolean}) {
  if (collapsed) {
    return (
      <div className="ui-card" data-folded="">
        <Disclosure>
          <DisclosureTrigger>
            <Text fontSize="sm" fontWeight="600">
              {title} · {links.length}
            </Text>
          </DisclosureTrigger>
          <DisclosureContent>
            <div style={{padding: '4px 8px 8px 12px'}}>
              <LinkList links={links} />
            </div>
          </DisclosureContent>
        </Disclosure>
      </div>
    );
  }
  return (
    <div className="ui-card">
      <div className="ui-card-title">
        <span>{title}</span>
        <span className="ui-faint ui-small">{count(links.length, 'link')}</span>
      </div>
      <LinkList links={links} />
    </div>
  );
}

function Summary({result, busy, onCheckAgain}: {result: CheckResult; busy: boolean; onCheckAgain: () => void}) {
  const tally = GROUPS.map((g) => ({verdict: g.verdict, n: result.links.filter((l) => l.verdict === g.verdict).length})).filter(
    (t) => t.n > 0,
  );
  const problems = result.links.some((l) => l.verdict === 'broken' || l.verdict === 'warning');
  return (
    <Group flexDirection="column" gap="4">
      <Group alignItems="start" gap="8" justifyContent="space-between">
        <div className="ui-chips">
          {!problems && result.links.length > 0 && <Chip label="Nothing to fix" state="good" />}
          {tally
            .filter((t) => problems || t.verdict !== 'ok')
            .map((t) => (
              <Chip key={t.verdict} label={SUMMARY[t.verdict](t.n)} state={STATE[t.verdict]} />
            ))}
        </div>
        <Button appearance="subtle" disabled={busy} onClick={onCheckAgain} size="sm">
          Check again
        </Button>
      </Group>
      <span className="ui-faint ui-small">Checked at {TIME.format(new Date(result.checkedAt))}</span>
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
  return (
    <Group flexDirection="column" gap="12">
      {GROUPS.map((g) => ({...g, links: result.links.filter((l) => l.verdict === g.verdict)}))
        .filter((g) => g.links.length > 0)
        .map((g) => (
          <GroupCard collapsed={g.collapsed} key={g.verdict} links={g.links} title={g.title} />
        ))}
      {result.skipped > 0 && (
        <span className="ui-faint ui-small">
          {result.skipped === 1 ? '1 more link wasn’t' : `${result.skipped} more links weren’t`} checked: the sidebar checks
          the first 60.
        </span>
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
    async (key: string, version: string | null, locale: string, publicUrl: string | null, tag: string) => {
      const id = ++requestId.current;
      lastVersion.current = {tag, version};
      setBusy(true);
      try {
        const outcome = await call(context, 'checkLinks', {key, version, locale, publicUrl: pageUrlOf(publicUrl)});
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
      void run(
        content.key,
        content.version,
        content.locale,
        content.publicUrl,
        tagOf(content.key, content.version, content.locale),
      );
    } else {
      // Nothing open: drop whatever is still in flight.
      requestId.current += 1;
      setBusy(false);
    }
  }, [content?.key, content?.version, content?.locale, content?.publicUrl, run]);

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
    void run(content.key, version, content.locale, content.publicUrl, tag);
  };

  const original = Boolean(result && content.version && result.version !== content.version);
  const subtitle = result
    ? `${original ? 'Original page: ' : ''}${count(result.links.length, 'link')} checked${
        result.sharedBlocks ? `, across the page and ${count(result.sharedBlocks, 'shared block')}` : ''
      }`
    : busy && !outcome
      ? 'Opening every link on the page…'
      : undefined;

  return (
    <Frame busy={busy} error={current?.error} heading={result?.displayName} onRetry={again} subtitle={subtitle}>
      <Group flexDirection="column" gap="12" style={{opacity: busy && outcome ? 0.6 : 1, transition: 'opacity 120ms'}}>
        {result && <Summary busy={busy} onCheckAgain={again} result={result} />}
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
                onClick={() => void run(content.key, outcome.baseVersion, content.locale, content.publicUrl, tag)}
              >
                Check the original page instead
              </Button>
            )}
          </Group>
        )}
        {result && <Results result={result} />}
      </Group>
    </Frame>
  );
}

register((context) => <LinkChecker context={context} />);
