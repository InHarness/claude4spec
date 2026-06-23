import fs from 'node:fs';
import path from 'node:path';

type PatternSpec = {
  canonical: string;
  equivalents: readonly string[];
};

// M33 phase 2: the derived SQLite moved to the workspace slot
// (`~/.claude4spec/<ws>/<id>/db.sqlite`, M31), so `db.sqlite*` is no longer
// emitted here. `.claude4spec/plugins/` is intentionally NOT ignored — committed
// plugins must travel with the repo (like `entities/`). Note the `.claude4spec/`
// and `.claude4spec` bare equivalents are kept on the remaining patterns: a repo
// that already ignores the whole dir still reads as "covered", so we never append
// a redundant line that would conflict with a user's broad ignore.
const PATTERNS: readonly PatternSpec[] = [
  {
    canonical: '.claude4spec/mcp.json',
    equivalents: ['.claude4spec/mcp.json', '.claude4spec/', '.claude4spec'],
  },
  {
    canonical: '*.deprecated',
    equivalents: ['*.deprecated', '*.deprecated/'],
  },
];

export function ensureGitignore(cwd: string): void {
  const file = path.join(cwd, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split('\n').map((l) => l.trim()));

  const missing: string[] = [];
  for (const spec of PATTERNS) {
    if (!spec.equivalents.some((p) => lines.has(p))) {
      missing.push(spec.canonical);
    }
  }
  if (missing.length === 0) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
  const addition =
    (needsLeadingNewline ? '\n' : '') +
    (existing.length > 0 ? '\n' : '') +
    '# claude4spec (auto-added)\n' +
    missing.join('\n') +
    '\n';
  fs.writeFileSync(file, existing + addition, 'utf8');
}
