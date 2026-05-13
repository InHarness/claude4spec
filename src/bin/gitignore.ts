import fs from 'node:fs';
import path from 'node:path';

type PatternSpec = {
  canonical: string;
  equivalents: readonly string[];
};

const PATTERNS: readonly PatternSpec[] = [
  {
    canonical: '.claude4spec/db.sqlite*',
    equivalents: [
      '.claude4spec/db.sqlite*',
      '.claude4spec/db.sqlite',
      '.claude4spec/db.sqlite-wal',
      '.claude4spec/db.sqlite-shm',
      '.claude4spec/',
      '.claude4spec',
    ],
  },
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
