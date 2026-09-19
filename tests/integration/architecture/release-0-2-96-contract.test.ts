import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brief `0-2-95-to-0-2-96` — the brief/patch CLI family renamed and fully
 * server-delegating.
 *
 * `c4s read-brief` → `c4s get-brief`, `c4s file-patch` → `c4s create-patch`,
 * operation `file_patch` → `create_patch`. There is deliberately no alias, so
 * the claims worth pinning are the ones a stray revert would silently undo:
 * the new names are registered and render the right operations, and the old
 * ones are gone from every place a caller could reach them.
 *
 * Contributions are parsed rather than imported, as in the 0.2.13 contract:
 * `src/bin/c4s.ts` runs `main()` at import.
 */

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'src/bin/c4s/commands');

function contributions(): Map<string, { operation?: string; mode?: string; file: string }> {
  const out = new Map<string, { operation?: string; mode?: string; file: string }>();
  for (const f of fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const text = fs.readFileSync(path.join(COMMANDS_DIR, f), 'utf8');
    for (const m of text.matchAll(/: CliCommandContribution = \{([\s\S]*?)\n\};/g)) {
      const decl = m[1]!;
      const name = /name: '([^']+)'/.exec(decl)?.[1];
      if (!name) continue;
      out.set(name, {
        operation: /operation: '([^']+)'/.exec(decl)?.[1],
        mode: /executionMode: '([^']+)'/.exec(decl)?.[1],
        file: f,
      });
    }
  }
  return out;
}

describe('brief/patch CLI family after 0.2.96', () => {
  it('registers get-brief and create-patch, rendering get_brief and create_patch server-side', () => {
    const byName = contributions();
    expect(byName.get('get-brief')).toMatchObject({ operation: 'get_brief', mode: 'server-delegating' });
    expect(byName.get('create-patch')).toMatchObject({ operation: 'create_patch', mode: 'server-delegating' });

    const bin = fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s.ts'), 'utf8');
    const arrayBlock = /const COMMANDS: CliCommandContribution\[\] = \[([\s\S]*?)\n\];/.exec(bin)?.[1] ?? '';
    expect(arrayBlock).toMatch(/\bgetBriefCommand,/);
    expect(arrayBlock).toMatch(/\bcreatePatchCommand,/);
  });

  it('[ac:ac-rodzina-brief-patch-list-briefs-read] all four brief/patch commands are server-delegating', () => {
    const byName = contributions();
    for (const name of ['create-brief', 'list-briefs', 'get-brief', 'create-patch', 'mark-brief-implemented']) {
      expect(byName.get(name)?.mode, name).toBe('server-delegating');
    }
  });

  it('has no alias: read-brief / file-patch are not declared by any command', () => {
    const byName = contributions();
    expect(byName.has('read-brief')).toBe(false);
    expect(byName.has('file-patch')).toBe(false);
  });

  it('the catalog knows create_patch and no longer knows file_patch', async () => {
    const { CATALOG } = await import('../../../src/server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
    registerCoreOperations();
    expect(CATALOG.get('create_patch')).toBeDefined();
    expect(CATALOG.get('file_patch')).toBeUndefined();
  });
});
