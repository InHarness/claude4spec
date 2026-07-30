import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The installed `claude4spec` version, reported by `c4s --version`, `c4s
 * catalog` and the `overview` operation.
 *
 * M39 folded three near-identical copies of this into one. They walked
 * different numbers of directories up (each written for the file it sat in) and
 * would have drifted the moment one moved. The candidate list below covers
 * every depth any of them handled, from `dist/bin/` to `src/bin/c4s/commands/`,
 * so the answer no longer depends on which file is asking.
 *
 * Never throws: a version string is decoration on every one of its callers, and
 * failing a discovery operation because a `package.json` moved would be absurd.
 */
export function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (let up = 1; up <= 5; up++) {
      const pkgPath = path.resolve(here, ...Array<string>(up).fill('..'), 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string };
      // A nested dependency's `package.json` would answer here too, so only the
      // host package's own version counts.
      if (pkg.version && pkg.name?.includes('claude4spec')) return pkg.version;
    }
  } catch {
    /* a missing or unreadable package.json is not worth an error path */
  }
  return 'unknown';
}
