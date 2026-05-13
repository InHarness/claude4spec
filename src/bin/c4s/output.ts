import type { ParsedArgs } from './args.js';
import type { CliError } from './errors.js';

export function writeOutput(data: unknown, args: ParsedArgs): void {
  if (args.format === 'text') {
    process.stdout.write(renderText(data) + '\n');
    return;
  }
  const json = args.compact
    ? JSON.stringify(data, args.sortKeys ? sortReplacer() : undefined)
    : JSON.stringify(data, args.sortKeys ? sortReplacer() : undefined, 2);
  process.stdout.write(json + '\n');
}

export function writeError(err: CliError): void {
  const payload = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
    },
  };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
}

function sortReplacer(): (this: unknown, key: string, value: unknown) => unknown {
  return function (this: unknown, _key: string, value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (value as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return value;
  };
}

function renderText(data: unknown, indent = 0): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean')
    return String(data);
  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)';
    return data
      .map((item, i) => `${'  '.repeat(indent)}[${i}] ${renderText(item, indent + 1)}`)
      .join('\n');
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (!entries.length) return '{}';
    return entries
      .map(([k, v]) => `${'  '.repeat(indent)}${k}: ${renderText(v, indent + 1)}`)
      .join('\n');
  }
  return String(data);
}
