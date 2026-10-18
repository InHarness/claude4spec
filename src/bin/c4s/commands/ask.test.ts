import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { runAsk_cli } from './ask.js';

/**
 * `c4s ask` is locked to the read-only ask context and refuses every context
 * flag of `c4s agent` — 2.1.29 adds `--plan` to `--ct` / `--brief`.
 */
describe('c4s ask — context flags are refused locally', () => {
  const run = (argv: string[]) => runAsk_cli(parseArgs(argv));

  it('[ac:ac-c4s-ask-z-plan-konczy-sie-invalid-arg] `c4s ask … --plan` → INVALID_ARGS before any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(run(['ask', 'msg', '--plan', 'auth-refactor.md'])).rejects.toMatchObject({
        code: 'INVALID_ARGS',
        message: expect.stringMatching(/does not take --plan/),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
