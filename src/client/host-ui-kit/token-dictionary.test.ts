/**
 * M34/L12 — the token bridge's dictionary is closed (2.1.25, `m34l12sc`
 * "Słownik zamknięty" + "Świadomy dług — spójność encja ↔ kod").
 *
 * The bridge names have three representations in code: the host theme
 * stylesheet (`styles/theme.css`, the `:root` / `.dark` blocks that define the
 * bridge variables' values for both theme modes), the `HOST_TOKEN_NAMES`
 * constant and the published `HostTokenName` union (`plugin-types/ui.ts`).
 * This file holds the three to one name set, and holds host + envelope code to
 * that set: no `--c-*` variable outside it, not even as a `var(--x, …)`
 * fallback. Only the entity ↔ code pair stays a manual criterion.
 *
 * Text scans of the sources (no DOM), the same approach as
 * `one-implementation.test.ts` and `styles/theme.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HostTokenName as PublishedHostTokenName } from '../../plugin-types/ui.js';
import { HOST_TOKEN_NAMES, type HostTokenName } from './tokens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every custom property the theme stylesheet declares in its top-level `:root` / `.dark` blocks. */
function themeStylesheetNames(): Set<string> {
  const css = stripCssComments(readFileSync(resolve(HERE, '../styles/theme.css'), 'utf8'));
  const names = new Set<string>();
  for (const m of css.matchAll(/(?:^|\n)(?::root|\.dark)\s*\{([^}]*)\}/g)) {
    for (const d of m[1]!.matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g)) names.add(d[1]!);
  }
  return names;
}

/** The members of the published `HostTokenName` union, read from its declaration. */
function publishedUnionNames(): Set<string> {
  const src = readFileSync(resolve(HERE, '../../plugin-types/ui.ts'), 'utf8');
  const decl = /export type HostTokenName\s*=([^;]*);/.exec(src);
  expect(decl, 'plugin-types/ui.ts declares HostTokenName').not.toBeNull();
  return new Set([...decl![1]!.matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]!));
}

// Compile-time leg: the published union and the host's union are the same type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const unionsAreSame: Same<PublishedHostTokenName, HostTokenName> = true;

describe('token bridge — one name set in code (M34/L12)', () => {
  it('[ac:ac-host-token-names-unia-hosttokenname-i] HOST_TOKEN_NAMES, the published HostTokenName union and the host theme stylesheet hold the same set of names', () => {
    const constant = [...HOST_TOKEN_NAMES].sort();
    // No duplicates in the constant, so its set is its list.
    expect(new Set(constant).size).toBe(constant.length);
    // 2.1.38 — 38 names, the UI text sizes among them, in all three.
    expect(constant).toHaveLength(38);
    expect(constant).toEqual(expect.arrayContaining(['--text-sm', '--text-xs', '--text-2xs']));
    expect([...publishedUnionNames()].sort()).toEqual(constant);
    expect([...themeStylesheetNames()].sort()).toEqual(constant);
    expect(unionsAreSame).toBe(true);
  });
});

// ── closed dictionary: host + envelope code ──

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|css|html)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'test', 'tests', '__tests__']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (CODE_FILE.test(name) && !TEST_FILE.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Host code (`src/**`) and every envelope's code (`plugins/<package>/**`), tests excluded. */
function hostAndEnvelopeFiles(): string[] {
  const pluginsDir = join(REPO_ROOT, 'plugins');
  const envelopes = readdirSync(pluginsDir)
    .map((p) => join(pluginsDir, p))
    .filter((p) => statSync(p).isDirectory());
  return [walk(join(REPO_ROOT, 'src')), ...envelopes.map((p) => walk(p))].flat();
}

const DICTIONARY = new Set<string>(HOST_TOKEN_NAMES);

/**
 * Every `--c-*` reference in a source text that is not a host token — wherever
 * it stands: `var(--c-x)`, the fallback of `var(--c-bg, var(--c-x))`, a
 * `getPropertyValue('--c-x')`. A name built at runtime (`--c-${…}`) cannot be
 * shown to be in the dictionary, so it counts as outside it.
 */
function offDictionary(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/--c-[\w-]*[A-Za-z0-9]/g)) if (!DICTIONARY.has(m[0])) out.push(m[0]);
  for (const m of src.matchAll(/--c-\$\{/g)) out.push(m[0]);
  return out;
}

describe('token bridge — closed dictionary (M34/L12)', () => {
  it('[ac:ac-kod-hosta-i-kopert-nie-odwoluje-sie-d] the detector flags a --c-* name outside HOST_TOKEN_NAMES, also as a fallback', () => {
    expect(offDictionary("color: 'var(--c-ink)'")).toEqual([]);
    expect(offDictionary("color: 'var(--c-yellow, #c4a24f)'")).toEqual([]);
    expect(offDictionary("color: 'var(--c-ink-soft)'")).toEqual(['--c-ink-soft']);
    expect(offDictionary("color: 'var(--c-red, var(--c-danger))'")).toEqual(['--c-danger']);
    expect(offDictionary('border: `1px solid var(--c-${tone})`')).toEqual(['--c-${']);
  });

  it('[ac:ac-kod-hosta-i-kopert-nie-odwoluje-sie-d] host and envelope code reference no --c-* variable outside HOST_TOKEN_NAMES', () => {
    const files = hostAndEnvelopeFiles();
    const rel = (f: string) => relative(REPO_ROOT, f).split(sep).join('/');
    // The scan reaches both host code and envelope code.
    expect(files.some((f) => rel(f) === 'src/client/styles/theme.css')).toBe(true);
    expect(files.some((f) => rel(f).startsWith('plugins/c4s-plugin-api-contracts/src/'))).toBe(true);

    const findings: string[] = [];
    for (const file of files) {
      for (const name of offDictionary(readFileSync(file, 'utf8'))) findings.push(`${rel(file)}: ${name}`);
    }
    expect(findings).toEqual([]);
  });
});
