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
  /**
   * 0.1.118: the git master switch. `false` (default) ⇒ briefs/patches stay
   * local-only (gitignored). `true` ⇒ `ensureGitignore` OMITS those entries
   * so they become committed and shared with the team.
   */
  gitEnabled?: boolean;
}

const MARKER = '# claude4spec (auto-added)';

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
    // a default-location briefsDir/patchesDir — never append a redundant line.
    equivalents: [withSlash, dir, '.claude4spec/', '.claude4spec'],
  };
}

/**
 * 0.1.118: briefs/patches are gitignored ONLY when the git master switch is
 * off (the default) — local-only, per-solo-dev. When on, they become
 * committed and shared with the team, so this returns [] and the managed
 * block simply omits them.
 */
function dynamicPatterns(opts: Required<EnsureGitignoreOpts>): PatternSpec[] {
  if (opts.gitEnabled) return [];
  return [dirPatternSpec(opts.briefsDir), dirPatternSpec(opts.patchesDir)];
}

/**
 * Idempotent, additive-AND-subtractive sync of the `.gitignore` managed block
 * (everything from the `# claude4spec (auto-added)` marker line to EOF — user
 * content lives only above it, the "preamble"). Recomputes the desired
 * pattern set on every call and regenerates the block from scratch, so a
 * pattern that stops applying (e.g. `git.enabled` flips true) is REMOVED, not
 * just never re-added — the "removal path" a strictly-additive design can't
 * express. A pattern already covered by an equivalent line in the PREAMBLE
 * (genuine user content) is skipped; the old managed block itself is never
 * treated as "already covered" — it's wholesale replaced every call.
 *
 * Called once at bootstrap AND (0.1.118) again whenever `PATCH /api/config`
 * touches `git`/`briefsDir`/`patchesDir`, so an existing project's
 * `.gitignore` stays in sync without a restart. Best-effort by convention —
 * callers should not let a write failure here fail the caller's own request.
 */
export function ensureGitignore(cwd: string, opts: EnsureGitignoreOpts = {}): void {
  const resolved: Required<EnsureGitignoreOpts> = {
    briefsDir: opts.briefsDir ?? '.claude4spec/briefs',
    patchesDir: opts.patchesDir ?? '.claude4spec/patches',
    gitEnabled: opts.gitEnabled ?? false,
  };

  const file = path.join(cwd, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const rawLines = existing.split('\n');
  const markerIdx = rawLines.findIndex((l) => l.trim() === MARKER);
  const preambleLines = markerIdx === -1 ? rawLines : rawLines.slice(0, markerIdx);
  // Trailing blank lines get re-inserted deliberately below (before the
  // marker), so trim them off the captured preamble first.
  while (preambleLines.length > 0 && preambleLines[preambleLines.length - 1]!.trim() === '') {
    preambleLines.pop();
  }
  const preamble = preambleLines.join('\n');
  const preambleLineSet = new Set(preambleLines.map((l) => l.trim()));

  const allPatterns = [...STATIC_PATTERNS, ...dynamicPatterns(resolved)];
  const desired = allPatterns
    .filter((spec) => !spec.equivalents.some((p) => preambleLineSet.has(p)))
    .map((spec) => spec.canonical);

  const next =
    desired.length === 0
      ? preamble.length > 0
        ? `${preamble}\n`
        : ''
      : `${preamble.length > 0 ? `${preamble}\n\n` : ''}${MARKER}\n${desired.join('\n')}\n`;

  if (next === existing) return; // no-op — avoid needless mtime churn on every PATCH
  fs.writeFileSync(file, next, 'utf8');
}
