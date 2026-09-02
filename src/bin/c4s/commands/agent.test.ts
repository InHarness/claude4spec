import { describe, expect, it } from 'vitest';
import { parseArgs } from '../args.js';
import { runAgentCmd } from './agent.js';

/**
 * 0.2.64 — the create/attach predicate is a single condition (`--brief` present
 * → attach). That makes an EMPTY `--brief` dangerous in a way it never was
 * before: it used to land on the "neither attach nor create" error, and would
 * now fall through to create-mode and mint a brief. `--brief "$UNSET_VAR"` is
 * exactly the shape the skills use to pass a path between steps.
 */
describe('c4s agent — an empty --brief is an argument error, not a create request', () => {
  const run = (argv: string[]) => runAgentCmd(parseArgs(argv));

  it('rejects --brief with an empty value before any server discovery', async () => {
    await expect(run(['agent', 'msg', '--ct', 'brief', '--brief', ''])).rejects.toThrow(
      /--brief needs a path/,
    );
  });

  it('rejects a valueless --brief (parsed as a boolean flag)', async () => {
    await expect(run(['agent', 'msg', '--ct', 'brief', '--brief'])).rejects.toThrow(
      /--brief needs a path/,
    );
  });
});
