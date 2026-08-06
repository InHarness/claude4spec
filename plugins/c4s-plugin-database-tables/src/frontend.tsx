/**
 * Browser entry. The host fetches this bundle through its plugin-asset route and
 * imports it as native ESM; registration is a SIDE EFFECT of that import — there
 * is nothing to call and nothing named to read.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { databaseTableFrontendModule } from './entity/database-table/frontend/module.js';
import { mountDatabaseTableSlashCreate } from './entity/database-table/frontend/slash-create.js';

registerFrontendModule(databaseTableFrontendModule);

/*
 * The slash-create popover listens for its own `c4s:plugin-command` kind.
 *
 * `mountSlashCreatePopover` is idempotent per kind and keeps its live disposers
 * on `window`, so this is safe to run again — which it will be: a plugin reload
 * re-imports this entry with a cache-bust, in a fresh module graph, and the host
 * has no unmount hook to call in between. The new copy disposing the old one is
 * what keeps a reload from stacking listeners.
 */
mountDatabaseTableSlashCreate();
