/**
 * Browser entry. The host fetches this bundle through its plugin-asset route and
 * imports it as native ESM; registration is a SIDE EFFECT of that import — there
 * is nothing to call and nothing named to read.
 *
 * Both types register here rather than in their own modules so the entry is the
 * one place that says what this package puts on screen.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { dtoFrontendModule } from './entity/dto/frontend/module.js';
import { endpointFrontendModule } from './entity/endpoint/frontend/module.js';
import { mountDtoSlashCreate } from './entity/dto/frontend/slash-create.js';
import { mountEndpointSlashCreate } from './entity/endpoint/frontend/slash-create.js';

// DTO first, matching the manifest's declaration order and the dependency
// direction. Registration order carries no meaning on the client — the host
// sorts by `displayOrder` — but the two files should read the same way.
registerFrontendModule(dtoFrontendModule);
registerFrontendModule(endpointFrontendModule);

// The slash-create popovers listen for their own `c4s:plugin-command` kind.
//
// `mountSlashCreatePopover` is idempotent per kind and keeps its live disposers
// on `window`, so this is safe to run again — which it will be: a plugin reload
// re-imports this entry with a cache-bust, in a fresh module graph, and the host
// has no unmount hook to call in between. The new copy disposing the old one is
// what keeps a reload from stacking listeners (and rendering one popover, and
// creating one entity, per reload since the page loaded).
mountDtoSlashCreate();
mountEndpointSlashCreate();
