import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  DATABASE_TABLE_ATTR_ORDER,
  DATABASE_TABLE_DISPLAY_ORDER,
  DATABASE_TABLE_LABEL,
  DATABASE_TABLE_LABEL_PLURAL,
  DATABASE_TABLE_PATH_PREFIX,
  DATABASE_TABLE_TYPE,
} from '../../identity.js';
import { databaseTableData, databaseTableSlugPattern } from './schema.js';
import { databaseTableSerializer } from './views.js';
import { databaseTableSystemPrompt } from './system-prompt.js';

/**
 * The `database-table` contribution — the port of
 * `c4s-plugin-simple-database-tables` / `c4s-plugin-database-tables` onto Host
 * API 2.x.
 *
 * WHAT IS NOT HERE is the substance of the port. No `table`, no `slugFrom`, no
 * `migrations`, no `service`, no `crud`, no `routes`, no `mcpServer`: the host
 * derives the projection from `data.schema`, the write path and its soft-FK
 * warnings from the `ref` flags, the create/update zod shapes (including the
 * identifier rule, via `pattern` + `notReserved`) from the same declaration,
 * snapshot/restore and the diff from the schema walk, rename repointing from
 * `ref` + `newSlug`, and `/api/database-tables` from `pathPrefix` + `data`.
 *
 * v1 wrote all of that by hand — two migrations, a 636-line service, a CRUD
 * adapter, a 196-line zod module, a 188-line router and a 345-line MCP server —
 * and none of it survives, because almost none of it was ever specific to
 * database tables. `deriveIndexName` and the three serializer views are what
 * genuinely were, and those came across.
 *
 * `payloadVersion: 1` — the FIRST version, not a new one, and that is the whole
 * adoption story. The file format is inherited unchanged: the `.json` files the
 * retired plugins wrote across six projects are read in place, never converted,
 * so there is no upgrade step and nothing to migrate from. (Registration
 * requires the field; `spreadsheet` is at 2 because its port genuinely did
 * change the payload — dense cells became sparse — and carries the upgrade to
 * prove it. Nothing of the sort happens here.)
 *
 * NO `slugConflict: 'suffix'`, unlike `spreadsheet`. Two sheets called
 * "Q1 report" is ordinary; two tables called `order_items` in one schema is a
 * mistake, and the hard `SLUG_CONFLICT` is the right answer to it.
 */
export const databaseTableEntity: EntityContribution = {
  type: DATABASE_TABLE_TYPE,
  data: databaseTableData,
  slugPattern: databaseTableSlugPattern,
  payloadVersion: 1,
  label: DATABASE_TABLE_LABEL,
  labelPlural: DATABASE_TABLE_LABEL_PLURAL,
  displayOrder: DATABASE_TABLE_DISPLAY_ORDER,
  pathPrefix: DATABASE_TABLE_PATH_PREFIX,
  serializer: databaseTableSerializer,
  systemPrompt: databaseTableSystemPrompt,
  frontend: {
    /**
     * `<database-table slug/>` in a page. `entityType` is injected from
     * `module.type` by the registry, so the tag gets broken-reference detection
     * in `check_consistency` for free.
     */
    referenceType: {
      tag: DATABASE_TABLE_TYPE,
      attrOrder: [...DATABASE_TABLE_ATTR_ORDER],
      validate: (attrs: Record<string, string>) => {
        const ok = typeof attrs.slug === 'string' && attrs.slug.trim().length > 0;
        return { ok, category: ok ? 'ok' : 'missing-slug' };
      },
    },
  },
} as EntityContribution;
