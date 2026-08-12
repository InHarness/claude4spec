/**
 * Browser entry — fetched as native ESM through the host's plugin-asset route.
 *
 * Registration is an import SIDE EFFECT, matching the other envelopes: the host
 * boot loader imports this module and the two frontend modules are in the
 * registry by the time it returns.
 *
 * `mountSlashCreatePopover` must be idempotent per popover kind and keep its
 * disposers on `window`, because `reloadFrontendPlugins()` re-imports this entry
 * with a cache-bust into a FRESH module graph and there is no unmount hook to
 * pair with. A module-level guard would be a new one every reload, so each
 * reload would stack another listener and one `/uiview` would render N forms.
 * The kit handles that; this file only has to call it once per kind.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { designSystemFrontendModule } from './entity/design-system/frontend/module.js';
import { uiViewFrontendModule } from './entity/ui-view/frontend/module.js';
import { mountDesignSystemSlashCreate } from './entity/design-system/frontend/slash-create.js';
import { mountUiViewSlashCreate } from './entity/ui-view/frontend/slash-create.js';

registerFrontendModule(designSystemFrontendModule);
registerFrontendModule(uiViewFrontendModule);

mountDesignSystemSlashCreate();
mountUiViewSlashCreate();
