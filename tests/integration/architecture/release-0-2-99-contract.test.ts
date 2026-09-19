import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Brief `0-2-98-to-0-2-99` — the M37 skills registry becomes two catalog
 * operations: `list_skills` (new; cli/mcp/rest, `n/a` internal) and
 * `load_skill_file` (now `direct` in all four channels). Behavior is asserted
 * next to each rendering (`skill-operations.test.ts`, `skills.route.test.ts`,
 * `skill-tools.test.ts`, `mcp-over-http.test.ts`, `skill-commands.test.ts`,
 * `agent-turn.test.ts`); this file pins the declarations and the cross-channel
 * invariants a stray revert would quietly undo. CLI contributions are parsed,
 * not imported — `src/bin/c4s.ts` runs `main()` at import.
 */

const REPO_ROOT = path.join(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

async function catalog() {
  const { CATALOG } = await import('../../../src/server/operations/catalog.js');
  const { registerCoreOperations } = await import('../../../src/server/operations/core-operations.js');
  registerCoreOperations();
  return CATALOG;
}

describe('M37 skills registry after 0.2.99', () => {
  it('list_skills: read-class, direct in cli/mcp/rest, n/a internal, INVALID_ARGUMENT only', async () => {
    const row = (await catalog()).get('list_skills')!;
    expect(row).toBeDefined();
    expect(row.opClass).toBe('read');
    expect(row.idempotent).toBe(true);
    expect(row.channels.internal.kind).toBe('na');
    for (const ch of ['cli', 'mcp', 'rest'] as const) expect(row.channels[ch].kind, ch).toBe('direct');
    expect([...row.errorCodes]).toEqual(['INVALID_ARGUMENT']);
    expect(Object.keys(row.inputSchema)).toEqual(['contextType']);
  });

  it('load_skill_file: read-class, direct in all four channels, the four registry codes', async () => {
    const row = (await catalog()).get('load_skill_file')!;
    expect(row).toBeDefined();
    expect(row.opClass).toBe('read');
    for (const ch of ['internal', 'cli', 'mcp', 'rest'] as const) expect(row.channels[ch].kind, ch).toBe('direct');
    expect([...row.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'NOT_TEXT', 'SKILL_FILE_NOT_FOUND', 'SKILL_NOT_FOUND']);
    expect(Object.keys(row.inputSchema).sort()).toEqual(['file', 'slug']);
  });

  it('every profile admits both, through their class — no profile registry change', async () => {
    const CATALOG = await catalog();
    const { profileAdmits, KNOWN_PROFILES, DEFAULT_PROFILE } = await import('../../../src/server/operations/profiles.js');
    expect(DEFAULT_PROFILE).toBe('chat');
    for (const profile of KNOWN_PROFILES) {
      for (const op of ['list_skills', 'load_skill_file']) {
        expect(profileAdmits(profile as never, CATALOG.get(op)!), `${profile}/${op}`).toBe(true);
      }
    }
  });

  it('[ac:ac-odczyt-podpliku-binarnego-odmawia-tym] one taxonomy in every channel: the codes are declared on each surface', () => {
    const codes = ['SKILL_NOT_FOUND', 'SKILL_FILE_NOT_FOUND', 'NOT_TEXT', 'INVALID_ARGUMENT'];
    const surface = read('src/server/mcp/surface.ts');
    const errors = read('src/bin/c4s/errors.ts');
    for (const code of codes) {
      expect(surface, `external MCP declares ${code}`).toContain(`'${code}'`);
      expect(errors, `CLI union has ${code}`).toMatch(new RegExp(`\\| '${code}'`));
    }
    const status = read('src/server/operations/error-codes.ts');
    expect(status).toMatch(/SKILL_NOT_FOUND: 404/);
    expect(status).toMatch(/SKILL_FILE_NOT_FOUND: 404/);
    expect(status).toMatch(/NOT_TEXT: 415/);
  });

  it('the truncation budget lives in the one core function every channel calls', () => {
    // No channel adapter mentions the budget: it is applied once, in the core.
    expect(read('src/server/services/skill-operations.ts')).toContain('DEFAULT_BUDGET_CHARS');
    for (const adapter of [
      'src/server/mcp/skill-tools.ts',
      'src/server/routes/skills.ts',
      'src/bin/c4s/commands/list-skills.ts',
      'src/bin/c4s/commands/load-skill-file.ts',
    ]) {
      expect(read(adapter), adapter).not.toMatch(/BUDGET|120_?000/);
    }
  });

  it('REST takes `file` as a query parameter, never a wildcard segment', () => {
    const route = read('src/server/routes/skills.ts');
    const paths = [...route.matchAll(/router\.get\('([^']*)'/g)].map((m) => m[1]);
    expect(paths).toEqual(['/', '/:slug']);
    expect(read('src/server/workspace/project-context.ts')).toMatch(/router\.use\('\/skills', skillsRouter/);
  });

  it('the turn mounts skill-tools WITHOUT a resolver (no list_skills); the external surface WITH one', () => {
    expect(read('src/server/routes/agent-turn.ts')).toMatch(/buildSkillToolsServer\(deps\.skillRegistry, deps\.projectId \?\? null\)/);
    expect(read('src/server/mcp/surface.ts')).toMatch(/buildSkillToolsServer\([^)]*\{ resolver: deps\.skillResolver \}\)/);
  });

  it('both CLI commands are registered, server-delegating, rendering their operations', () => {
    const bin = read('src/bin/c4s.ts');
    const arrayBlock = /const COMMANDS: CliCommandContribution\[\] = \[([\s\S]*?)\n\];/.exec(bin)?.[1] ?? '';
    for (const [file, name, op, contribution] of [
      ['list-skills', 'list-skills', 'list_skills', 'listSkillsCommand'],
      ['load-skill-file', 'load-skill-file', 'load_skill_file', 'loadSkillFileCommand'],
    ] as const) {
      const src = read(`src/bin/c4s/commands/${file}.ts`);
      expect(src).toMatch(new RegExp(`name: '${name}'`));
      expect(src).toMatch(new RegExp(`operation: '${op}'`));
      expect(src).toMatch(/executionMode: 'server-delegating'/);
      expect(arrayBlock).toMatch(new RegExp(`\\b${contribution},`));
    }
  });

  it('the context-type enumeration is cited from its owner, not re-spelled by M37', () => {
    const ops = read('src/server/services/skill-operations.ts');
    expect(ops).toMatch(/from '\.\/chat-context\.js'/);
    expect(ops).not.toMatch(/'chat'\s*\|\s*'brief'/);
  });
});
