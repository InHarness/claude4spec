import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brief `0-2-97-to-0-2-98` — `create_plan` becomes a `direct` operation in all
 * four channels: MCP tool, `POST /api/plans`, `c4s create-plan`, and the
 * internal mount. The behavior is asserted next to each rendering (service,
 * route, tool, CLI tests); this file pins the declarations a stray revert would
 * quietly undo. Contributions are parsed, not imported — `src/bin/c4s.ts` runs
 * `main()` at import.
 */

const REPO_ROOT = path.join(import.meta.dirname, '../../..');

describe('create_plan after 0.2.98', () => {
  it('the catalog row is direct in every channel, class `plan`, with PLAN_ALREADY_EXISTS', async () => {
    const { CATALOG } = await import('../../../src/server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
    registerCoreOperations();
    const row = CATALOG.get('create_plan')!;
    expect(row).toBeDefined();
    expect(row.mediation).toBe('direct');
    expect(row.opClass).toBe('plan');
    for (const ch of ['internal', 'cli', 'mcp', 'rest'] as const) {
      expect(row.channels[ch].kind, ch).toBe('direct');
    }
    expect([...row.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_ALREADY_EXISTS']);
    expect([...row.sideEffects].sort()).toEqual(['db', 'file']);
    expect(Object.keys(row.inputSchema).sort()).toEqual(['content', 'title']);
  });

  it('`ask` admits it through its class, with no change to the profile registry', async () => {
    const { profileAdmits } = await import('../../../src/server/operations/profiles.js');
    const { CATALOG } = await import('../../../src/server/operations/catalog.js');
    const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
    registerCoreOperations();
    expect(profileAdmits('ask', CATALOG.get('create_plan')!)).toBe(true);
  });

  it('c4s create-plan is registered, server-delegating, rendering create_plan', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s/commands/create-plan.ts'), 'utf8');
    expect(src).toMatch(/name: 'create-plan'/);
    expect(src).toMatch(/operation: 'create_plan'/);
    expect(src).toMatch(/executionMode: 'server-delegating'/);

    const bin = fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s.ts'), 'utf8');
    const arrayBlock = /const COMMANDS: CliCommandContribution\[\] = \[([\s\S]*?)\n\];/.exec(bin)?.[1] ?? '';
    expect(arrayBlock).toMatch(/\bcreatePlanCommand,/);

    const errors = fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s/errors.ts'), 'utf8');
    expect(errors).toMatch(/\| 'PLAN_ALREADY_EXISTS'/);
  });
});
