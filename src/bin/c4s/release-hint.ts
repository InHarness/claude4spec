/**
 * 2.1.11 — the release operations' `truncationHint`, rewritten from operation
 * parameters to `c4s` flags.
 *
 * The hint is written once, by the operation, in its own vocabulary
 * (`` `paths: ['pages/a.md'], sectionOffset: 3` ``). Each command's flag set IS
 * that parameter set, renamed by one mechanical rule — camelCase → kebab-case,
 * plus the three exceptions below — so the same rule turns the hint into a
 * runnable `c4s release-diff` call. Only code spans (backticks) are rewritten;
 * the prose around them is left alone.
 */

/** Parameters whose flag is not the plain kebab-case of their name. */
const FLAG_EXCEPTIONS: Record<string, string> = {
  fromReleaseName: 'from',
  toReleaseName: 'to',
  releaseName: 'release',
  // The MCP inputs still carry the pre-2.1.11 names; a hint naming them maps the same way.
  fromIdOrName: 'from',
  toIdOrName: 'to',
  idOrName: 'release',
};

/** Every parameter of the three read operations. */
const RELEASE_PARAMS = new Set([
  ...Object.keys(FLAG_EXCEPTIONS),
  'include',
  'entityTypes',
  'slugs',
  'roots',
  'paths',
  'summaryOnly',
  'limit',
  'offset',
  'sectionOffset',
  'sectionLimit',
]);

/** Lists given by repeating the flag rather than by commas. */
const REPEATED_FLAGS = new Set(['paths']);

export function flagFor(param: string): string {
  return FLAG_EXCEPTIONS[param] ?? param.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function renderPair(param: string, rawValue: string): string {
  const flag = flagFor(param);
  const value = rawValue.trim();
  if (value === 'true') return `--${flag}`;
  const list = /^\[(.*)\]$/.exec(value);
  if (list) {
    const items = [...list[1]!.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '');
    if (REPEATED_FLAGS.has(param)) return items.map((item) => `--${flag} ${item}`).join(' ');
    return `--${flag} ${items.join(',')}`;
  }
  return `--${flag} ${value.replace(/^['"]|['"]$/g, '')}`;
}

/** One code span: `param: value` pairs, or a bare parameter name. Anything else is returned untouched. */
function rewriteSpan(span: string): string {
  const bare = span.trim();
  if (RELEASE_PARAMS.has(bare)) return `--${flagFor(bare)}`;
  const pair = /(\w+):\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|[^,\s]+)/g;
  const pairs = [...span.matchAll(pair)];
  if (pairs.length === 0 || !pairs.every((m) => RELEASE_PARAMS.has(m[1]!))) return span;
  // The span must consist of the pairs alone (comma-separated), or it is prose.
  const rest = span.replace(pair, '').replace(/[,\s]/g, '');
  if (rest !== '') return span;
  return pairs.map((m) => renderPair(m[1]!, m[2]!)).join(' ');
}

export function toCliHint(hint: string): string {
  return hint.replace(/`([^`]+)`/g, (_whole, span: string) => `\`${rewriteSpan(span)}\``);
}

/**
 * The payload as the command prints it: the operation's own `data`, unchanged,
 * plus `truncated: true` and the hint in flag form when the budget cut it.
 */
export function cliReleasePayload<T extends { truncationHint?: string }>(payload: T): T & { truncated?: true } {
  if (!payload.truncationHint) return payload;
  return { ...payload, truncated: true, truncationHint: toCliHint(payload.truncationHint) };
}
