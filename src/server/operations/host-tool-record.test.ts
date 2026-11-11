import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog.js';
import { resolveHostToolRecord } from './host-tool-record.js';
import { effectiveToolClass, gateServer, toolAdmittedByProfile } from './profile-gate.js';
import { buildTransagentToolsServer, type TransagentDispatcher } from '../mcp/transagent-tools.js';
import { createEntityToolsServer } from '../mcp/entity-tools.js';
import { PROFILES } from './profiles.js';

/*
 * 2.1.83 (M44 "Klasa narzędzia dla bramki profilu", L15) — one definition of a
 * host-server tool's record, used by the profile gate and by the plan-mode
 * "Do not call" list: the row named after the tool, else the row whose declared
 * renderings name `<server>.<tool>` in its channel, else none.
 */

describe('resolveHostToolRecord — the one host-tool record definition (2.1.83)', () => {
  it('hits by name: a tool with a row of its own name resolves to that row', () => {
    const op = resolveHostToolRecord('get_entities', { server: 'entity-tools' });
    expect(op?.name).toBe('get_entities');
    // The server is not needed for the name step.
    expect(resolveHostToolRecord('get_entities')?.name).toBe('get_entities');
  });

  it('hits by declared rendering: a tool with no row of its own name resolves to the row whose renderings name it in its channel', () => {
    expect(CATALOG.has('runTransagent')).toBe(false);
    expect(resolveHostToolRecord('runTransagent', { server: 'transagent-tools', channel: 'internal' })?.name).toBe(
      'spawn_child_turn',
    );
    // The channel defaults to a turn's (`internal`).
    expect(resolveHostToolRecord({ name: 'describe_entity_type' }, { server: 'entity-tools' })?.name).toBe(
      'describe_types',
    );
    // `describe_types` declares `entity-tools.describe_entity_type` in `mcp` too.
    expect(resolveHostToolRecord('describe_entity_type', { server: 'entity-tools', channel: 'mcp' })?.name).toBe(
      'describe_types',
    );
  });

  it('a rendering speaks only for its own server and channel', () => {
    // Another server exposing the same tool name is not that rendering.
    expect(resolveHostToolRecord('runTransagent', { server: 'scratch-tools' })).toBeUndefined();
    // `spawn_child_turn` declares no `mcp` rendering.
    expect(resolveHostToolRecord('runTransagent', { server: 'transagent-tools', channel: 'mcp' })).toBeUndefined();
    // No server: only the name step can apply.
    expect(resolveHostToolRecord('runTransagent')).toBeUndefined();
  });

  it('misses both: no row by name and no declared rendering gives undefined', () => {
    const tool = 'zz_fixture_host_probe';
    expect(CATALOG.has(tool)).toBe(false);
    expect(resolveHostToolRecord(tool, { server: 'scratch-tools' })).toBeUndefined();
    // …and the gate gives such a tool no class and passes it — never `write`.
    expect(effectiveToolClass(tool, { server: 'scratch-tools' })).toBeUndefined();
    for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
      expect(toolAdmittedByProfile(profile, tool, { server: 'scratch-tools' }), profile).toBe(true);
    }
  });
});

describe('M44 — the profile gate classifies host tools by the shared record (2.1.83)', () => {
  it("[ac:ac-m44-bramka-runtransagent-klasa-turn] in a context_type='chat' thread with parent_thread_id IS NULL the gate gives runTransagent the `turn` class from the spawn_child_turn record its declared renderings point at", () => {
    // `transagent-tools` is the server a top-level chat thread mounts (M44 `3f5ej79s`);
    // `parentThreadId` here is that thread's own id, the parent of the children it spawns.
    const server = buildTransagentToolsServer({ parentThreadId: 't-chat', dispatcher: {} as TransagentDispatcher });
    const decl = server.tools.find((t) => t.name === 'runTransagent');
    expect(decl).toBeDefined();
    const record = resolveHostToolRecord(decl!, { server: 'transagent-tools', channel: 'internal' });
    expect(record?.name).toBe('spawn_child_turn');
    expect(effectiveToolClass(decl!, { server: 'transagent-tools', channel: 'internal' })).toBe('turn');
    expect(record?.opClass).toBe('turn');
    // `chat` admits `turn`, so the tool stays in the chat turn after the gate.
    const gated = gateServer('chat', 'transagent-tools', server);
    expect(gated?.tools?.map((t) => t.name)).toContain('runTransagent');
  });

  it('[ac:ac-m44-bramka-describe-entity-type-klasa-read] the gate gives describe_entity_type of entity-tools the `read` class from the describe_types record its declared renderings point at', () => {
    const server = createEntityToolsServer({} as never);
    const decl = server.tools.find((t) => t.name === 'describe_entity_type');
    expect(decl).toBeDefined();
    expect(CATALOG.has('describe_entity_type')).toBe(false);
    expect(resolveHostToolRecord(decl!, { server: 'entity-tools' })?.name).toBe('describe_types');
    expect(effectiveToolClass(decl!, { server: 'entity-tools' })).toBe('read');
    // `read` is in every profile, so every profile keeps it.
    for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
      expect(gateServer(profile, 'entity-tools', server)?.tools?.map((t) => t.name), profile).toContain(
        'describe_entity_type',
      );
    }
  });
});
