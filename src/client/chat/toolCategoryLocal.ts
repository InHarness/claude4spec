import { toolCategory as baseCategory } from '@inharness-ai/agent-chat';
import type { ToolCategory } from '@inharness-ai/agent-chat';

export type LocalToolCategory =
  | ToolCategory
  | 'mcp-endpoint'
  | 'mcp-dto'
  | 'mcp-database'
  | 'mcp-reference'
  | 'mcp-plan';

export function localToolCategory(toolName: string): LocalToolCategory {
  if (toolName.startsWith('mcp__endpoint-tools__')) return 'mcp-endpoint';
  if (toolName.startsWith('mcp__dto-tools__')) return 'mcp-dto';
  if (toolName.startsWith('mcp__database-tools__')) return 'mcp-database';
  if (toolName.startsWith('mcp__reference-tools__')) return 'mcp-reference';
  if (toolName.startsWith('mcp__plan-tools__')) return 'mcp-plan';
  return baseCategory(toolName);
}
