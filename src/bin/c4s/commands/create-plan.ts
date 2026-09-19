import fs from 'node:fs';
import path from 'node:path';
import type { ParsedArgs } from '../args.js';
import { optionalString } from '../args.js';
import { delegatePost } from '../delegate.js';
import { CliError } from '../errors.js';
import { writeOutput } from '../output.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

const USAGE = 'usage: c4s create-plan --title <t> --body-file <path> --project <slug> --workspace <name>';

/**
 * `c4s create-plan` — found a plan whose content the CALLER already wrote,
 * together with the thread that carries it.
 *
 *   c4s create-plan --title <t> --body-file <path> --project <slug> --workspace <name>
 *
 * 0.2.98 (M10 → M11). The one plan command in this bin: the other six plan
 * operations are called by an agent or the UI, not by a person in a terminal.
 * Before it, the only way to leave a plan from outside was to order a turn and
 * hope it wrote one. `server-delegating` with zero logic here — the semantics
 * (slug, `PLAN_ALREADY_EXISTS`, the carrier thread, all-or-nothing) live in
 * `PlanService.create`, the same function the REST handler and the MCP tool
 * call. No turn runs in the carrier thread.
 *
 * The body comes from a file, never an argument (a shell would interpolate the
 * backticks and quotes a plan is full of), and its readability is checked HERE,
 * before the server is even resolved — a typo in a path is not the server's
 * business.
 */
export async function runCreatePlan(args: ParsedArgs): Promise<void> {
  const title = optionalString(args, 'title');
  if (!title) {
    throw new CliError('INVALID_ARGUMENT', '--title <t> is required: it names the plan and fixes its path for good', USAGE);
  }
  const bodyFile = optionalString(args, 'body-file');
  if (!bodyFile) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--body-file <path> is required: the plan content is read from a file, never from an argument',
      USAGE,
    );
  }
  const resolved = path.resolve(process.cwd(), bodyFile);
  let content: string;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `--body-file is not readable: ${resolved} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
      'pass a path to a readable file holding the plan content',
    );
  }

  const created = (await delegatePost(args, '/plans', { title, content })) as {
    planPath: string;
    hash: string;
    threads: string[];
  };

  // `hash` rides along because it arms the first `update_plan` without a read.
  writeOutput({ planPath: created.planPath, hash: created.hash }, args);
}

export const createPlanCommand: CliCommandContribution = {
  name: 'create-plan',
  operation: 'create_plan',
  executionMode: 'server-delegating',
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGUMENT', 'VALIDATION', 'PLAN_ALREADY_EXISTS'],
  handler: runCreatePlan,
};
