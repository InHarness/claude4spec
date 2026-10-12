/**
 * M11 "Packaging i distribution" (m11pkg00) — the package `@inharness-ai/claude4spec`
 * carries three bins, and a no-install call of a non-default bin names the
 * package with `-p`: `npx -y -p @inharness-ai/claude4spec <bin>`. The old
 * `npx -y @inharness-ai/claude4spec c4s …` form is gone — npx would run the
 * default `claude4spec` server entry, which has no `c4s` subcommand.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../../src/bin/c4s/package-version.js';
import { renderMcpConfigVariants } from '../../../src/server/mcp/mcp-config.js';

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const PKG = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
};

/** `dist/bin/<name>.js` is emitted from `src/bin/<name>.ts`. */
function sourceOf(binTarget: string): string {
  return path.join(REPO_ROOT, binTarget.replace(/^(\.\/)?dist\//, 'src/').replace(/\.js$/, '.ts'));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('package bins (M11 packaging)', () => {
  it('[ac:ac-bin-c4s-jest-dostepny-po-instalacji-pa] package.json of @inharness-ai/claude4spec declares bin.c4s next to bin.claude4spec', () => {
    expect(PKG.name).toBe('@inharness-ai/claude4spec');
    expect(PKG.bin.claude4spec).toBe('dist/bin/claude4spec.js');
    expect(PKG.bin.c4s).toBe('dist/bin/c4s.js');
    expect(fs.existsSync(sourceOf(PKG.bin.c4s))).toBe(true);
    expect(fs.existsSync(sourceOf(PKG.bin.claude4spec))).toBe(true);
  });

  it('[ac:ac-bin-c4s-jest-dostepny-po-instalacji-pa] `c4s --version` prints the package version', () => {
    expect(readPackageVersion()).toBe(PKG.version);
    // Run the c4s bin's entry itself (source form — `dist/` is not built in a
    // test run), exactly as `npx c4s --version` would after installation.
    const out = execFileSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), [sourceOf(PKG.bin.c4s), '--version'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    expect(out.trim()).toBe(`c4s ${PKG.version}`);
  }, 90_000);

  it('[section:m11pkg00] the package carries exactly three bins — claude4spec (default, server), c4s (CLI), c4s-mcp (stdio↔HTTP bridge)', () => {
    expect(Object.keys(PKG.bin).sort()).toEqual(['c4s', 'c4s-mcp', 'claude4spec']);
    expect(PKG.bin['c4s-mcp']).toBe('dist/bin/c4s-mcp.js');
    for (const target of Object.values(PKG.bin)) expect(fs.existsSync(sourceOf(target))).toBe(true);
    // The bare `npx @inharness-ai/claude4spec` runs the bin named after the
    // package's unscoped name — the server entry; the other two differ from it.
    const unscoped = PKG.name.split('/').pop();
    expect(unscoped).toBe('claude4spec');
    expect(PKG.bin[unscoped!]).toBe('dist/bin/claude4spec.js');
  });

  it('[section:m11pkg00] a non-default bin is called without installation as `npx -y -p @inharness-ai/claude4spec <bin>`; the `npx -y <package> c4s` form is gone', () => {
    // The one no-install bin call the server emits — the stdio variant of the
    // MCP connection config — uses the `-p` form.
    const stdio = renderMcpConfigVariants({ publicUrl: 'http://localhost:1', projectId: 'p' }).find(
      (v) => v.id === 'stdio',
    )!;
    const { command, args } = (JSON.parse(stdio.snippet) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    }).mcpServers['c4s-reader']!;
    expect([command, ...args.slice(0, 4)]).toEqual(['npx', '-y', '-p', PKG.name, 'c4s-mcp']);

    // No generated text, skill template or doc still teaches the removed form.
    const removed = /npx\s+-y\s+@inharness-ai\/claude4spec\s+c4s\b/;
    const files = [
      ...walk(path.join(REPO_ROOT, 'src')),
      ...(fs.existsSync(path.join(REPO_ROOT, 'README.md')) ? [path.join(REPO_ROOT, 'README.md')] : []),
    ];
    const offenders = files.filter((f) => removed.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
