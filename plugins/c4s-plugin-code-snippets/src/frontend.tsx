/**
 * Browser entry. The host fetches this bundle through its plugin-asset route and
 * imports it as native ESM; registration is a SIDE EFFECT of that import — there
 * is nothing to call and nothing named to read.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { codeSnippetFrontendModule } from './entity/code-snippet/frontend/module.js';
import { mountCodeSnippetSlashCreate } from './entity/code-snippet/frontend/slash-create.js';

registerFrontendModule(codeSnippetFrontendModule);

/*
 * The slash-create popover listens for its own `c4s:plugin-command` kind.
 *
 * Safe to run again on a plugin reload: the host re-imports this entry with a
 * cache-bust in a fresh module graph and offers no unmount hook in between, so
 * the new copy disposing the old one (keyed by popover kind, parked on `window`)
 * is what keeps listeners from stacking.
 */
mountCodeSnippetSlashCreate();
