/**
 * M33 (0.1.92) — base load↔watch resolution invariant.
 *
 * The base-watcher discovers a package's `dist` dir to observe by resolving its
 * main entry. That discovery MUST use the same ESM resolution as the bootstrap
 * `import(pkg)` — `import.meta.resolve` (honors the `import` condition) — not CJS
 * `createRequire(...).resolve`. The reference preinstalled base package
 * `@inharness-ai/c4s-plugin-simple-database-tables` is ESM-only (`exports["."]`
 * declares only `import`/`types`, no `require`/`default`), so it is the parity
 * witness: the CJS path can't see it, the ESM path can.
 *
 * Note: vitest's module runner throws on `import.meta.resolve` ("not supported"),
 * so `resolveBaseEntry` can't be exercised in-process here. The positive case runs
 * the REAL helper in the REAL runtime (tsx, as the dev server does) via a
 * subprocess — a faithful, non-flaky proof rather than a mocked one.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG = '@inharness-ai/c4s-plugin-simple-database-tables';
const repoRoot = process.cwd();
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

/** Run `resolveBaseEntry(spec)` through tsx (the production runtime) and return its result. */
function resolveInRuntime(spec: string): string | null {
  const probe = path.join(repoRoot, `.resolve-probe-${process.pid}.mts`);
  fs.writeFileSync(
    probe,
    `import { resolveBaseEntry } from './src/server/core/plugin-host/loader.js';\n` +
      `process.stdout.write(JSON.stringify(resolveBaseEntry(${JSON.stringify(spec)})));\n`,
  );
  try {
    const out = execFileSync(tsx, [probe], { cwd: repoRoot, encoding: 'utf8' });
    return JSON.parse(out) as string | null;
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

describe('M33 — resolveBaseEntry (ESM load↔watch parity)', () => {
  it('the OLD CJS resolver cannot discover an ESM-only package (regression guard)', () => {
    // `exports["."]` has only `import`/`types`; CJS conditions (require/node/default)
    // find no match ⇒ ERR_PACKAGE_PATH_NOT_EXPORTED. This is exactly why the base
    // watcher previously failed to observe ESM-only packages.
    expect(() => createRequire(import.meta.url).resolve(PKG)).toThrow(
      /ERR_PACKAGE_PATH_NOT_EXPORTED|No "exports" main/,
    );
  });

  it('resolveBaseEntry resolves the ESM-only package via the import condition', () => {
    const entry = resolveInRuntime(PKG);
    expect(entry).not.toBeNull();
    expect(path.isAbsolute(entry!)).toBe(true);
    // The `.` import target is `./dist/index.js`; its dirname is the dist dir
    // the base watcher observes.
    expect(entry!.endsWith(path.join('dist', 'index.js'))).toBe(true);
    expect(path.basename(path.dirname(entry!))).toBe('dist');
  });

  it('returns null for a package that is not installed (unwatchable, not a crash)', () => {
    expect(resolveInRuntime('@c4s-fixture/definitely-not-installed')).toBeNull();
  });
});
