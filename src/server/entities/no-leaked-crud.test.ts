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

/**
 * 2.0.0 tier K, item 62 — the FILE SHAPE, pinned by name.
 *
 * The three things this tier removed are all removed by deletion, which means
 * nothing fails if one comes back: a new `crud-schemas.ts` next to a type, a
 * revived `createCrudRouter` helper, or a fresh per-type `service.ts`. Each
 * would work, quietly, and each would re-open the drift the tier closed — a
 * second description of a shape the declaration already gives, or a second write
 * door the host does not know about.
 *
 * So the assertion is on the tree, not on behaviour. It scans the in-repo types
 * AND every built-in envelope, discovered rather than listed — the envelopes are
 * where most of the retired services lived, and by 0.2.18 they are where most of
 * the types live. A hardcoded list would silently stop covering the next one.
 */
describe('tier K left nothing to grow back (item 62)', () => {
  const PLUGINS_DIR = path.join(SRC_ROOT, 'plugins');
  const TYPE_ROOTS = [
    path.join(SRC_ROOT, 'src', 'server', 'entities'),
    ...(fs.existsSync(PLUGINS_DIR)
      ? fs
          .readdirSync(PLUGINS_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(PLUGINS_DIR, e.name, 'src', 'entity'))
      : []),
  ].filter((dir) => fs.existsSync(dir));

  const typeFiles = (): string[] => TYPE_ROOTS.flatMap((root) => walk(root));
  const named = (re: RegExp): string[] =>
    typeFiles()
      .filter((f) => re.test(path.basename(f)))
      .map((f) => path.relative(SRC_ROOT, f))
      .sort();

  it('no type ships a hand-written CRUD input schema', () => {
    // Generated from `data.schema` (item 27). A second, hand-written description
    // of the same fields can only ever drift from the table and the write door.
    expect(named(/^crud-schemas\.ts$/)).toEqual([]);
  });

  it('no type ships a CRUD service', () => {
    /**
     * 0.2.28 — the assertion moved from the FILE NAME to what is inside it.
     *
     * Until now no type registered `backend.service` at all, so "there is no
     * `service.ts`" and "there is no CRUD service" were the same statement and
     * the cheaper one was the test. `design-system` broke the tie by needing
     * the thing the slot was always for: a DOMAIN HELPER (token `resolve()` and
     * the CSS sheet built from it), which the Host API names in as many words.
     * Keeping the name-based gate would have forced that helper to hide under a
     * blander filename — the exact smuggling the `views.ts` case above warns
     * about — so the honest invariant is asserted directly instead.
     *
     * What must stay absent is a SECOND WRITE DOOR: create/update/delete/upsert
     * on a per-type service, or a service reaching SQL. Those are what tier K
     * removed; a pure function of its arguments is not one of them.
     */
    const services = typeFiles().filter((f) => /^services?\.ts$/.test(path.basename(f)));
    const crudish: string[] = [];

    // Comments are stripped before either scan: this gate reads CODE, and a
    // docblock explaining why a service must not `SELECT ... FROM` anything
    // would otherwise fail the case it is describing.
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // A write verb in METHOD-DECLARATION position. Line-based rather than one
    // regex, because the two forms differ only in what FOLLOWS the parameter
    // list: a declaration opens a body, a call ends in `;`. Modifiers, generics
    // and a `create`-prefixed name (`createMany`) all have to be reachable —
    // the door this gate closes must not be re-openable by rephrasing.
    const WRITE_METHOD =
      /^[ \t]*(?:(?:public|private|protected|static|readonly|override|async)\s+)*\*?\s*(create|update|delete|upsert|remove|insert)\w*\s*(?:<[^>]*>)?\s*\(/i;

    for (const file of services) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const lines = text.split('\n');
      if (lines.some((l) => WRITE_METHOD.test(l) && !/;\s*$/.test(l))) {
        crudish.push(path.relative(SRC_ROOT, file));
      }
      // Or any SQL at all — the host owns the projection.
      if (/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|SELECT\b.*\bFROM)\b/i.test(text)) {
        crudish.push(path.relative(SRC_ROOT, file));
      }
    }
    expect([...new Set(crudish)]).toEqual([]);
  });

  it('no type ships a `views.ts` — there are no views left to put in one', () => {
    /**
     * The convention INVERTED in 0.2.23, and the file name is the signal.
     *
     * `views.ts` was the vertical slice's home for computed read code, and this
     * case used to insist on the name so a type could not smuggle the same code
     * in under a blander one. The slot is gone from the contract, so the honest
     * assertion is the opposite: what remains per type is a payload timeline and
     * an optional diff, which live in `serializer.ts`.
     */
    expect(named(/^views\.ts$/)).toEqual([]);
    // Sanity: the scan reaches the types at all. Without this the assertion
    // above passes just as well against an empty file list.
    expect(named(/^serializer\.ts$/).length).toBeGreaterThanOrEqual(6);
  });

  it('the createCrudRouter helper stays gone', () => {
    // Removed before this tier began; item 62 asks for it to be pinned rather
    // than removed again. The whole tree, not just the type packages.
    expect(grep(/\bcreateCrudRouter\b/)).toEqual([]);
  });
});
