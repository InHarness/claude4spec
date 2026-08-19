/**
 * Browser entry. The host fetches this bundle through its plugin-asset route and
 * imports it as native ESM; registration is a SIDE EFFECT of that import - there
 * is nothing to call and nothing named to read.
 *
 * One line, where the other envelopes have two: there is no slash-create popover
 * to mount, because this package contributes no slash command. A tool is written
 * from the list screen, not in flight in prose.
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import { mcpToolFrontendModule } from './entity/mcp-tool/frontend/module.js';

registerFrontendModule(mcpToolFrontendModule);
