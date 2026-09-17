/**
 * 0.2.90 — the Node bundle boundary, asserted host-wide.
 *
 * One type envelope carries both React components (`frontend.*`) and pure
 * payload-upgrade functions (`payloadUpgrades`). The server/CLI side imports
 * only the latter; nothing reachable from a Node entry may pull React in.
 * Two plugins already pin this for their own backend entry
 * (`plugins/c4s-plugin-{ac,frontend-mockups}/test/backend-entry-is-react-free.test.ts`);
 * this walk covers EVERY built-in plugin's backend entry plus the host's own
 * server and CLI entries, so a new envelope cannot opt out by not copying the test.
 *
 * A source-graph walk rather than a `dist/` check: it needs no build and names
 * the offending EDGE. Type-only imports are erased by the compiler and ignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const REACT_ISH = /^(react|react-dom|lucide-react|@tanstack\/react-router|@tanstack\/react-query|@tiptap\/react)(\/|$)/;

function importsOf(file: string): { local: string[]; bare: string[] } {
  const source = fs.readFileSync(file, 'utf8');
  const local: string[] = [];
  const bare: string[] = [];
  const specs: string[] = [];
  // Static import/export statements, skipping the type-only ones.
  for (const m of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    if (!m[1]) specs.push(m[2]!);
  }
  // Dynamic imports load at runtime just the same.
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  for (const spec of specs) (spec.startsWith('.') ? local : bare).push(spec);
  return { local, bare };
}

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec).replace(/\.(js|mjs)$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function walkFrom(entry: string): { offences: string[]; visited: number } {
  const visited = new Set<string>();
  const offences: string[] = [];
  const walk = (file: string, trail: string[]): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const rel = path.relative(ROOT, file);
    if (file.endsWith('.tsx')) {
      offences.push(`${[...trail, rel].join(' → ')} (a .tsx file)`);
      return;
    }
    const { local, bare } = importsOf(file);
    for (const spec of bare) {
      if (REACT_ISH.test(spec)) offences.push(`${[...trail, rel].join(' → ')} imports '${spec}'`);
    }
    for (const spec of local) {
      const next = resolveLocal(file, spec);
      if (next) walk(next, [...trail, rel]);
    }
  };
  walk(entry, []);
  return { offences, visited: visited.size };
}

const pluginEntries = fs
  .readdirSync(path.join(ROOT, 'plugins'))
  .map((dir) => path.join(ROOT, 'plugins', dir, 'src', 'index.ts'))
  .filter((f) => fs.existsSync(f));

const hostEntries = ['src/server/index.ts', 'src/bin/c4s.ts', 'src/bin/c4s-mcp.ts', 'src/bin/claude4spec.ts']
  .map((f) => path.join(ROOT, f))
  .filter((f) => fs.existsSync(f));

describe('the Node bundle carries no React brought in by a type envelope (0.2.90)', () => {
  it('found the entries it is meant to guard', () => {
    expect(pluginEntries.length).toBeGreaterThanOrEqual(8);
    expect(hostEntries.length).toBe(4);
  });

  it.each([...pluginEntries, ...hostEntries].map((f) => [path.relative(ROOT, f), f]))(
    '%s reaches no React, no .tsx',
    (_rel, entry) => {
      const { offences, visited } = walkFrom(entry);
      expect(visited).toBeGreaterThan(1);
      expect(offences).toEqual([]);
    },
  );
});
