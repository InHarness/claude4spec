import fs from 'node:fs';
import path from 'node:path';

/**
 * Directory snapshots for "nothing was written here" assertions.
 *
 * They live outside `src/bin/c4s` on purpose: the M39 architecture gate
 * (`tests/integration/architecture/discovery-core.test.ts`) forbids any
 * directory walk under the CLI, test files included.
 */

/** Every file under `dir` (recursively), keyed by its relative path, with its bytes. */
export function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isFile()) out[entry] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

/** The direct entries of `dir` (files and directories), as `fs.readdirSync` lists them. */
export function dirEntries(dir: string): string[] {
  return fs.readdirSync(dir);
}
