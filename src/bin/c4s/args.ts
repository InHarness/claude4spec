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

const KNOWN_BOOLEAN_FLAGS = new Set(['compact', 'sort-keys', 'help', 'version']);

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

export function requireStringList(args: ParsedArgs, flag: string): string[] {
  const raw = requireString(args, flag);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
