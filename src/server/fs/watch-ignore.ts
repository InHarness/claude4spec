import path from 'node:path';

// Directories that are never worth watching and routinely contain thousands
// of files — descending into them is the usual cause of EMFILE (one OS file
// descriptor per watched directory on macOS).
const HEAVY_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  '.cache',
  '.turbo',
]);

/**
 * Build a chokidar `ignored` predicate. Ignores dotfile basenames and known
 * heavy directories, but NEVER the watch root(s) themselves — a root resolved
 * to e.g. `<workspace node_modules>/<pkg>/dist` (the base watcher uses the
 * dirname of the base locator's ESM entry) must still be watched — its path
 * runs through `node_modules` (and, for a workspace with a home, through
 * `.claude4spec/local/`) — otherwise the watcher would ignore its own root and
 * observe nothing.
 */
export function makeWatchIgnore(roots: string | string[]): (p: string) => boolean {
  const rootSet = new Set((Array.isArray(roots) ? roots : [roots]).map((r) => path.resolve(r)));
  return (p: string): boolean => {
    if (rootSet.has(path.resolve(p))) return false; // never ignore a root
    const base = path.basename(p);
    return base.startsWith('.') || HEAVY_DIRS.has(base);
  };
}
