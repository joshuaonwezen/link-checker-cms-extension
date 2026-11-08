import type {Verdict} from '../../shared/types';

export interface Judgement {
  verdict: Verdict;
  status: string;
  hint?: string;
  resolved?: string;
}

/** What one request answered: an HTTP status (and Location), or no answer at all. */
export type Answer = {status: number; location?: string | null} | {failure: 'timeout' | 'error'};

function stripSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The redirect only adds or drops a trailing slash or changes case: the link works as it is. */
export function isCosmeticRedirect(from: string, location: string): boolean {
  let to = location;
  try {
    to = new URL(location, 'https://placeholder.invalid').pathname;
  } catch {
    return false;
  }
  const fromPath = from.split(/[?#]/)[0];
  return stripSlash(fromPath).toLowerCase() === stripSlash(to).toLowerCase();
}

/** An internal path opened on the site with redirect: manual. */
export function judgeInternal(path: string, answer: Answer): Judgement {
  if ('failure' in answer) {
    return {
      verdict: 'unchecked',
      status: answer.failure === 'timeout' ? 'The site took too long to answer' : 'The site could not be reached',
      hint: 'Check the Site URL in the app settings, or try again.',
    };
  }
  const {status, location} = answer;
  if (status >= 200 && status < 300) return {verdict: 'ok', status: `${status} on the site`};
  if (status >= 300 && status < 400) {
    if (location && isCosmeticRedirect(path, location)) return {verdict: 'ok', status: `${status} to the same page`};
    const to = location ? new URL(location, 'https://placeholder.invalid').pathname : null;
    return {
      verdict: 'warning',
      status: `Redirects (${status})${to ? ` to ${to}` : ''}`,
      hint: to ? `Link to ${to} directly - one hop fewer for visitors and search engines.` : undefined,
      resolved: to ?? undefined,
    };
  }
  if (status === 404 || status === 410) {
    return {verdict: 'broken', status: `${status} on the site`, hint: 'Visitors get a not-found page. Fix or remove the link.'};
  }
  if (status >= 500) return {verdict: 'warning', status: `The site answered ${status}`, hint: 'Could be passing - check again.'};
  return {verdict: 'warning', status: `The site answered ${status}`};
}

/** An external URL, requests following redirects. */
export function judgeExternal(answer: Answer): Judgement {
  if ('failure' in answer) {
    return {
      verdict: 'unchecked',
      status: answer.failure === 'timeout' ? 'No answer in time' : 'Could not connect',
      hint: 'Open it to check by hand.',
    };
  }
  const {status} = answer;
  if (status >= 200 && status < 400) return {verdict: 'ok', status: `${status}`};
  if (status === 404 || status === 410) return {verdict: 'broken', status: `${status}`, hint: 'The page is gone. Fix or remove the link.'};
  if (status === 401 || status === 403 || status === 429) {
    return {verdict: 'unchecked', status: `${status}: the site refuses automated checks`, hint: 'Open it to check by hand.'};
  }
  if (status >= 500) return {verdict: 'warning', status: `${status}`, hint: 'The other site is having problems - check again later.'};
  return {verdict: 'warning', status: `${status}`};
}

const ORDER: Record<Verdict, number> = {broken: 0, warning: 1, unchecked: 2, ok: 3};

export function byVerdict<T extends {verdict: Verdict}>(a: T, b: T): number {
  return ORDER[a.verdict] - ORDER[b.verdict];
}
