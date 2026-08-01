import type { ParsedArgs } from '../args.js';
import { optionalInt, optionalString } from '../args.js';
import { createContext } from '../context.js';
import { writeOutput } from '../output.js';
import { CliError } from '../errors.js';
import type { CliCommandContribution } from '../registry.js';

/**
 * 0.2.6 — `check_consistency` on the CLI: the spec's own diagnostics (broken
 * references, drift between disk and index).
 *
 *   c4s check-consistency [--severity error|warning] [--rule <r>] [--limit <n>]
 *
 * `--limit` but no `--offset`: this is a REPORT, not a paginable collection.
 * `summary` always carries the full counts, so a truncated report still says how
 * much was truncated — and paging through violations is not what anyone does
 * with them. `--rule` takes either the number or the name, so a caller who read
 * the report can filter by what it saw without a lookup table.
 */
export async function runCheckConsistency(args: ParsedArgs): Promise<void> {
  const rawSeverity = optionalString(args, 'severity');
  if (rawSeverity !== undefined && rawSeverity !== 'error' && rawSeverity !== 'warning') {
    throw new CliError('INVALID_ARGS', `--severity must be 'error' or 'warning', got '${rawSeverity}'`);
  }
  const rule = optionalString(args, 'rule');
  const limit = optionalInt(args, 'limit');

  const ctx = await createContext(args);
  try {
    writeOutput(
      await ctx.discovery.checkConsistency({
        ...(rawSeverity ? { severity: rawSeverity } : {}),
        ...(rule ? { rule } : {}),
        ...(limit === undefined ? {} : { limit }),
      }),
      args,
    );
  } finally {
    ctx.close();
  }
}

export const checkConsistencyCommand: CliCommandContribution = {
  name: 'check-consistency',
  executionMode: 'readonly-reader',
  errorCodes: ['INVALID_ARGS', 'INVALID_ARGUMENT'],
  handler: runCheckConsistency,
};
