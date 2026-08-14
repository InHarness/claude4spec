import type { ParsedArgs } from '../args.js';
import { refuseFlags, requireString } from '../args.js';
import { delegateGet } from '../delegate.js';
import { writeOutput } from '../output.js';
import { normalizeEntityType } from '../type-validation.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.22 — the `cli` rendering of `get_field_content`.
 *
 *   c4s get-field-content --type <t> --slug <s> --field <f>
 *
 * A content-bearing field is carried by no generic read, on any surface: what
 * `get-entities` answers with is `has<Field>`, `<field>Bytes` and the name of
 * the operation that will hand the content over. This is that operation.
 *
 * `c4s describe --type <t>` lists a type's `contentFields`, each with the
 * operation that issues it — that is where a caller finds out this command is
 * the one to run.
 *
 * No paging: the answer is one field of one entity, so there is no window to
 * take. A field too large for a caller's context is the caller's problem to
 * solve by not asking, which is exactly what the byte count in the descriptor is
 * for.
 */
export async function runGetFieldContent(args: ParsedArgs): Promise<void> {
  const type = normalizeEntityType(requireString(args, 'type'));
  const slug = requireString(args, 'slug');
  const field = requireString(args, 'field');
  refuseFlags(args, ['limit', 'offset'], 'get-field-content answers one field of one entity');

  writeOutput(await delegateGet(args, `/entities/${type}/${slug}/content/${field}`, {}), args);
}

export const getFieldContentCommand: CliCommandContribution = {
  name: 'get-field-content',
  operation: 'get_field_content',
  executionMode: 'server-delegating',
  errorCodes: ['INVALID_TYPE', 'INVALID_ARGS', 'INVALID_ARGUMENT', 'ENTITY_NOT_FOUND'],
  handler: runGetFieldContent,
};
