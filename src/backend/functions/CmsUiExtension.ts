import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {Envelope} from '../../shared/types';
import {ActionError, createChecker} from '../lib/checker';
import {ApiError} from '../lib/http';
import {loadConfig} from '../lib/settings';

interface RequestBody {
  action?: unknown;
  params?: {key?: unknown; version?: unknown; locale?: unknown};
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (action !== 'checkLinks') return new App.Response(400, fail('unknown_action', action));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const loaded = await loadConfig();
      if (!loaded.ok) {
        return new App.Response(412, fail('not_configured', `Missing in the app settings: ${loaded.missing.join(', ')}.`));
      }
      const params = body.params ?? {};
      const outcome = await createChecker(loaded.config).checkLinks({
        key: text(params.key),
        version: text(params.version) || null,
        locale: text(params.locale) || 'en',
      });
      logger.info('checkLinks', text(params.key), outcome.kind, outcome.kind === 'checked' ? outcome.result.links.length : '');
      return new App.Response(200, ok(outcome));
    } catch (error) {
      if (error instanceof ActionError) return new App.Response(400, fail(error.code, error.message));
      if (error instanceof ApiError) {
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code, error.message));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
