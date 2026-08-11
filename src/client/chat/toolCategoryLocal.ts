import { toolCategory as baseCategory } from '@inharness-ai/agent-chat';
import type { ToolCategory } from '@inharness-ai/agent-chat';

export type LocalToolCategory =
  | ToolCategory
  | 'mcp-entity'
  | 'mcp-reference'
  | 'mcp-plan';

export function localToolCategory(toolName: string | undefined): LocalToolCategory {
  // A block whose `toolName` never made it through the wire is a bug elsewhere,
  // but it must degrade to a dull label — not to `undefined.startsWith(...)`,
  // which unmounts the entire chat overlay to the catch boundary.
  if (typeof toolName !== 'string' || toolName === '') return 'other';
  // M13: CRUD for every entity type is now one generic server, parametrized by
  // `input.type` — replaces the old per-type mcp-endpoint/mcp-dto/mcp-database
  // categories. Surviving custom servers (endpoint-tools, ac-tools,
  // diagram-tools — non-CRUD tools only) fall through to the generic 'other'
  // bucket, same as before.
  if (toolName.startsWith('mcp__entity-tools__')) return 'mcp-entity';
  if (toolName.startsWith('mcp__reference-tools__')) return 'mcp-reference';
  if (toolName.startsWith('mcp__plan-tools__')) return 'mcp-plan';
  return baseCategory(toolName);
}
