/**
 * 2.1.26 — the shared matcher between a `spec-operation` record and the L3
 * catalog row that is its counterpart. A record is passed in the fields the row
 * carries: `nazwa`, `mediacja`, the four channel cells (an `n/a` / `via` carrying
 * the record's `powody` entry verbatim), `efekty`, `idempotencja`, `opisTresci`,
 * `kodyBledow` and `narzedzia` as mcp-tool slugs per agentic channel. The tool
 * slugs resolve to `<server>.<tool>` through the caller's mcp-tool records.
 */

import { expect } from 'vitest';
import { CATALOG, type ChannelCell, type OperationDeclaration } from '../../src/server/operations/catalog.js';
import { registerCoreOperations } from '../../src/server/operations/core-operations.js';
import type { WriteToolRecord } from './write-tool-records.js';

export interface OperationRecord {
  nazwa: string;
  /** Defaults to `project`. */
  zasieg?: 'project' | 'workspace';
  /** Defaults to `direct`. */
  mediacja?: 'direct' | 'agent-mediated' | 'human-mediated';
  channels: Record<'internal' | 'cli' | 'mcp' | 'rest', ChannelCell>;
  efekty: string[];
  idempotencja: boolean | 'conditional';
  opisTresci: 'literal' | 'literal+diff' | 'n/a' | undefined;
  kodyBledow: string[];
  narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
}

/**
 * The registered declaration matches its record: name, the record's scope
 * (`project` unless it says `workspace`), the
 * record's mediation, the four channel cells, effects, idempotence, content
 * input, exactly the record's codes (each once), and `renderings` exactly its
 * `narzedzia` — each named mcp-tool record resolved through `toolRecords`; an
 * agentic `direct` cell names at least one rendering and an `n/a` / `via` cell
 * names none.
 */
export function expectOperationMatchesRecord(
  record: OperationRecord,
  toolRecords: Record<string, Pick<WriteToolRecord, 'server' | 'name'>>,
): OperationDeclaration {
  registerCoreOperations();
  const op = CATALOG.require(record.nazwa);
  expect(op.name).toBe(record.nazwa);
  expect(op.scope).toBe(record.zasieg ?? 'project');
  expect(op.mediation).toBe(record.mediacja ?? 'direct');
  for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) {
    expect(op.channels[channel], `${record.nazwa}.${channel}`).toEqual(record.channels[channel]);
  }
  expect([...op.sideEffects].sort()).toEqual([...record.efekty].sort());
  expect(op.idempotent).toBe(record.idempotencja);
  expect(op.contentInput).toBe(record.opisTresci);
  expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
  expect([...op.errorCodes].sort()).toEqual([...record.kodyBledow].sort());
  const expected: Partial<Record<'internal' | 'mcp', string[]>> = {};
  for (const [channel, slugs] of Object.entries(record.narzedzia) as Array<['internal' | 'mcp', string[]]>) {
    expected[channel] = slugs.map((slug) => {
      const tool = toolRecords[slug];
      expect(tool, slug).toBeDefined();
      return `${tool!.server}.${tool!.name}`;
    });
  }
  expect(op.renderings ?? {}).toEqual(expected);
  for (const channel of ['internal', 'mcp'] as const) {
    const named = op.renderings?.[channel] ?? [];
    if (op.channels[channel].kind === 'direct') expect(named.length, `${record.nazwa}.${channel}`).toBeGreaterThan(0);
    else expect(named, `${record.nazwa}.${channel}`).toEqual([]);
  }
  return op;
}
