// The contract between the sidebar and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

export type Envelope<T> =
  | {ok: true; result: T}
  | {ok: false; error: string; message?: string};

/**
 * A link a visitor follows (a url field, an <a href> in rich text or HTML, an <img src>), or a
 * reference the page renders in place (a block in a content area, an image field).
 */
export type LinkKind = 'link' | 'reference';

export interface FoundLink {
  /** As stored: a path, a URL, or cms://content/{key}. */
  target: string;
  kind: LinkKind;
  /** Where it sits, e.g. "Home Hero > Link URL" or "Quote - Sarah Chen (shared block) > Text". */
  where: string;
  /** The link text, when it came from rich text or HTML. */
  text?: string;
}

/** broken: visitors hit it. warning: works, but worth a look. unchecked: couldn't tell. */
export type Verdict = 'broken' | 'warning' | 'unchecked' | 'ok';

export interface CheckedLink extends FoundLink {
  verdict: Verdict;
  /** One line in plain words, e.g. "Page not found". */
  status: string;
  /** What to do about it. */
  hint?: string;
  /** Where it really goes: the page a content link resolves to, or a redirect's target. */
  resolved?: string;
  /** The CMS name of the content a cms://content link or reference points at, when it still exists. */
  name?: string;
  /** A URL to open it in a new tab, when there is one. */
  openUrl?: string;
}

export interface CheckResult {
  key: string;
  version: string;
  locale: string;
  displayName: string;
  /** Worst first. */
  links: CheckedLink[];
  /** Links found past the cap, not checked. */
  skipped: number;
  /** Shared blocks whose links were read too. */
  sharedBlocks: number;
  checkedAt: string;
}

export type CheckOutcome =
  | {kind: 'checked'; result: CheckResult}
  /** The CMS API returns a variation's blocks without their values, so its links can't be read. */
  | {kind: 'variation'; variation: string; baseVersion: string | null}
  | {kind: 'nothing'; reason: string};

export type ActionParams = {
  /** publicUrl: the open page's full URL as the editor reports it, used only to tell which of the CMS's sites it is on. */
  checkLinks: {key: string; version: string | null; locale: string; publicUrl: string | null};
};

export type ActionResults = {
  checkLinks: CheckOutcome;
};

export type ActionName = keyof ActionParams;
