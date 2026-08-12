/**
 * Nothing reachable from the BACKEND entry may pull in React.
 *
 * `src/index.ts` is what the host's Node loader imports. In the api-contracts
 * envelope, one import edge from there into a `.tsx` file put `react`,
 * `react/jsx-runtime` and `lucide-react` on the server's plugin-load path — and
 * it was an innocuous-looking one: `capabilities/commands.ts` importing two
 * popover-kind STRING constants from the popovers that use them, so a rename
 * could not unhook the command from its handler. Rollup faithfully hoisted the
 * whole component module into a shared chunk that the backend bundle imports on
 * line 1.
 *
 * The cost is not just a slower boot. Those are UI dependencies; any server
 * image or install that prunes them turns the envelope into
 * `PLUGIN_IMPORT_FAILED`, and a failed envelope means `ui-view` and
 * `design-system` silently do not exist.
 *
 * This package is squarely in range of that mistake: both popover kinds live in
 * `identity.ts`, which is `.ts` and React-free precisely so
 * `capabilities/commands.ts` can import them without dragging the two
 * `slash-create.tsx` popovers onto the server's load path.
 *
 * A source-graph walk rather than a check on `dist/`, so it needs no build and
 * names the offending EDGE instead of the bundled result.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(import.meta.dirname, '../src');
const ENTRY = path.join(SRC, 'index.ts');

/** Local relative imports only — bare specifiers are the leaves we judge. */
function importsOf(file: string): { local: string[]; bare: string[] } {
  const source = fs.readFileSync(file, 'utf8');
  const local: string[] = [];
  const bare: string[] = [];
  for (const m of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]!;
    (spec.startsWith('.') ? local : bare).push(spec);
  }
  return { local, bare };
}

/** `./x.js` as written in TS ESM → the `.ts`/`.tsx` file on disk. */
function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const REACT_ISH = /^(react|react-dom|lucide-react|@tanstack\/react-router)(\/|$)/;

describe('the backend entry graph', () => {
  const visited = new Set<string>();
  const offences: string[] = [];

  function walk(file: string, trail: string[]): void {
    if (visited.has(file)) return;
    visited.add(file);
    const rel = path.relative(SRC, file);

    if (file.endsWith('.tsx')) {
      offences.push(`${[...trail, rel].join(' → ')} (a .tsx file)`);
      return; // its own imports are not the interesting fact
    }
    const { local, bare } = importsOf(file);
    for (const spec of bare) {
      if (REACT_ISH.test(spec)) offences.push(`${[...trail, rel].join(' → ')} imports '${spec}'`);
    }
    for (const spec of local) {
      const next = resolveLocal(file, spec);
      if (next) walk(next, [...trail, rel]);
    }
  }

  it('reaches no React, no .tsx, no UI-only dependency', () => {
    walk(ENTRY, []);
    expect(offences).toEqual([]);
  });

  it('actually traversed the graph (the walk itself must not silently no-op)', () => {
    walk(ENTRY, []);
    expect(visited.size).toBeGreaterThan(10);
  });
});
