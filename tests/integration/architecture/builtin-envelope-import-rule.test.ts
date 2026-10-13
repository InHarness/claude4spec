/**
 * 2.1.17 — the import rule of a built-in envelope (M13 L2 `m13plenv`, M33
 * `ywud56l6`), as falsifiable tests.
 *
 * A built-in envelope (`plugins/<name>/`) is the external-plugin contract
 * resolved intra-repo, so that moving the package to its own repo is `git mv` +
 * `package.json` and not one rewritten import:
 *   - its CODE (`src/`) imports the host only through `@c4s/plugin-runtime`
 *     (+ `/ui`), and every other relative import stays inside the package;
 *   - its TESTS reach a running host only through the published harness,
 *     `@inharness-ai/claude4spec/plugin-testing`, never through the host repo's
 *     test path (`tests/`).
 *
 * The checks read the import specifiers off the files and resolve the relative
 * ones against the package directory — the question "does this import still
 * resolve once the directory lives somewhere else" is answered by where it
 * points, not by running anything. Comments are stripped first: the rule is
 * discussed in docblocks, sometimes by quoting a forbidden specifier.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const PLUGINS = path.join(REPO_ROOT, 'plugins');
const HOST_TESTS = path.join(REPO_ROOT, 'tests');

/** The published specifier of the plugin test harness (package `exports['./plugin-testing']`). */
const HARNESS = '@inharness-ai/claude4spec/plugin-testing';
/** The only host specifiers a built-in envelope's code may name. */
const HOST_RUNTIME = new Set(['@c4s/plugin-runtime', '@c4s/plugin-runtime/ui']);

/** Every built-in envelope: a directory under `plugins/` carrying a package and a `src/`. */
function envelopes(): string[] {
  return fs
    .readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(PLUGINS, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src')));
}

function walk(dir: string, accept: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, accept));
    else if (accept(abs)) out.push(abs);
  }
  return out;
}

const isSource = (f: string) => /\.(ts|tsx|mts|js|mjs)$/.test(f);
/** The package's code: `src/**`, its own colocated tests excluded. */
const codeFiles = (pkg: string) => walk(path.join(pkg, 'src'), (f) => isSource(f) && !/\.test\.tsx?$/.test(f));
/** The package's tests: `test/**` plus any `*.test.ts(x)` colocated under `src/`. */
const testFiles = (pkg: string) => [
  ...walk(path.join(pkg, 'test'), isSource),
  ...walk(path.join(pkg, 'src'), (f) => /\.test\.tsx?$/.test(f)),
];

/** Block comments and whole-line `//` comments removed; line numbers are not needed here. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * Every module specifier the file names: static `import`/`export … from`, side-effect
 * `import '…'`, dynamic `import('…')`, and the module ids vitest resolves for a
 * test (`vi.mock`, `vi.doMock`, `vi.importActual`) — a mocked module path is an
 * import the extraction would have to rewrite as surely as a static one.
 */
function specifiers(file: string): string[] {
  const text = stripComments(fs.readFileSync(file, 'utf-8'));
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bvi\.(?:mock|doMock|importActual|importMock)\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.push(m[1]!);
  return out;
}

const isRelative = (spec: string) => spec.startsWith('./') || spec.startsWith('../');
const rel = (abs: string) => path.relative(REPO_ROOT, abs);

/** A relative specifier's target, as a path; `.js` written for a `.ts` source is not resolved further. */
const target = (file: string, spec: string) => path.resolve(path.dirname(file), spec);
const inside = (dir: string, abs: string) => abs === dir || abs.startsWith(dir + path.sep);

/** The candidates a bundler-style `.js` specifier may stand for on disk. */
function existsAsModule(abs: string): boolean {
  const stem = abs.replace(/\.(js|mjs|jsx)$/, '');
  const candidates = [
    abs,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${stem}.js`,
    `${stem}.mjs`,
    path.join(abs, 'index.ts'),
    path.join(abs, 'index.tsx'),
    path.join(abs, 'index.js'),
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

/** Every relative import of `files` that leaves `pkg`, as `file → target`. */
function escapes(pkg: string, files: string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    for (const spec of specifiers(file)) {
      if (!isRelative(spec)) continue;
      const to = target(file, spec);
      if (!inside(pkg, to)) out.push(`${rel(file)} → ${rel(to)}`);
    }
  }
  return out;
}

/**
 * ASSUMPTION:dev-1704 — the unit's stated removal is the harness and the host
 * repo's test helpers. Envelope tests that still import host MODULES under
 * `src/` (projection goldens, schema-diff, the host UI kit wired into the
 * render suites' `@c4s/plugin-runtime/ui` mocks, …) are not a route to a running
 * host and are left as they are; deviation dev-1704 asks whether the rule covers
 * them. This list is a ratchet, not an exemption: no other test file may leave
 * its package, and an entry that stops leaving it must be dropped from here.
 */
const HOST_SOURCE_IMPORTS_PENDING = new Set([
  'plugins/c4s-plugin-ac/test/ac-analysis.test.ts',
  'plugins/c4s-plugin-ac/test/ac-audit.test.ts',
  'plugins/c4s-plugin-ac/test/frontend/ac-detail-and-list.render.test.ts',
  'plugins/c4s-plugin-ac/test/projection-golden.test.ts',
  'plugins/c4s-plugin-ac/test/ref-rewrite.test.ts',
  'plugins/c4s-plugin-ac/test/upgrades.test.ts',
  'plugins/c4s-plugin-api-contracts/test/endpoint-payload.test.ts',
  'plugins/c4s-plugin-api-contracts/test/frontend/dto-detail-and-list.render.test.ts',
  'plugins/c4s-plugin-api-contracts/test/frontend/endpoint-detail-history-list.render.test.ts',
  'plugins/c4s-plugin-api-contracts/test/projection-golden.test.ts',
  'plugins/c4s-plugin-database-tables/test/fk-normalization.test.ts',
  'plugins/c4s-plugin-database-tables/test/frontend/database-table-views.render.test.ts',
  'plugins/c4s-plugin-database-tables/test/name-merge-upgrade.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/crud-schema-gen.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/design-system-serializer.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/frontend/design-system-views.render.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/frontend/ui-view-detail-and-list.render.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/projection-golden.test.ts',
  'plugins/c4s-plugin-frontend-mockups/test/ui-view-mockup.test.ts',
  'plugins/c4s-plugin-layered-vertical-slices/test/entity-contribution.test.ts',
  'plugins/c4s-plugin-layered-vertical-slices/test/manifest-shape.test.ts',
  'plugins/c4s-plugin-layered-vertical-slices/test/subagent-contribution.test.ts',
  'plugins/c4s-plugin-layered-vertical-slices/test/subagent-reader-contribution.test.ts',
  'plugins/c4s-plugin-layered-vertical-slices/test/subagent-review-contribution.test.ts',
  'plugins/c4s-plugin-mcp-tools/test/frontend/mcp-tool-views.render.test.ts',
  'plugins/c4s-plugin-mcp-tools/test/params-delta.test.ts',
  'plugins/c4s-plugin-spreadsheets/test/projection-golden.test.ts',
  'plugins/c4s-plugin-spreadsheets/test/regressions.test.ts',
  'plugins/c4s-plugin-spreadsheets/test/system-prompt.test.ts',
  'plugins/c4s-plugin-spreadsheets/test/v1-database.test.ts',
]);

describe('built-in envelope code — the host only through @c4s/plugin-runtime', () => {
  it('finds the built-in envelopes it checks', () => {
    // A rule over zero packages passes vacuously; the repo ships ten.
    expect(envelopes().length).toBeGreaterThanOrEqual(10);
  });

  it('[ac:ac-koperta-wbudowana-importuje-hosta-wylacz] the code of a built-in envelope imports the host only through @c4s/plugin-runtime (+ /ui) — no bare import of host vendor code, services or tables', () => {
    const offenders: string[] = [];
    let runtimeImports = 0;
    for (const pkg of envelopes()) {
      for (const file of codeFiles(pkg)) {
        for (const spec of specifiers(file)) {
          if (isRelative(spec)) {
            // A relative path out of the package lands in the host repo: a host
            // module (service, table, vendor copy) reached around the runtime.
            const to = target(file, spec);
            if (!inside(pkg, to)) offenders.push(`${rel(file)}: '${spec}' → ${rel(to)}`);
            continue;
          }
          if (spec.startsWith('/')) {
            offenders.push(`${rel(file)}: absolute path '${spec}'`);
            continue;
          }
          // The host's own package, under any subpath, is not the plugin runtime.
          if (spec === '@inharness-ai/claude4spec' || spec.startsWith('@inharness-ai/claude4spec/')) {
            offenders.push(`${rel(file)}: '${spec}' (host package)`);
            continue;
          }
          // `@c4s/*` is the runtime's namespace: only the two published names exist.
          if (spec.startsWith('@c4s/')) {
            if (HOST_RUNTIME.has(spec)) runtimeImports += 1;
            else offenders.push(`${rel(file)}: '${spec}' (not a published runtime subpath)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // …and the runtime IS how they reach the host.
    expect(runtimeImports).toBeGreaterThan(0);
  });

  it('[ac:ac-ekstrakcja-koperty-wbudowanej-do-osob] moving a built-in envelope to its own repo changes no import in its code — every relative import resolves inside the package', () => {
    const broken: string[] = [];
    for (const pkg of envelopes()) {
      // Simulate the move: a relative import keeps resolving after `git mv` only
      // if it points at a file inside the package that is actually there.
      for (const file of codeFiles(pkg)) {
        for (const spec of specifiers(file)) {
          if (!isRelative(spec)) continue;
          // A bundler query (`./skill.md?raw`) names the file before the `?`.
          const to = target(file, spec.replace(/\?.*$/, ''));
          if (!inside(pkg, to)) broken.push(`${rel(file)}: '${spec}' leaves the package`);
          else if (!existsAsModule(to)) broken.push(`${rel(file)}: '${spec}' does not resolve inside the package`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('built-in envelope tests — a running host only through the published harness', () => {
  it('[ac:ac-test-koperty-wbudowanej-importuje-har] a built-in envelope test imports the harness from @inharness-ai/claude4spec/plugin-testing, never from the host repo test path', () => {
    const viaHostTests: string[] = [];
    const harnessElsewhere: string[] = [];
    const harnessUsers: string[] = [];
    for (const pkg of envelopes()) {
      for (const file of testFiles(pkg)) {
        const specs = specifiers(file);
        for (const spec of specs) {
          if (!isRelative(spec)) continue;
          const to = target(file, spec);
          // The host repo's test tree (`tests/helpers/test-app`, `test-db`, …).
          if (inside(HOST_TESTS, to)) viaHostTests.push(`${rel(file)}: '${spec}'`);
          // The harness's implementation, reached by path instead of by its published name.
          if (inside(path.join(REPO_ROOT, 'src/server/plugin-testing'), to) || inside(path.join(REPO_ROOT, 'src/plugin-types'), to)) {
            harnessElsewhere.push(`${rel(file)}: '${spec}'`);
          }
        }
        const usesHarness = /\bcreatePluginTestApp\b/.test(stripComments(fs.readFileSync(file, 'utf-8')));
        if (usesHarness) {
          if (specs.includes(HARNESS)) harnessUsers.push(rel(file));
          else harnessElsewhere.push(`${rel(file)}: createPluginTestApp not imported from '${HARNESS}'`);
        }
      }
    }
    expect(viaHostTests).toEqual([]);
    expect(harnessElsewhere).toEqual([]);
    // The tests that stand a host up do so through the harness — at least the
    // three envelopes whose suites drive one (database-tables, mcp-tools, spreadsheets).
    for (const name of ['c4s-plugin-database-tables', 'c4s-plugin-mcp-tools', 'c4s-plugin-spreadsheets']) {
      expect(harnessUsers.some((f) => f.startsWith(`plugins/${name}/`)), name).toBe(true);
    }
    // The specifier they name is the one the package publishes.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports).toHaveProperty(['./plugin-testing']);
  });

  it('[ac:ac-wyniesienie-koperty-wbudowanej-do-oso] moving a built-in envelope to its own repo changes no import in its tests — none reaches the host repo test path, and no test outside the pending list leaves the package', () => {
    const left: Map<string, string[]> = new Map();
    for (const pkg of envelopes()) {
      for (const e of escapes(pkg, testFiles(pkg))) {
        const [file] = e.split(' → ');
        left.set(file!, [...(left.get(file!) ?? []), e]);
      }
    }
    const all = [...left.values()].flat();
    // Never the host repo's test tree — the route to a running host is the harness.
    expect(all.filter((e) => inside(HOST_TESTS, path.join(REPO_ROOT, e.split(' → ')[1]!)))).toEqual([]);
    // No test outside the ratchet leaves its package at all…
    expect([...left.keys()].filter((f) => !HOST_SOURCE_IMPORTS_PENDING.has(f))).toEqual([]);
    // …and an entry of the ratchet that no longer leaves it is dropped from the list.
    expect([...HOST_SOURCE_IMPORTS_PENDING].filter((f) => !left.has(f))).toEqual([]);
  });
});
