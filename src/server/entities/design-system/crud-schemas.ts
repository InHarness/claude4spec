import { z } from 'zod';
import type { ZodRawShape } from 'zod';

const tokenValueSchema = z.union([z.string(), z.record(z.string(), z.string())]);

const tokenSchema = z.object({
  name: z.string().describe('Token name, unique within the design system'),
  type: z
    .string()
    .describe('TokenType (color|dimension|fontSize|...|typography|shadow). Best-effort, not hard-validated.'),
  value: tokenValueSchema.describe(
    'Literal ("#2563eb", "16px"), an alias "{token-name}", or a composite object (typography/shadow).'
  ),
  description: z.string().optional(),
});

const groupSchema = z.object({
  name: z.string(),
  tier: z.enum(['primitive', 'semantic']),
  tokens: z.array(tokenSchema),
});

const modeSchema = z.object({
  name: z.string(),
  overrides: z.array(z.object({ token: z.string(), value: tokenValueSchema })),
});

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const designSystemCreateSchema: ZodRawShape = {
  name: z.string().describe('Display name (e.g. "Brand 2026")'),
  description: z.string().optional(),
  groups: z.array(groupSchema).optional().describe('Token groups (default []).'),
  modes: z.array(modeSchema).optional().describe('Theme modes — token override sets (default []).'),
  slug: z.string().optional(),
  tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
};

/**
 * Declared explicitly (not the default `createSchema.partial()`) because the
 * old `update_design_system` MCP tool's `data` shape differs in two ways:
 * `description` is `.nullable()` here (an update may clear it with an
 * explicit `null`), and it carries neither `slug` nor `tags` (those were
 * never part of the agent-facing update surface). `newSlug` is NOT part of
 * this shape — it's a sibling field on each `update_entities` item (see
 * entity-tools.ts), not nested in `data`.
 */
export const designSystemUpdateSchema: ZodRawShape = {
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  groups: z.array(groupSchema).optional(),
  modes: z.array(modeSchema).optional(),
};
