/**
 * 2.1.26 — the `mcp-tool` records of the M23 patch tools, as the specification
 * states them at release 2.1.26: `transagent-tools · list_patches` (the internal
 * rendering of `list_patches`) and the two `patch-tools` tools of the patch
 * thread (`get_patch`, `mark_patch_applied`). Name, server, the description the
 * model reads, the declared parameters and the annotation hints. Copied from the
 * records, not from the code — the tests that read this file hold the registered
 * tools against it, through the shared `expectToolMatchesToolRecord` of
 * `write-tool-records.ts`, and resolve a `spec-operation` record's `narzedzia`
 * to `<server>.<tool>` through it.
 */

import { expect } from 'vitest';
import { CATALOG, type ChannelCell, type OperationDeclaration } from '../../src/server/operations/catalog.js';
import { registerCoreOperations } from '../../src/server/operations/core-operations.js';
import type { WriteToolRecord } from './write-tool-records.js';

export const PATCH_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  "transagent-tools-list-patches": {
    server: "transagent-tools",
    name: "list_patches",
    description:
      "List the patches of this specification — the set a patch series is planned from.\nOrdered by `created_at` ascending (ties by `path`; a patch without `created_at` comes last).\nFilter with `brief` (a brief path relative to the briefs root — only that brief's patches)\nand `applied` (`false` = not yet applied; a patch with no `applied` field counts as false).\nEach row: { path, title, brief, patchKind, applied, createdAt }; `path` is what\nrunTransagent({ contextType: 'patch', payload: { patchPath } }) takes. Paged: `limit` / `offset`,\nanswered with `total` and `hasMore`. Re-list with `applied: false` after each banka — a patch the\nbanka found already applied is flagged by it and drops out of that list.",
    params: [
      { name: "brief", type: "string", required: false, description:
          "Brief path relative to the briefs root (.claude4spec/briefs). Omit for every brief." },
      { name: "applied", type: "boolean", required: false, description:
          "Narrow to applied (true) or not yet applied (false). Omit for all." },
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "patch-tools-get-patch": {
    server: "patch-tools",
    name: "get_patch",
    description:
      "Read the patch this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the patch's content: the system prompt carries the patch's path and frontmatter, never its body. `path` is optional here: omit it and the patch of the current thread is resolved for you; that is the normal call. For a long patch, or when a response comes back truncated, read it in windows with `range`.",
    params: [
      { name: "path", type: "string", required: false, description:
          "Patch path relative to the patches directory. Omit to address the patch of the current thread." },
      { name: "range", type: "object", required: false, description:
          "Line window `{ start, end }`, 1-based and inclusive. Use it to read a long patch in parts or to fetch the rest after a truncated response. A `start` past the end of the file is refused with the file size." },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "patch-tools-mark-patch-applied": {
    server: "patch-tools",
    name: "mark_patch_applied",
    description:
      "Mark this thread's patch as applied to the specification. Call it as the LAST step, after the patch's findings are in the spec — it declares \"what this patch reported is now folded into the spec\". It is a declaration, not a computed fact: nothing verifies it against the pages or the version history. Reverting the flag is a user action in the UI; from here the value is always true.",
    params: [
      { name: "applied", type: "boolean", required: true, description:
          "Only `true` is accepted from the agent channel. Passing `false` is refused — unset the flag in the UI instead." },
      { name: "path", type: "string", required: false, description:
          "Patch path relative to the patches directory. Omit to address the patch of the current thread." },
    ],
  },
};

/**
 * A `spec-operation` record of M23 (`create-patch`, `get-patch`, `list-patches`,
 * `mark-patch-applied`) in the fields the catalog row carries: `nazwa`, the
 * four channel cells (an `n/a` / `via` carrying the record's `powody` entry
 * verbatim), `efekty`, `idempotencja`, `opisTresci`, `kodyBledow` and
 * `narzedzia` as mcp-tool slugs per channel. Scope `project` and mediation
 * `direct` hold for all four.
 */
export interface PatchOperationRecord {
  nazwa: string;
  channels: Record<'internal' | 'cli' | 'mcp' | 'rest', ChannelCell>;
  efekty: string[];
  idempotencja: boolean | 'conditional';
  opisTresci: 'literal' | 'literal+diff' | 'n/a' | undefined;
  kodyBledow: string[];
  narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
}

/**
 * The registered declaration matches its record: name, scope, mediation, the
 * four channel cells, effects, idempotence, content input, exactly the record's
 * codes (each once), and `renderings` exactly its `narzedzia` — each named
 * mcp-tool record resolved to `<server>.<tool>` through `PATCH_TOOL_RECORDS`.
 */
export function expectPatchOperationRecord(record: PatchOperationRecord): OperationDeclaration {
  registerCoreOperations();
  const op = CATALOG.require(record.nazwa);
  expect(op.name).toBe(record.nazwa);
  expect(op.scope).toBe('project');
  expect(op.mediation).toBe('direct');
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
      const tool = PATCH_TOOL_RECORDS[slug];
      expect(tool, slug).toBeDefined();
      return `${tool!.server}.${tool!.name}`;
    });
  }
  expect(op.renderings ?? {}).toEqual(expected);
  return op;
}
