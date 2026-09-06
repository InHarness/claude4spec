/**
 * Browser entry — NEW in 0.2.70, and its existence is the visible half of this
 * envelope's reclassification.
 *
 * Until this release the package had no frontend bundle at all, because it
 * contributed no entity type and so had nothing to render. The host discovers a
 * plugin's frontend by file existence, so adding this file is the whole
 * declaration; nothing anywhere says "this envelope now has a frontend".
 *
 * Registration is a SIDE EFFECT of the import — there is nothing to call and
 * nothing named to read.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { moduleDependencyFrontendModule } from './entity/module-dependency/frontend/module.js';

registerFrontendModule(moduleDependencyFrontendModule);
