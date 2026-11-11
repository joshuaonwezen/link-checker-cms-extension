import type {Verdict} from '../../shared/types';
import type {Answer, Guarded, Refusal} from './outbound';

// Every status and hint here is shown to editors as is: plain words, no status codes.

export interface Judgement {
  verdict: Verdict;
  status: string;
  hint?: string;
  resolved?: string;
}

const PLACEHOLDER = 'https://placeholder.invalid';
const BY_HAND = 'Open it to check by hand.';

function stripSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The redirect only adds or drops a trailing slash or changes case: the link works as it is. */
export function isCosmeticRedirect(from: string, location: string): boolean {
  let to = location;
  try {
    to = new URL(location, PLACEHOLDER).pathname;
  } catch {
    return false;
  }
  const fromPath = from.split(/[?#]/)[0];
  return stripSlash(fromPath).toLowerCase() === stripSlash(to).toLowerCase();
}

/** Where a redirect goes: a path on the site, or the full URL when it leaves the site. */
function redirectTarget(location: string, siteOrigin?: string): string | null {
  try {
    const url = new URL(location, siteOrigin ?? PLACEHOLDER);
    const onSite = url.origin === PLACEHOLDER || !siteOrigin || url.origin === siteOrigin;
    return onSite ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return null;
  }
}

/** An internal path opened on the site with redirect: manual. */
export function judgeInternal(path: string, answer: Answer, siteOrigin?: string): Judgement {
  if ('failure' in answer) {
    return {
      verdict: 'unchecked',
      status: answer.failure === 'timeout' ? 'The site took too long to answer' : "Couldn't reach the site",
      hint: "Try again in a moment. If it keeps happening, ask a CMS admin to check the site address in the app's settings.",
    };
  }
  const {status, location} = answer;
  if (status >= 200 && status < 300) return {verdict: 'ok', status: 'Works'};
  if (status >= 300 && status < 400) {
    if (location && isCosmeticRedirect(path, location)) return {verdict: 'ok', status: 'Works'};
    const to = location ? redirectTarget(location, siteOrigin) : null;
    return {
      verdict: 'warning',
      status: to ? `Redirects to ${to}` : 'Redirects',
      hint: to ? `Link to ${to} directly - one step fewer for visitors and search engines.` : undefined,
      resolved: to ?? undefined,
    };
  }
  if (status === 404 || status === 410) {
    return {verdict: 'broken', status: 'Page not found', hint: 'Visitors get a not-found page. Fix or remove the link.'};
  }
  if (status === 401 || status === 403 || status === 429) return {verdict: 'warning', status: 'The site refused the check'};
  if (status >= 500) return {verdict: 'warning', status: 'The site had an error', hint: 'Could be passing - check again.'};
  return {verdict: 'warning', status: 'The site answered with an error'};
}

const REFUSED: Record<Refusal, {status: string; hint: string}> = {
  private: {
    status: 'Not checked: points to a private address',
    hint: "Visitors outside your organization's network can't open it. Check the link is right.",
  },
  numeric: {status: 'Not checked: uses a numeric address instead of a site name', hint: BY_HAND},
  port: {status: 'Not checked: uses an unusual port number', hint: BY_HAND},
  credentials: {
    status: 'Not checked: contains a user name or password',
    hint: 'Anyone who sees the page can read them. Remove them from the link.',
  },
  scheme: {status: 'Not checked: redirects to something that is not a web page', hint: BY_HAND},
};

/** An external URL, its redirects followed by guardedFetch. */
export function judgeExternal(answer: Guarded): Judgement {
  if ('refused' in answer) return {verdict: 'unchecked', ...REFUSED[answer.refused]};
  if ('failure' in answer) {
    const status = {timeout: 'Took too long to answer', error: "Couldn't reach it", redirects: 'Redirects too many times'}[answer.failure];
    return {verdict: 'unchecked', status, hint: BY_HAND};
  }
  const {status} = answer;
  if (status >= 200 && status < 400) return {verdict: 'ok', status: 'Works'};
  if (status === 404 || status === 410) return {verdict: 'broken', status: 'Page not found', hint: 'The page is gone. Fix or remove the link.'};
  if (status === 401 || status === 403 || status === 429) return {verdict: 'unchecked', status: 'The site refused the check', hint: BY_HAND};
  if (status >= 500) return {verdict: 'warning', status: 'The site had an error', hint: 'Could be passing - check again later.'};
  return {verdict: 'warning', status: 'The site answered with an error'};
}

const ORDER: Record<Verdict, number> = {broken: 0, warning: 1, unchecked: 2, ok: 3};

export function byVerdict<T extends {verdict: Verdict}>(a: T, b: T): number {
  return ORDER[a.verdict] - ORDER[b.verdict];
}
