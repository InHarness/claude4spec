import { CliError, cliErrorFromDiscovery, codeToExit } from './errors.js';
import { writeError } from './output.js';

type Write = typeof process.stdout.write;

/**
 * 2.1.69 (M11 `hy4dlema`, `g24dkd8t`) — the stream discipline of the `c4s`
 * dispatcher, for every command at once:
 *
 * - success: the payload goes to stdout only; whatever a command (or a library
 *   it calls) put on stderr along the way is passed on after it, never mixed in;
 * - error: stdout stays EMPTY — anything a command wrote there before it failed
 *   is dropped — and stderr carries the error envelope ALONE, with no log line
 *   before it or after it.
 *
 * Both streams are held for the length of the run (`console.*` writes through
 * them too, so a stray `console.warn` is caught the same way) and released only
 * once the outcome is known. No command streams its output progressively, so
 * holding it costs nothing a caller could observe.
 *
 * Returns the process exit code: 0 on success, `toExit(code)` on error. The
 * entry passes `codeToExit` from `./errors.js` explicitly — it is the one map
 * every exit goes through; it is also the default.
 */
export async function runWithStreamDiscipline(
  run: () => Promise<void>,
  toExit: (code: string) => number = codeToExit,
): Promise<number> {
  const stdoutWrite: Write = process.stdout.write;
  const stderrWrite: Write = process.stderr.write;
  const held = { stdout: [] as Array<string | Uint8Array>, stderr: [] as Array<string | Uint8Array> };

  process.stdout.write = hold(held.stdout) as Write;
  process.stderr.write = hold(held.stderr) as Write;
  const release = (): void => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  };

  try {
    await run();
  } catch (err) {
    release();
    const cliError = toCliError(err);
    writeError(cliError);
    return toExit(cliError.code);
  }

  release();
  for (const chunk of held.stdout) process.stdout.write(chunk);
  for (const chunk of held.stderr) process.stderr.write(chunk);
  return 0;
}

/** Any failure as the envelope's error: a CLI code, a mapped core code, or the generic one. */
function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  // A core error reaches the user as itself, with its own code and its repair
  // path — see `cliErrorFromDiscovery`.
  const mapped = cliErrorFromDiscovery(err);
  if (mapped) return mapped;
  return new CliError('UNKNOWN_COMMAND', err instanceof Error ? err.message : String(err));
}

function hold(into: Array<string | Uint8Array>) {
  return (chunk: string | Uint8Array, encodingOrCb?: unknown, cb?: unknown): boolean => {
    into.push(
      typeof chunk === 'string' && typeof encodingOrCb === 'string'
        ? Buffer.from(chunk, encodingOrCb as BufferEncoding)
        : chunk,
    );
    const done = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
    if (typeof done === 'function') queueMicrotask(() => (done as (e?: Error | null) => void)(null));
    return true;
  };
}
