import { z } from 'zod';
import type { ZodRawShape } from 'zod';

const paramSchema = z.object({
  name: z.string().describe('Parameter name (no `:` prefix)'),
  in: z.enum(['path', 'query', 'hash']).describe('Where the param lives'),
  type: z.string().optional().describe('Suggested value type (string|int|uuid|enum|...)'),
  required: z.boolean().optional(),
  default: z.string().optional(),
  description: z.string().optional(),
});

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const uiViewCreateSchema: ZodRawShape = {
  name: z.string().describe('Display name (e.g. "User Profile Screen")'),
  url: z
    .string()
    .nullable()
    .optional()
    .describe('Route pattern (e.g. "/users/:id"). Null/omitted = modal/drawer without routing.'),
  description: z.string().optional(),
  params: z.array(paramSchema).optional(),
  designSystemSlug: z
    .string()
    .nullable()
    .optional()
    .describe('Slug of a design-system this view uses (no FK; dangling allowed). Null = none.'),
  slug: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

/**
 * Declared explicitly (not the default `createSchema.partial()`) because
 * `description` needs `.nullable()` here (may clear it with an explicit
 * `null`, which `createSchema`'s plain `.optional()` doesn't allow), and
 * because `slug` (create-only, initial-slug override) must NOT be part of
 * the update shape — a rename goes through the sibling `newSlug` field on
 * each `update_entities` item (see entity-tools.ts), not nested in `data`.
 */
export const uiViewUpdateSchema: ZodRawShape = {
  name: z.string().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  params: z.array(paramSchema).optional(),
  designSystemSlug: z
    .string()
    .nullable()
    .optional()
    .describe('Set/clear the design-system reference. Null = detach. Omit = unchanged.'),
};
