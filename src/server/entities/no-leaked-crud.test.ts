import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * M13: guards against per-type CRUD abstractions leaking back into the
 * codebase now that create/get/update/delete/list/search live exclusively on
 * the generic `entity-tools` server (src/server/mcp/entity-tools.ts). A
 * genuine hit outside `core/plugin-host/`/`entities/` means a per-type MCP
 * tool name or entity-count hardcode has resurfaced somewhere it must
 * dispatch through the host/entity-tools instead.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const EXEMPT_DIR_PREFIXES = [
  path.join('src', 'server', 'core', 'plugin-host'),
  // Shared (dep-free) half of the same plugin-host layer — split out only so
  // c4s-reader / plugin authors don't pull in express/better-sqlite3, per its
  // own module docstring. Doc-comment examples here (e.g. countStat.placeholder
  // "endpointCount") describe the general SHAPE of a per-type slot, not a
  // leaked per-type branch — same exemption rationale as the server half.
  path.join('src', 'shared', 'plugin-host'),
  path.join('src', 'server', 'entities'),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isExempt(absFile: string): boolean {
  const rel = path.relative(SRC_ROOT, absFile);
  return EXEMPT_DIR_PREFIXES.some((prefix) => rel.startsWith(prefix + path.sep));
}

function grep(pattern: RegExp): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of walk(path.join(SRC_ROOT, 'src'))) {
    if (isExempt(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, idx) => {
      if (pattern.test(text)) hits.push({ file: path.relative(SRC_ROOT, file), line: idx + 1, text: text.trim() });
    });
  }
  return hits;
}

describe('no leaked per-type CRUD abstractions (M13)', () => {
  it('no endpointCount/dtoCount/tableCount/dto-tools hardcodes outside core/plugin-host or entities', () => {
    const hits = grep(/\b(endpointCount|dtoCount|tableCount|dto-tools)\b/);
    expect(hits).toEqual([]);
  });

  it('no leaked per-type CRUD tool names outside core/plugin-host or entities', () => {
    const hits = grep(/\b(create_endpoint|create_dto|ui-view-tools|design-system-tools)\b/);
    expect(hits).toEqual([]);
  });
});
