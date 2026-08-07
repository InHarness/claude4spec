import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  OperationCatalog,
  OperationCatalogError,
  direct,
  na,
  type ChannelName,
  type OperationDeclaration,
} from './catalog.js';
import { registerCoreOperations } from './core-operations.js';
import { KNOWN_OPERATION_CLASSES, PROFILES, mcpServerSetForProfile, profileAdmits } from './profiles.js';
import { toolAdmittedByProfile, withheldTools } from './profile-gate.js';
import { toolError, toolSuccess } from './envelope.js';
import { httpStatusForCode } from './error-codes.js';

registerCoreOperations();

const CHANNELS: ChannelName[] = ['internal', 'cli', 'mcp', 'rest'];

/** A minimal valid declaration, for the registry's own rules. */
const decl = (over: Partial<OperationDeclaration> = {}): OperationDeclaration => ({
  name: 'get_thing',
  summary: 'x',
  scope: 'project',
  mediation: 'direct',
  opClass: 'read',
  inputSchema: {},
  errorCodes: [],
  sideEffects: ['none'],
  idempotent: true,
  channels: { internal: direct(), cli: direct(), mcp: direct(), rest: direct() },
  ...over,
});

describe('operation catalog — declaration rules', () => {
  it('rejects a declaration missing a channel cell', () => {
    const cat = new OperationCatalog();
    const broken = decl({
      channels: { internal: direct(), cli: direct(), mcp: direct() } as never,
    });
    expect(() => cat.register(broken)).toThrow(OperationCatalogError);
    expect(() => cat.register(broken)).toThrow(/no 'rest' cell/);
  });

  it('rejects a name that is not snake_case', () => {
    const cat = new OperationCatalog();
    expect(() => cat.register(decl({ name: 'getThing' }))).toThrow(/snake_case/);
    expect(() => cat.register(decl({ name: 'get__thing' }))).toThrow(/snake_case/);
    expect(() => cat.register(decl({ name: '_get' }))).toThrow(/snake_case/);
  });

  it('rejects a duplicate registration rather than silently replacing it', () => {
    const cat = new OperationCatalog();
    cat.register(decl());
    expect(() => cat.register(decl())).toThrow(/already registered/);
  });

  it('accepts an `na` cell — a declared gap is legal, an undeclared one is not', () => {
    const cat = new OperationCatalog();
    const op = cat.register(
      decl({ name: 'list_projects', channels: { internal: direct(), cli: direct(), mcp: direct(), rest: na('deferred') } }),
    );
    expect(op.channels.rest).toEqual({ kind: 'na', reason: 'deferred' });
  });
});

describe('the seeded catalog', () => {
  it('every declaration answers for all four channels', () => {
    for (const op of CATALOG.list()) {
      for (const channel of CHANNELS) {
        expect(op.channels[channel], `${op.name}.${channel}`).toBeDefined();
      }
    }
  });

  it('an `na` cell always carries a written reason', () => {
    for (const op of CATALOG.list()) {
      for (const channel of CHANNELS) {
        const cell = op.channels[channel];
        if (cell.kind === 'na') {
          expect(cell.reason.length, `${op.name}.${channel}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('declares every M39 read operation with full four-channel parity and zero n/a', () => {
    const M39 = [
      'overview',
      'describe_types',
      'list_pages',
      'list_sections',
      'get_sections',
      'get_page',
      'search_pages',
      'search_entities',
      'list_entities',
      'get_entities',
      'list_tags',
      'find_references',
      'check_consistency',
      'resolve_identity',
    ];
    expect(M39).toHaveLength(14);
    for (const name of M39) {
      const op = CATALOG.get(name);
      expect(op, name).toBeDefined();
      expect(op!.scope).toBe('project');
      expect(op!.mediation).toBe('direct');
      expect(op!.opClass).toBe('read');
      expect(op!.sideEffects).toEqual(['none']);
      for (const channel of CHANNELS) {
        expect(op!.channels[channel].kind, `${name}.${channel}`).toBe('direct');
      }
    }
  });

  it('every declared opClass is one the profile registry knows', () => {
    for (const op of CATALOG.list()) {
      expect(KNOWN_OPERATION_CLASSES).toContain(op.opClass);
    }
  });

  it('`list_projects` is workspace-scoped and declares its REST gap rather than claiming parity', () => {
    const op = CATALOG.require('list_projects');
    expect(op.scope).toBe('workspace');
    expect(op.channels.rest.kind).toBe('na');
  });

  it('`file_patch` is not idempotent — two filings of one drift are two files', () => {
    expect(CATALOG.require('file_patch').idempotent).toBe(false);
  });

  it('`abort_turn` IS idempotent — aborting a thread with no live turn is a no-op', () => {
    expect(CATALOG.require('abort_turn').idempotent).toBe(true);
  });
});

describe('context profiles', () => {
  it('an external connection with no profile named gets `chat`', async () => {
    const { DEFAULT_PROFILE } = await import('./profiles.js');
    expect(DEFAULT_PROFILE).toBe('chat');
  });

  it('[ac:ac-profil-patch-w-kanale-mcp-daje-ten-sa] `patch` admits exactly what `chat` admits', () => {
    expect([...PROFILES.patch.operationClasses].sort()).toEqual([...PROFILES.chat.operationClasses].sort());
  });

  it('[ac:ac-profil-ask-w-kanale-mcp-renderuje-sie] `ask` admits read and plan, and nothing that writes or delegates', () => {
    expect(profileAdmits('ask', CATALOG.require('get_page'))).toBe(true);
    expect(profileAdmits('ask', CATALOG.require('update_plan'))).toBe(true);
    expect(profileAdmits('ask', CATALOG.require('create_entities'))).toBe(false);
    expect(profileAdmits('ask', CATALOG.require('tag_entity'))).toBe(false);
    // The recursion guard is a property of the profile, so no channel routes around it.
    expect(profileAdmits('ask', CATALOG.require('ask'))).toBe(false);
    expect(profileAdmits('ask', CATALOG.require('abort_turn'))).toBe(false);
  });

  it('[ac:ac-profil-brief-w-kanale-mcp-renderuje-s] `brief` admits brief artifacts and reads, not spec writes', () => {
    expect(profileAdmits('brief', CATALOG.require('get_brief'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('file_patch'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('list_entities'))).toBe(true);
    expect(profileAdmits('brief', CATALOG.require('create_entities'))).toBe(false);
  });

  it('the mounted server set is DERIVED from the admitted classes, not written beside them', () => {
    // These four reproduce the pre-0.2.13 hand-written registry rows exactly —
    // the derivation is behaviour-preserving, which is what makes it safe.
    expect(mcpServerSetForProfile('chat')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: true,
      transagentTools: true,
    });
    expect(mcpServerSetForProfile('brief')).toEqual({
      pluginServers: 'release-only',
      planTools: false,
      briefTools: true,
      c4sTools: false,
      transagentTools: false,
    });
    expect(mcpServerSetForProfile('patch')).toEqual(mcpServerSetForProfile('chat'));
    expect(mcpServerSetForProfile('ask')).toEqual({
      pluginServers: 'all',
      planTools: true,
      briefTools: false,
      c4sTools: false,
      transagentTools: false,
    });
  });

  it('`brief` is the profile that forces an explicit brief-addressing parameter', () => {
    expect(PROFILES.brief.requiresExplicitBriefTarget).toBe(true);
    for (const p of ['chat', 'ask', 'patch'] as const) {
      expect(PROFILES[p].requiresExplicitBriefTarget).toBe(false);
    }
  });
});

describe('the profile gate', () => {
  it('[ac:ac-operacja-spoza-profilu-polaczenia-nie] withholds the entity write tools from `ask` — the peer that used to get them', () => {
    // The real entity-tools surface. Before 0.2.13 `ask` was handed all seven and
    // held back only by forced plan mode, which does not apply to MCP.
    const entityTools = [
      'create_entities',
      'get_entities',
      'update_entities',
      'delete_entities',
      'list_entities',
      'search_entities',
      'describe_entity_type',
    ].map((name) => ({ name, description: '', inputSchema: {}, handler: async () => ({}) }));

    expect(withheldTools('ask', entityTools).sort()).toEqual([
      'create_entities',
      'delete_entities',
      'update_entities',
    ]);
    // `chat` loses nothing.
    expect(withheldTools('chat', entityTools)).toEqual([]);
  });

  it('passes through a tool the catalog has no declaration for', () => {
    // Declaring an operation must be what NARROWS access, never what accidentally
    // grants it — so an undeclared name stays governed by the coarse server gate.
    expect(CATALOG.has('release_create')).toBe(false);
    expect(toolAdmittedByProfile('ask', 'release_create')).toBe(true);
    expect(toolAdmittedByProfile('brief', 'runTransagent')).toBe(true);
  });
});

describe('envelope and error taxonomy', () => {
  it('serializes success into a single text block', () => {
    expect(toolSuccess({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{"a":1}' }] });
  });

  it('marks errors with isError and carries the code inside the payload', () => {
    const env = toolError('NOT_FOUND', 'no such page', 'try list_pages');
    expect(env.isError).toBe(true);
    expect(JSON.parse(env.content[0]!.text)).toEqual({
      error: 'no such page',
      code: 'NOT_FOUND',
      hint: 'try list_pages',
    });
  });

  it('maps the shared codes onto HTTP without inventing new ones', () => {
    expect(httpStatusForCode('INVALID_TYPE')).toBe(404);
    expect(httpStatusForCode('BRIEF_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('THREAD_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('PATCH_WRITE_FAILED')).toBe(500);
    expect(httpStatusForCode('VALIDATION')).toBe(400);
    // Unknown ⇒ client error, never a 500 the caller cannot act on.
    expect(httpStatusForCode('SOMETHING_NOBODY_DECLARED')).toBe(400);
  });
});
