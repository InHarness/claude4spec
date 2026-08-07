import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * No source file may contain a raw NUL byte.
 *
 * Git classifies a file containing one as BINARY. Its diffs render as
 * `Bin <n> -> <m> bytes` with no reviewable content; `git grep`, `git log -S`
 * and every PR review UI skip it silently. A reviewer does not get an error —
 * they get a file that appears to have no changes worth reading.
 *
 * `.gitattributes` records that `design-system/serializer.ts` carried one until
 * 0.2.9 and cost a reviewer a diff, and states that "the next one should not be
 * able to". It could not deliver on that: `*.ts text` governs end-of-line
 * normalization only and has no effect on binary detection. 0.2.13 then shipped
 * a second one — `delegate.ts`, using a literal NUL as a memo-key delimiter,
 * which hid all 193 lines of the release's central new CLI module from the very
 * review that was looking for it.
 *
 * Written as an escape sequence (`\0` in source) the delimiter behaves
 * identically at runtime and the file stays text. This is the check that makes
 * the difference enforceable rather than remembered.
 */
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html']);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(abs);
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) yield abs;
  }
}

describe('source files stay text', () => {
  it('no tracked source file contains a raw NUL byte', () => {
    const offenders: string[] = [];
    for (const root of ['src', 'tests', 'scripts', 'plugins']) {
      const abs = path.join(REPO_ROOT, root);
      if (!fs.existsSync(abs)) continue;
      for (const file of sourceFiles(abs)) {
        const at = fs.readFileSync(file).indexOf(0);
        if (at !== -1) offenders.push(`${path.relative(REPO_ROOT, file)} (byte ${at})`);
      }
    }
    // Named individually: "some file is binary" is the report that made the last
    // two take a release each to notice.
    expect(offenders, 'write the byte as the escape sequence \\0 instead').toEqual([]);
  });
});
