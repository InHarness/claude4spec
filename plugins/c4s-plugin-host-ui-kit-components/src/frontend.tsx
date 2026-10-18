/**
 * Browser entry — fetched as native ESM through the host's plugin-asset route.
 * Registration is an import side effect, as in the other envelopes.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { uiKitComponentFrontendModule } from './entity/ui-kit-component/frontend/module.js';

registerFrontendModule(uiKitComponentFrontendModule);
