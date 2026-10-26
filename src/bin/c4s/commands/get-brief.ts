import type { ParsedArgs } from '../args.js';
import { delegateGet } from '../delegate.js';
import { AgentError, encodeArtifactPath } from '../../../core/agent/http.js';
import { CliError, type CliErrorCode } from '../errors.js';
import { writeOutput } from '../output.js';
import { optionalString } from '../args.js';
import { SERVER_DELEGATING_CODES, type CliCommandContribution } from '../registry.js';

/**
 *   c4s get-brief <brief-path> [--range <start>-<end>] [--format json|text]
 *
 * `<brief-path>` is relative to the `briefs` root's dir — parity with the `--brief` argument
 * elsewhere.
 *
 * 0.2.13 — `server-delegating`, over `GET /api/artifacts/brief/<path>`.
 *
 * 0.2.40 — `--range` is the artifact read family's window (2.1.8: `c4s get-page`
 * no longer has one — page reads resume through the outline). It is unconditionally available: a brief never enters
 * `section_index`, so a line window is the only way to read a large one through,
 * and there is no root kind for it to be gated on.
 *
 * 2.1.48 (M36 `r2nekhf5`) — the command is the `rest` rendering of `get_brief`,
 * so it reads the detail route's OPERATION projection (`?view=operation`), not
 * the editor's whole-file default. The window and the budget belong to that
 * projection: the bin computes no budget, cuts nothing and does not validate
 * `--range` — the raw value goes to the server, which judges it. When the
 * budget cut the answer, `truncated` + `truncationHint` pass through, the hint
 * rewritten from the route's query spelling into a runnable `c4s get-brief`
 * call with `--range`.
 */
export async function runGetBrief(args: ParsedArgs): Promise<void> {
  const briefPath = args.positional[0];
  if (!briefPath) {
    throw new CliError(
      'INVALID_ARGS',
      'get-brief requires a brief path',
      'usage: c4s get-brief <brief-path>',
    );
  }
  /**
   * The traversal guard stays HERE, and cannot be delegated.
   *
   * `readBriefFs` used to refuse `../..` via `assertSafeRelPath` before reading
   * anything. Moving the read to the server does not move that check with it,
   * because the traversal never arrives at the server as a path:
   * `encodeURIComponent` leaves `..` untouched (it is not a reserved character),
   * and WHATWG URL resolution inside `fetch` collapses the dot segments before
   * the request goes out. So `c4s get-brief ../../config` was rewritten into
   * `GET /api/projects/<id>/config` — a different, existing endpoint, which
   * answers 200 with the project config. The command then printed `{}` (none of
   * `frontmatter`/`body`/`content` are on that payload) and exited 0.
   *
   * A confidently empty answer where the old code refused outright.
   * `encodeArtifactPath` refuses it again, before the URL is built.
   */
  try {
    const encoded = encodeArtifactPath(briefPath);
    const range = optionalString(args, 'range');
    const brief = (await delegateGet(args, `/artifacts/brief/${encoded}`, {
      view: 'operation',
      ...(range !== undefined ? { range } : {}),
    })) as {
      frontmatter: unknown;
      body: string;
      content: string;
      truncated?: true;
      truncationHint?: string;
    };
    // The same three fields the filesystem reader answered with, in the same
    // order: a caller piping this into `jq '.body'` must not have to change.
    // `truncated`/`truncationHint` join them only when something was cut — a
    // reader that never hits the budget sees the payload it always saw.
    writeOutput(
      {
        frontmatter: brief.frontmatter,
        body: brief.body,
        content: brief.content,
        ...(brief.truncated
          ? { truncated: brief.truncated, truncationHint: toCliHint(brief.truncationHint, briefPath) }
          : {}),
      },
      args,
    );
  } catch (raw) {
    /**
     * Any `AgentError` becomes a `CliError` carrying the SAME code.
     *
     * `encodeArtifactPath` throws one, and it used to be thrown outside this
     * block — so the traversal refusal reached the bin's generic fallback and
     * was reported as `UNKNOWN_COMMAND`, exit 1. The refusal was correct and its
     * exit status was not, which for a wrapper script is the same bug in a
     * different place: `INVALID_ARGS` is exit 4, and only the mapping says so.
     */
    const err =
      raw instanceof AgentError ? new CliError(raw.code as CliErrorCode, raw.message, raw.hint) : raw;
    if (!(err instanceof CliError)) throw err;
    // 2.1.13: the artifact route answers BRIEF_NOT_FOUND itself (the row's
    // code), which passes through below unchanged. A server from before that
    // still 404s as the generic NOT_FOUND; this command's entire domain is one
    // brief path, so it is re-framed to the brief-specific code.
    // A refused window's hint (`?view=operation&range=…`) is rewritten into a
    // runnable command, like the truncation hint.
    throw new CliError(
      err.code === 'NOT_FOUND' ? 'BRIEF_NOT_FOUND' : err.code,
      err.message,
      toCliHint(err.hint, briefPath),
      err.details,
    );
  }
}

/**
 * The route writes its window as `?view=operation&range=<start>-<end>` — a call
 * this channel cannot make. The same window as a `c4s get-brief` invocation is
 * one the caller can run as written (`n9qp5ja7`: never propose a call the
 * channel cannot make). Prose around it is left alone.
 */
function toCliHint(hint: string | undefined, briefPath: string): string | undefined {
  if (hint === undefined) return undefined;
  return hint.replace(
    /\?view=operation&range=(\d+)-(\d+)/g,
    (_whole, start: string, end: string) => `c4s get-brief ${shellWord(briefPath)} --range ${start}-${end}`,
  );
}

/** A path as one shell word, so the hint runs as written even with a space in the name. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export const getBriefCommand: CliCommandContribution = {
  name: 'get-brief',
  operation: 'get_brief',
  executionMode: 'server-delegating',
  flags: ['range'],
  errorCodes: [...SERVER_DELEGATING_CODES, 'INVALID_ARGS', 'INVALID_ARGUMENT', 'BRIEF_NOT_FOUND'],
  handler: runGetBrief,
};
