import type { ParsedArgs } from '../args.js';
import { CliError } from '../errors.js';

/**
 * `--select` belongs to `get-entities` alone.
 *
 * `list-entities`, `search-entities` and `resolve-identity` all answer with a
 * FIXED row — discovery returns keys, not content — so a projection is not
 * something they can narrow. Refusing is the point: silently ignoring the flag
 * would let a caller believe it had asked for a shape and read the answer as
 * that shape, which is the failure mode the whole `select`/row split exists to
 * remove. The message names the command that does take it.
 */
export function refuseSelect(args: ParsedArgs): void {
  if (!args.flags.has('select')) return;
  throw new CliError(
    'INVALID_ARGUMENT',
    '--select is not accepted here: this command answers with a fixed { slug, title } row. ' +
      'Use `c4s get-entities --type <t> --slugs <...> --select <fields>` to choose a record shape.',
  );
}
