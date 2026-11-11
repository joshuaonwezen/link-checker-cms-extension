import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {Envelope} from '../../shared/types';
import {createChecker} from '../lib/checker';
import {ActionError} from '../lib/errors';
import {ApiError} from '../lib/http';
import {loadConfig} from '../lib/settings';
import {isAction, PARSERS} from '../lib/validate';

interface RequestBody {
  action?: unknown;
  params?: unknown;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!isAction(action)) return new App.Response(400, fail('unknown_action', action.slice(0, 64)));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const raw = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const params = PARSERS[action](raw as Record<string, unknown>);

      const loaded = await loadConfig();
      if (!loaded.ok) {
        return new App.Response(412, fail('not_configured', `Missing in the app settings: ${loaded.missing.join(', ')}.`));
      }
      const outcome = await createChecker(loaded.config).checkLinks(params);
      logger.info('checkLinks', params.key, outcome.kind, outcome.kind === 'checked' ? outcome.result.links.length : '');
      return new App.Response(200, ok(outcome));
    } catch (error) {
      if (error instanceof ActionError) return new App.Response(400, fail(error.code, error.message));
      if (error instanceof ApiError) {
        // The detail (status, start of the upstream body) is for the logs; the sidebar words
        // the code for editors.
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
