import { CliError } from './errors.js';

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Map<string, string | boolean>;
  project?: string;
  /** M31: workspace selector — disambiguates a cwd registered in N workspaces. */
  workspace?: string;
  format: 'json' | 'text';
  compact: boolean;
  sortKeys: boolean;
}

// `force`/`no-install` (M38 `create-plugin`) must be declared here: without it
// `c4s create-plugin --force my-plugin` swallows the positional as the flag's value.
const KNOWN_BOOLEAN_FLAGS = new Set([
  'compact',
  'sort-keys',
  'help',
  'version',
  'force',
  'no-install',
  // 0.2.6 — declared for the same reason: `c4s get-sections --include-subtree
  // --anchors a,b` must not swallow the next token as this flag's value.
  'include-subtree',
  'include-tag-matches',
  'with-counts',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: null,
    positional: [],
    flags: new Map(),
    format: 'json',
    compact: false,
    sortKeys: false,
  };

  let i = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    result.command = argv[0];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) {
      result.positional.push(token);
      continue;
    }
    const eqIdx = token.indexOf('=');
    const name = eqIdx >= 0 ? token.slice(2, eqIdx) : token.slice(2);
    let value: string | boolean;
    if (eqIdx >= 0) {
      value = token.slice(eqIdx + 1);
    } else if (KNOWN_BOOLEAN_FLAGS.has(name)) {
      value = true;
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        value = true;
      } else {
        value = next;
        i++;
      }
    }
    result.flags.set(name, value);
  }

  const format = result.flags.get('format');
  if (typeof format === 'string') {
    if (format !== 'json' && format !== 'text') {
      throw new CliError('INVALID_ARGS', `--format must be 'json' or 'text', got '${format}'`);
    }
    result.format = format;
  }

  if (result.flags.get('compact') === true) result.compact = true;
  if (result.flags.get('sort-keys') === true) result.sortKeys = true;
  const project = result.flags.get('project');
  if (typeof project === 'string') result.project = project;
  const workspace = result.flags.get('workspace');
  if (typeof workspace === 'string') result.workspace = workspace;

  return result;
}

export function requireString(args: ParsedArgs, flag: string): string {
  const v = args.flags.get(flag);
  if (typeof v !== 'string' || !v) {
    throw new CliError('INVALID_ARGS', `--${flag} is required`);
  }
  return v;
}

export function optionalString(args: ParsedArgs, flag: string): string | undefined {
  const v = args.flags.get(flag);
  if (typeof v === 'string' && v) return v;
  return undefined;
}

/** Parses `--flag N` as an integer; throws INVALID_ARGS for a non-integer value. Absent flag → undefined. */
export function optionalInt(args: ParsedArgs, flag: string): number | undefined {
  const v = args.flags.get(flag);
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) {
    throw new CliError('INVALID_ARGS', `--${flag} must be an integer, got '${String(v)}'`);
  }
  return Number(v);
}

/**
 * The two flags every LIST command takes, parsed in one place.
 *
 * 0.2.6 — `--limit`/`--offset` are dispatcher-level flags, not each command's
 * invention: a caller that learned them from `list-entities` must not discover
 * that `search-pages` spells them differently or ignores them. They are absent
 * from exactly two kinds of command, and the absence is decidable from the
 * signature alone: fetch-by-key (`get-entities`, `get-sections` — the caller
 * names the rows, so the valve is the input-length cap plus the response
 * budget) and projections bounded by construction (`catalog`, `describe`).
 *
 * An absent flag stays `undefined` rather than becoming a default here — the
 * core owns the per-operation default limit, and a default injected at the
 * transport would be a second answer to the same question.
 */
export function paginationFrom(args: ParsedArgs): { limit?: number; offset?: number } {
  const limit = optionalInt(args, 'limit');
  const offset = optionalInt(args, 'offset');
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  };
}

/**
 * Refuses flags this command does not honour, instead of ignoring them.
 *
 * Ignoring is the worse failure: `c4s get-entities --slugs a,b,c,d,e --limit 2`
 * that quietly returns five leaves the caller believing the answer was scoped to
 * two, and a script built on that belief is wrong everywhere it is used. It is
 * the same reasoning that makes the section commands refuse `--root-id` rather
 * than drop it — a refusal costs one retry, a silent no-op costs trust in every
 * answer the command ever gave.
 */
export function refuseFlags(args: ParsedArgs, flags: readonly string[], why: string): void {
  const offending = flags.filter((flag) => args.flags.has(flag));
  if (offending.length === 0) return;
  throw new CliError(
    'INVALID_ARGUMENT',
    `${offending.map((f) => `--${f}`).join(', ')} ${offending.length > 1 ? 'are' : 'is'} not accepted here — ${why}`,
    'run `c4s --help` for which commands paginate',
  );
}

export function requireStringList(args: ParsedArgs, flag: string): string[] {
  const raw = requireString(args, flag);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Same as `requireStringList`, but returns `undefined` when the flag is absent. */
export function optionalStringList(args: ParsedArgs, flag: string): string[] | undefined {
  const raw = optionalString(args, flag);
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
