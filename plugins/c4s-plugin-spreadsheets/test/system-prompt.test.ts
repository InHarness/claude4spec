/**
 * The two facts about this type's prompt contribution that nothing else holds.
 *
 * 0.2.50 moved `<tooling>` off `mcpToolsLine` and onto the mounted server set,
 * which quietly stranded the growth rule: it was the one RULE living in a slot
 * that had become a pure manifest, so after #171 it reached no prompt at all.
 * It now lives in `narrativeBlock`, and this file is what keeps it there.
 *
 * The second test is why the move was not just a relocation. `mcpToolsLine` is
 * parsed as `server: tool, tool` by `entityReadMcpTools` (chat-context.ts),
 * which builds the `spec-explore` subagent's tool allow-list. This type's line
 * was the only prose paragraph in the repo, so that parse produced a server
 * named "Tools under `spreadsheet-tools`" and tool names carrying their own
 * parenthetical descriptions — entries no server could ever answer to.
 */

import { describe, expect, it } from 'vitest';
import { spreadsheetSystemPrompt } from '../src/entity/spreadsheet/system-prompt.js';
import { subagentsFor } from '../../../src/server/services/chat-context.js';
import type { ProjectPluginHost } from '../../../src/server/core/plugin-host/types.js';

const hostWithSpreadsheet = {
  listEntities: () => [{ systemPrompt: spreadsheetSystemPrompt }],
} as unknown as ProjectPluginHost;

describe('spreadsheet system prompt (0.2.50)', () => {
  it('states the growth rule in the narrative block, where a prompt still reads it', () => {
    const narrative = spreadsheetSystemPrompt.narrativeBlock ?? '';
    expect(narrative).toMatch(/REFUSED/);
    expect(narrative).toMatch(/nRows/);
    // The remedy, not one phrasing of it: an insert, or the generic update tool.
    expect(narrative).toMatch(/insert/i);
    expect(narrative).toMatch(/update tool/i);
  });

  it('declares its tools as `server: tool, tool`, so the allow-list parse yields real names', () => {
    const tools = subagentsFor('chat', hostWithSpreadsheet, true)[0].tools ?? [];
    const fromThisType = tools.filter((t) => t.includes('spreadsheet'));
    expect(fromThisType).toEqual([
      'mcp__spreadsheet-tools__get_overview',
      'mcp__spreadsheet-tools__get_range',
    ]);
    // The general form of the rule: an MCP tool reference carries no prose.
    for (const t of tools) {
      expect({ t, wellFormed: /^[A-Za-z][\w-]*(__[A-Za-z][\w-]*)*$/.test(t) || !t.startsWith('mcp__') }).toEqual({
        t,
        wellFormed: true,
      });
    }
  });
});
