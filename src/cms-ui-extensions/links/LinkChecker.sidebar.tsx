import {Alert, Badge, Button, Group, Separator, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {CheckedLink, CheckOutcome, CheckResult, Verdict} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {OpenLink} from '../common/OpenLink';
import {useContent} from '../common/useContent';

const TITLE = 'Link checker';

const GROUPS: Array<{verdict: Verdict; title: string; intent: 'danger' | 'warning' | 'neutral' | 'success'}> = [
  {verdict: 'broken', title: 'Broken', intent: 'danger'},
  {verdict: 'warning', title: 'Worth a look', intent: 'warning'},
  {verdict: 'unchecked', title: "Couldn't check", intent: 'neutral'},
  {verdict: 'ok', title: 'Fine', intent: 'success'},
];

function LinkRow({link}: {link: CheckedLink}) {
  return (
    <Group flexDirection="column" gap="2">
      <Text fontSize="sm" style={{fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere'}}>
        {link.target}
      </Text>
      {link.text && <Text fontSize="xs">&ldquo;{link.text}&rdquo;</Text>}
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

function Results({result, onRecheck}: {result: CheckResult; onRecheck: () => void}) {
  const [showFine, setShowFine] = useState(false);
  const count = (v: Verdict) => result.links.filter((l) => l.verdict === v).length;

  if (result.links.length === 0) {
    return (
      <Group flexDirection="column" gap="8">
        <Alert intent="information">
          <Text fontSize="sm">No links or references found on this version.</Text>
        </Alert>
        <Button onClick={onRecheck}>Check again</Button>
      </Group>
    );
  }

  return (
    <Group flexDirection="column" gap="12">
      <Group flexWrap="wrap" gap="8">
        {GROUPS.filter((g) => count(g.verdict) > 0).map((g) => (
          <Badge intent={g.intent} key={g.verdict} variant="subtle">
            {count(g.verdict)} {g.title.toLowerCase()}
          </Badge>
        ))}
      </Group>
      {count('broken') === 0 && (
        <Alert intent="success">
          <Text fontSize="sm">Nothing broken on this version.</Text>
        </Alert>
      )}

      {GROUPS.map((g) => {
        const links = result.links.filter((l) => l.verdict === g.verdict);
        if (links.length === 0) return null;
        const hidden = g.verdict === 'ok' && !showFine;
        return (
          <Group flexDirection="column" gap="8" key={g.verdict}>
            <Separator />
            <Group alignItems="center" justifyContent="space-between">
              <Text fontSize="sm" fontWeight="600">
                {g.title} ({links.length})
              </Text>
              {g.verdict === 'ok' && (
                <Button appearance="subtle" onClick={() => setShowFine(!showFine)} size="sm">
                  {showFine ? 'Hide' : 'Show'}
                </Button>
              )}
            </Group>
            {!hidden &&
              links.map((link, i) => <LinkRow key={`${link.target}|${link.where}|${i}`} link={link} />)}
          </Group>
        );
      })}

      {result.skipped > 0 && (
        <Text color="fg.tertiary" fontSize="xs">
          {result.skipped} more links weren&apos;t checked: the sidebar checks the first 60.
        </Text>
      )}
      <Separator />
      <Group alignItems="center" justifyContent="space-between">
        <Text color="fg.tertiary" fontSize="xs">
          Checked {new Date(result.checkedAt).toLocaleTimeString()}
        </Text>
        <Button onClick={onRecheck} size="sm">
          Check again
        </Button>
      </Group>
    </Group>
  );
}

function LinkChecker({context}: {context: ExtensionContext}) {
  const content = useContent(context);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);

  const run = useCallback(
    async (key: string, version: string | null, locale: string) => {
      const id = ++requestId.current;
      setBusy(true);
      try {
        const next = await call(context, 'checkLinks', {key, version, locale});
        if (id !== requestId.current) return;
        setOutcome(next);
        setError(null);
      } catch (e) {
        if (id === requestId.current) setError(e);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [context],
  );

  useEffect(() => {
    if (content?.key) void run(content.key, content.version, content.locale);
    else setOutcome(null);
  }, [content?.key, content?.version, content?.locale, run]);

  if (!content) return <Frame busy title={TITLE} />;

  const result = outcome?.kind === 'checked' ? outcome.result : null;
  const subtitle = result
    ? `${result.displayName}, version ${result.version} (${result.locale}): ${result.links.length} links and references${
        result.sharedBlocks ? `, including ${result.sharedBlocks} shared blocks` : ''
      }.`
    : busy
      ? 'Reading the page and opening every link...'
      : undefined;

  return (
    <Frame busy={busy} error={error} subtitle={subtitle} title={TITLE}>
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
                This is the {outcome.variation} variation. The CMS API returns a variation&apos;s blocks without their
                values, so its links can&apos;t be read here.
              </Text>
            </Alert>
            {outcome.baseVersion && (
              <Button onClick={() => void run(content.key, outcome.baseVersion, content.locale)}>
                Check the original page instead
              </Button>
            )}
          </Group>
        )}
        {result && <Results onRecheck={() => void run(content.key, result.version, result.locale)} result={result} />}
      </div>
    </Frame>
  );
}

register((context) => <LinkChecker context={context} />);
