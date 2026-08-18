import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  DESIGN_SYSTEM_DISPLAY_ORDER,
  DESIGN_SYSTEM_LABEL,
  DESIGN_SYSTEM_LABEL_PLURAL,
  DESIGN_SYSTEM_PATH_PREFIX,
  DESIGN_SYSTEM_TYPE,
} from '../../identity.js';
import { designSystemSerialization } from './serializer.js';
import { designSystemSystemPrompt } from './system-prompt.js';
import { designSystemData, designSystemSlugPattern } from './schema.js';
import { DesignSystemService } from './backend/service.js';

/**
 * The `design-system` contribution — `backend.service` only: the generated
 * `/api/design-systems` router still serves every CRUD verb from `data` below,
 * and there is no non-CRUD tool and no domain route for this type.
 *
 * The service slot arrived with the mockup document (0.2.28). It is NOT a CRUD
 * service — tier K deleted those — but the domain logic the host cannot derive
 * from `data.schema`: token `resolve()` and the CSS sheet built from it. Its
 * consumer is another TYPE's router (`ui-view`'s `/:slug/mockup`), reaching it
 * in-process through `getEntityService('design-system')`.
 *
 * It is listed FIRST in the manifest's `contributes.entities`, ahead of
 * `ui-view`, because `ui-view.designSystemSlug` declares `ref: 'design-system'`
 * and a fixed single-target ref needs its target present from the first
 * registration. That coupling is the whole reason the two types travel in one
 * envelope rather than two — see the built-in envelope registry in M13.
 *
 * `payloadVersion: 2` with a one-step `payloadUpgrades` chain on the serializer
 * (`designSystemPayloadV1ToV2`); the host enforces exactly `payloadVersion - 1`
 * steps at registration.
 */
export const designSystemEntity: EntityContribution = {
  type: DESIGN_SYSTEM_TYPE,
  data: designSystemData,
  slugPattern: designSystemSlugPattern,
  payloadVersion: 3,
  label: DESIGN_SYSTEM_LABEL,
  labelPlural: DESIGN_SYSTEM_LABEL_PLURAL,
  displayOrder: DESIGN_SYSTEM_DISPLAY_ORDER,
  pathPrefix: DESIGN_SYSTEM_PATH_PREFIX,
  ...designSystemSerialization,
  systemPrompt: designSystemSystemPrompt,
  backend: {
    // Stateless — the factory ignores its `MountContext`. Everything the two
    // methods need arrives as arguments, which is what keeps the same logic
    // usable from the browser (`renderCard`, the L5 preview) as plain imports.
    service: () => new DesignSystemService(),
  },
} as EntityContribution;
