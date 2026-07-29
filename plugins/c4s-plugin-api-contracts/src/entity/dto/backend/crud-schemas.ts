import { z } from 'zod';
import type { ZodRawShape } from 'zod';

const fieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
});

const exampleSchema = z.object({
  name: z.string().describe('Identifier unique within DTO (e.g. "minimal", "full", "edge-case")'),
  summary: z.string().optional(),
  value: z.unknown().describe('Payload as-is. Soft-validated against fields[] (warning only).'),
});

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const dtoCreateSchema: ZodRawShape = {
  name: z.string().describe('DTO name (PascalCase, e.g. UserResponse)'),
  description: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
  examples: z
    .array(exampleSchema)
    .optional()
    .describe('Named payload exemplars. Soft-validated. name unique within DTO.'),
  tags: z.array(z.string()).optional(),
};

/**
 * Declared explicitly (not the default `createSchema.partial()`) only because
 * `description` needs `.nullable()` here — an update may clear it with an
 * explicit `null`, which `createSchema`'s plain `.optional()` doesn't allow.
 * `newSlug` is NOT part of this shape — it's a sibling field on each
 * `update_entities` item (see entity-tools.ts), not nested in `data`.
 */
export const dtoUpdateSchema: ZodRawShape = {
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  fields: z.array(fieldSchema).optional(),
  examples: z
    .array(exampleSchema)
    .optional()
    .describe('Full replace of examples array (not diff). Omit to leave unchanged.'),
  tags: z.array(z.string()).optional(),
};
