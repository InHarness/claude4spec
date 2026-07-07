import { z } from 'zod';
import type { ZodRawShape } from 'zod';

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const diagramCreateSchema: ZodRawShape = {
  source: z.string().optional().describe('DSL body (mermaid). May be empty (placeholder).'),
  format: z.enum(['mermaid', 'd2']).optional().describe("Diagram language (default 'mermaid')."),
  caption: z
    .string()
    .optional()
    .describe('Transient — seeds the slug only (slugify(caption)); NOT persisted on the entity.'),
  slug: z.string().optional().describe('Explicit slug; collisions get a -2/-3 suffix.'),
  tags: z.array(z.string()).optional().describe('Tag slugs; non-existent tags are auto-created.'),
};

/**
 * `newSlug` is NOT part of this shape — it's a sibling field on each
 * `update_entities` item (see entity-tools.ts), not nested in `data`.
 */
export const diagramUpdateSchema: ZodRawShape = {
  source: z.string().optional(),
  format: z.enum(['mermaid', 'd2']).optional(),
  tags: z.array(z.string()).optional(),
};
