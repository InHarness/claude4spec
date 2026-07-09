import fs from 'node:fs';
import path from 'node:path';

type PatternSpec = {
  canonical: string;
  equivalents: readonly string[];
};

export interface EnsureGitignoreOpts {
  /** Default `.claude4spec/briefs`. */
  briefsDir?: string;
  /** Default `.claude4spec/patches`. */
  patchesDir?: string;
  /** Default `.claude4spec/releases`. */
  releasesDir?: string;
  /**
   * 0.1.118: the git master switch. `false` (default) ⇒ briefs/patches/
   * releases stay local-only (gitignored). `true` ⇒ `ensureGitignore` OMITS
   * those entries so they become committed and shared with the team.
   */
  gitEnabled?: boolean;
}

const MARKER_START = '# claude4spec (auto-added)';
const MARKER_END = '# /claude4spec (auto-added)';

// M33 phase 2: the derived SQLite moved to the workspace slot
// (`~/.claude4spec/<ws>/<id>/db.sqlite`, M31), so `db.sqlite*` is no longer
// emitted here. `.claude4spec/plugins/` is intentionally NOT ignored — committed
// plugins must travel with the repo (like `entities/`). Note the `.claude4spec/`
// and `.claude4spec` bare equivalents are kept on the remaining patterns: a repo
// that already ignores the whole dir still reads as "covered", so we never append
// a redundant line that would conflict with a user's broad ignore. Always present
// regardless of the git master switch.
const STATIC_PATTERNS: readonly PatternSpec[] = [
  {
    canonical: '.claude4spec/mcp.json',
    equivalents: ['.claude4spec/mcp.json', '.claude4spec/', '.claude4spec'],
  },
  {
    canonical: '*.deprecated',
    equivalents: ['*.deprecated', '*.deprecated/'],
  },
];

function dirPatternSpec(dir: string): PatternSpec {
  const withSlash = dir.endsWith('/') ? dir : `${dir}/`;
  return {
    canonical: withSlash,
    // A broad existing ignore of the whole `.claude4spec/` dir already covers
    // a default-location briefsDir/patchesDir/releasesDir — never append a
    // redundant line.
    equivalents: [withSlash, dir, '.claude4spec/', '.claude4spec'],
  };
}

/**
 * 0.1.118: briefs/patches/releases are gitignored ONLY when the git master
 * switch is off (the default) — local-only, per-solo-dev. When on, they
 * become committed and shared with the team (see `GitService.commit()`'s
 * staging scope, which stages all three the same way), so this returns []
 * and the managed block simply omits them. `releasesDir` is included here to
 * match its own doc comment in `config.ts` ("committed to git when
 * git.enabled, local-only otherwise") — briefsDir/patchesDir alone would
 * silently contradict that.
 */
function dynamicPatterns(opts: Required<EnsureGitignoreOpts>): PatternSpec[] {
  if (opts.gitEnabled) return [];
  return [dirPatternSpec(opts.briefsDir), dirPatternSpec(opts.patchesDir), dirPatternSpec(opts.releasesDir)];
}

/** Trim leading AND trailing blank lines from a line array, in place semantics via slice. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end);
}

/**
 * Idempotent, additive-AND-subtractive sync of the `.gitignore` managed block
 * (delimited by `# claude4spec (auto-added)` / `# /claude4spec (auto-added)`
 * marker lines). Recomputes the desired pattern set on every call and
 * regenerates ONLY that block, so a pattern that stops applying (e.g.
 * `git.enabled` flips true) is REMOVED, not just never re-added — the
 * "removal path" a strictly-additive design can't express. Content the user
 * placed BEFORE the start marker (preamble) or AFTER the end marker
 * (postamble) is preserved verbatim across regeneration — the end marker
 * exists specifically so a user's own rules appended below our block (a
 * natural place to add new ignores) survive every `PATCH /api/config` that
 * touches `git`/`briefsDir`/`patchesDir`/`releasesDir`. A file written before
 * this end-marker existed has no postamble to recover on its first rewrite
 * under this version (nothing to disambiguate it from), but every rewrite
 * from here on carries the marker forward and stays lossless. A pattern
 * already covered by an equivalent line in the PREAMBLE (genuine user
 * content) is skipped; the old managed block itself is never treated as
 * "already covered" — it's wholesale replaced every call.
 *
 * Called once at bootstrap AND (0.1.118) again whenever `PATCH /api/config`
 * touches the fields above, so an existing project's `.gitignore` stays in
 * sync without a restart. Best-effort by convention — callers should not let
 * a write failure here fail the caller's own request.
 */
export function ensureGitignore(cwd: string, opts: EnsureGitignoreOpts = {}): void {
  const resolved: Required<EnsureGitignoreOpts> = {
    briefsDir: opts.briefsDir ?? '.claude4spec/briefs',
    patchesDir: opts.patchesDir ?? '.claude4spec/patches',
    releasesDir: opts.releasesDir ?? '.claude4spec/releases',
    gitEnabled: opts.gitEnabled ?? false,
  };

  const file = path.join(cwd, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const rawLines = existing.split('\n');

  const startIdx = rawLines.findIndex((l) => l.trim() === MARKER_START);
  const preambleLines = trimBlankEdges(startIdx === -1 ? rawLines : rawLines.slice(0, startIdx));
  const preambleLineSet = new Set(preambleLines.map((l) => l.trim()));

  let postambleLines: string[] = [];
  if (startIdx !== -1) {
    const endIdx = rawLines.findIndex((l, i) => i > startIdx && l.trim() === MARKER_END);
    if (endIdx !== -1) postambleLines = trimBlankEdges(rawLines.slice(endIdx + 1));
  }

  const allPatterns = [...STATIC_PATTERNS, ...dynamicPatterns(resolved)];
  const desired = allPatterns
    .filter((spec) => !spec.equivalents.some((p) => preambleLineSet.has(p)))
    .map((spec) => spec.canonical);

  const sections: string[] = [];
  if (preambleLines.length > 0) sections.push(preambleLines.join('\n'));
  if (desired.length > 0) sections.push(`${MARKER_START}\n${desired.join('\n')}\n${MARKER_END}`);
  if (postambleLines.length > 0) sections.push(postambleLines.join('\n'));

  const next = sections.length > 0 ? `${sections.join('\n\n')}\n` : '';

  if (next === existing) return; // no-op — avoid needless mtime churn on every PATCH
  fs.writeFileSync(file, next, 'utf8');
}
