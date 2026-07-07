import { optionalString, type ParsedArgs } from './args.js';
import { CliError } from './errors.js';
import { ALLOWED_MODELS, type Model } from '../../server/routes/models.js';

/**
 * Shared `--model` parsing for `c4s agent`/`c4s ask` — mirrors the existing
 * `--effort` pattern: an early, friendlier CLI-level check before `runAgent`
 * would otherwise forward an invalid value straight to the server (which
 * silently falls back to its own default instead of failing fast).
 */
export function parseModelFlag(args: ParsedArgs): Model | undefined {
  const raw = optionalString(args, 'model');
  if (raw === undefined) return undefined;
  if (!(ALLOWED_MODELS as readonly string[]).includes(raw)) {
    throw new CliError('INVALID_ARGS', `--model must be one of: ${ALLOWED_MODELS.join('|')}`);
  }
  return raw as Model;
}
