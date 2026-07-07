import { z } from 'zod';
import type { ZodRawShape } from 'zod';

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const acCreateSchema: ZodRawShape = {
  text: z.string().describe('Observable behavior the AC asserts. One sentence is best.'),
  kind: z
    .enum(['requirement', 'edge-case'])
    .optional()
    .describe('requirement (default) | edge-case'),
  status: z.enum(['active', 'deprecated']).optional(),
  verifies: z
    .array(z.object({ type: z.string(), slug: z.string() }))
    .optional()
    .describe('Entities this AC verifies. Reported broken if entity does not exist; not blocking.'),
  description: z.string().optional(),
  slug: z.string().optional().describe('Optional explicit slug; otherwise auto-generated.'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tag slugs. Convention: m07 for module M07, entity-dto for DTO entity, etc.'),
};

/**
 * Declared explicitly (not the default `createSchema.partial()`) only because
 * `description` needs `.nullable()` here — an update may clear it with an
 * explicit `null`, which `createSchema`'s plain `.optional()` doesn't allow.
 * `verifies` is a FULL REPLACE on update (not merged) — matches `updateRaw`'s
 * SQL, which always overwrites the stored `verifies` column wholesale.
 * `newSlug` is NOT part of this shape — it's a sibling field on each
 * `update_entities` item (see entity-tools.ts), not nested in `data`.
 */
export const acUpdateSchema: ZodRawShape = {
  text: z.string().optional(),
  kind: z.enum(['requirement', 'edge-case']).optional(),
  status: z.enum(['active', 'deprecated']).optional(),
  verifies: z.array(z.object({ type: z.string(), slug: z.string() })).optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
};
