import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {CMS_EXTENSION_FUNCTION_ID} from '@shared/constants';
import type {ActionName, ActionParams, ActionResults, Envelope} from '@shared/types';

export class CallError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'CallError';
    this.code = code;
  }
}

// Shown to editors: plain words, and an admin to ask when only the settings can fix it.
const FALLBACK_MESSAGES: Record<string, string> = {
  not_configured: 'The app is missing settings.',
  site_unknown:
    "This CMS has more than one site and this page's address isn't one of them. Ask a CMS admin to set the Site URL in the app settings.",
  site_refused: "The link checker won't open this page's site address. Ask a CMS admin to check the app's settings.",
  cms_unauthorized: "The CMS turned down the app's API client. Ask a CMS admin to check the app's settings.",
  cms_rate_limited: 'The CMS is busy. Try again in a moment.',
  graph_unauthorized: "The app's key for reading published content was turned down. Ask a CMS admin to check the app's settings.",
  graph_rate_limited: 'Too many requests at once. Try again in a moment.',
  internal_error: 'Something went wrong in the link checker. Try again.',
  backend_unreachable: 'The link checker stopped before answering. Try again, and if it keeps happening, tell a CMS admin.',
};
const GENERIC_MESSAGE = "The link checker couldn't finish. Try again in a moment.";

/** Calls one backend action; resolves with its result or throws CallError. */
export async function call<A extends ActionName>(
  context: ExtensionContext,
  action: A,
  params: ActionParams[A],
): Promise<ActionResults[A]> {
  // The CMS rejects with an empty "[ExtensionService] Failed to invoke function:" when the
  // backend throws instead of answering.
  const response = await context.extension.invokeFunction(CMS_EXTENSION_FUNCTION_ID, {action, params}).catch(() => {
    throw new CallError('backend_unreachable', FALLBACK_MESSAGES.backend_unreachable);
  });
  const envelope = response.data as Envelope<ActionResults[A]> | undefined;
  if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
    if (envelope.ok) return envelope.result;
    throw new CallError(envelope.error, envelope.message || FALLBACK_MESSAGES[envelope.error] || GENERIC_MESSAGE);
  }
  throw new CallError('request_failed', GENERIC_MESSAGE);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

// Answers only a CMS admin can fix: shown as a warning, with no Retry.
const ADMIN_FIXES = new Set(['not_configured', 'site_unknown', 'site_refused']);

export function isNotConfigured(error: unknown): boolean {
  return error instanceof CallError && error.code === 'not_configured';
}

export function needsAdmin(error: unknown): boolean {
  return error instanceof CallError && ADMIN_FIXES.has(error.code);
}
