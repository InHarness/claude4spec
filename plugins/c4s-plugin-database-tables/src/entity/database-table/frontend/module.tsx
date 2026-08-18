import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  DATABASE_TABLE_DISPLAY_ORDER,
  DATABASE_TABLE_LABEL,
  DATABASE_TABLE_LABEL_PLURAL,
  DATABASE_TABLE_PATH_PREFIX,
  DATABASE_TABLE_TYPE,
} from '../../../identity.js';
import { databaseTableData, databaseTableSlugPattern } from '../schema.js';
import { DatabaseTableIcon } from './icon.js';
import { DatabaseTableDetail } from './detail-panel.js';
import { databaseTableRoutes } from './routes.js';
import { databaseTablesApi } from './api.js';
import { useGetBySlug } from './hooks.js';
import { DatabaseTableChip } from './render-chip.js';
import { DatabaseTableCard } from './render-card.js';
import { DatabaseTableRow } from './render-row.js';

/**
 * The VISIBLE type's frontend module — the opposite of `spreadsheet`, which is
 * hidden by omitting exactly these two slots.
 *
 * `sidebarTab` + `routes` are what make this a first-class screen: a tab, a list,
 * a detail page and a deep-linkable history route. The retired plugin had all of
 * it, and full parity is the point of the port — a type nobody can open is not
 * restored.
 */
export const databaseTableFrontendModule: FrontendModule = {
  type: DATABASE_TABLE_TYPE,
  /**
   * THE SAME declaration the backend contribution carries, not a second copy.
   * The hand-inlined `slugFrom` this replaces was a mirror of the server's rule,
   * maintained by hand and free to drift from it — and it HAD drifted: its
   * `slugify` could not fold `ł`, so a Polish name slugified one way here and
   * another on the server.
   */
  data: databaseTableData,
  slugPattern: databaseTableSlugPattern,
  // Mirrors the backend contribution (`entity/database-table/index.ts`); the two
  // declaring different versions is how a frontend quietly reads a shape the
  // server no longer writes.
  payloadVersion: 3,
  label: DATABASE_TABLE_LABEL,
  labelPlural: DATABASE_TABLE_LABEL_PLURAL,
  displayOrder: DATABASE_TABLE_DISPLAY_ORDER,
  pathPrefix: DATABASE_TABLE_PATH_PREFIX,
  renderRow: DatabaseTableRow as FrontendModule['renderRow'],
  renderChip: DatabaseTableChip as FrontendModule['renderChip'],
  renderCard: DatabaseTableCard as FrontendModule['renderCard'],
  detailPanel: DatabaseTableDetail as FrontendModule['detailPanel'],
  useGetBySlug: ((slug: string | null) =>
    useGetBySlug(slug)) as unknown as FrontendModule['useGetBySlug'],
  listByTags: ({ tags, filter }) => databaseTablesApi.list({ tags, tagFilter: filter }),
  routes: databaseTableRoutes,
  // NO `editorExtensions` slash command. The manifest's `commands` contribution
  // is the one that works — it carries the `popoverKind` `invokeSlash`
  // dispatches on. A second entry here would carry none, and since the palette
  // filters by substring both would match `/database-table`, with THIS one
  // selected by default because frontend modules mount before plugin commands
  // register. Choosing it deletes the typed text and opens nothing. The retired
  // plugin declared both.
  sidebarTab: {
    icon: DatabaseTableIcon as unknown as NonNullable<FrontendModule['sidebarTab']>['icon'],
    label: DATABASE_TABLE_LABEL_PLURAL,
    order: DATABASE_TABLE_DISPLAY_ORDER,
  },
};
