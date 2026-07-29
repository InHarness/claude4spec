/**
 * The published tarball must carry the builtin envelope.
 *
 * This is a test rather than a note because the failure is silent and total: if
 * `plugins/c4s-plugin-api-contracts/dist` is missing from the package,
 * `discoverBuiltinEnvelopes()` returns `[]` — no error, no warning — and every
 * npm-installed host quietly has no `endpoint` and no `dto` type at all. Nothing
 * in the app would report it; the two sidebar tabs would simply be absent.
 *
 * Two independent things have to hold, and each has already been wrong once:
 *   1. `package.json#files` names the envelope's `dist` and `package.json`;
 *   2. nothing strips it back out. npm applies `.gitignore` INSIDE an included
 *      directory, and `dist/` is ignored there — correctly, build output does
 *      not belong in git. The root `.npmignore` exists solely to take
 *      precedence over that. Delete it and this test fails, which is the point.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');

describe('npm package contents', () => {
  it('ships the builtin envelope’s built bundles', () => {
    // `--dry-run --json` lists the file set without writing a tarball. Slow
    // (npm walks the tree), hence the raised timeout rather than a smaller check.
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [tarball] = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
    const files = (tarball?.files ?? []).map((f) => f.path);

    // The backend entry the loader imports, and the frontend bundle the asset
    // route serves. Either one missing breaks a different half of the feature.
    expect(files).toContain('plugins/c4s-plugin-api-contracts/dist/index.js');
    expect(files).toContain('plugins/c4s-plugin-api-contracts/dist/frontend.js');
    // `discoverBuiltinEnvelopes` reads `exports`/`main` from here to find the entry.
    expect(files).toContain('plugins/c4s-plugin-api-contracts/package.json');

    // Code-split chunks are siblings of the entries and are fetched by relative
    // specifier, so a `files` rule narrow enough to catch only the two named
    // bundles would produce a bundle that loads and then 404s mid-import.
    expect(files.filter((f) => /^plugins\/c4s-plugin-api-contracts\/dist\/.*\.js$/.test(f)).length)
      .toBeGreaterThan(2);
  }, 120_000);
});
