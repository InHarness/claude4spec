import { z } from 'zod';
import type { ZodRawShape } from 'zod';

/** Declared to `backend.crud` — the generic `entity-tools` server validates against this. */
export const endpointCreateSchema: ZodRawShape = {
  method: z.string().describe('HTTP method: GET, POST, PUT, PATCH, DELETE'),
  path: z.string().describe('URL path, e.g. /api/users/:id'),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

/**
 * Declared explicitly (not the default `createSchema.partial()`) only because
 * `description` needs `.nullable()` here — an update may clear it with an
 * explicit `null`, which `createSchema`'s plain `.optional()` doesn't allow.
 * `newSlug` is NOT part of this shape — it's a sibling field on each
 * `update_entities` item (see entity-tools.ts), not nested in `data`.
 */
export const endpointUpdateSchema: ZodRawShape = {
  method: z.string().optional(),
  path: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
};
