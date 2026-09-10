import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  AC_DISPLAY_ORDER,
  AC_LABEL,
  AC_LABEL_PLURAL,
  AC_PATH_PREFIX,
  AC_TYPE,
} from '../../identity.js';
import { acSerialization } from './serializer.js';
import { acSystemPrompt } from './system-prompt.js';
import { acData, acSlugPattern } from './schema.js';
import { createAcToolsServer } from './backend/mcp.js';
import type { AcMountContext } from '../../host-kit/host-types.js';

/**
 * The `ac` contribution.
 *
 * The generated `/api/acs` router serves every CRUD verb from `data` below;
 * there is no `backend.routes` and no `backend.service`, because `AcService` was
 * deleted in tier K and nothing it held was CRUD-shaped. Of what it did hold,
 * `classifyVerifies` became a free function and the `status = 'active'` default
 * became `systemPrompt.defaultPredicate`, which applies to every transport at
 * once rather than to one service's list method.
 *
 * The server stays ONE-TOOL. `find_ac_conflicts` was considered and rejected:
 * AC↔AC comparison is quadratic and the narrowing that makes it affordable is a
 * judgement, not a filter over a schema field. That gap is closed by the
 * `ac-audit` subagent this envelope also contributes — which is precisely why
 * the two ship as one unit.
 *
 * No `dependsOn`. `verifies[].slug` carries `ref: '$type'`, a POLYMORPHIC ref
 * whose target type is whatever the sibling `type` field says, so there is no
 * one type that must be registered first. That is the same reason this envelope
 * is not the `ui-view` + `design-system` case: a fixed single-target ref binds
 * its target into the same envelope, and a polymorphic one binds nothing —
 * applying that rule here would put every type in one package.
 */
export const acEntity: EntityContribution = {
  type: AC_TYPE,
  data: acData,
  slugPattern: acSlugPattern,
  // 1 — initial; 2 — `title` lifted out of `text` as a derived label; 3 — `text`
  // and `description` collapsed back INTO `title`, which is now the criterion.
  payloadVersion: 3,
  // Slug is slugified prose, so two entities that start alike are two entities —
  // suffix rather than refuse. `diagram` left this group in 0.2.22: a repeated
  // diagram TITLE is now a hard conflict, because two diagrams meant to be one
  // is a worse outcome than a refusal. An AC is different — two criteria opening
  // with the same clause are ordinary.
  slugConflict: 'suffix',

  label: AC_LABEL,
  labelPlural: AC_LABEL_PLURAL,
  displayOrder: AC_DISPLAY_ORDER,
  pathPrefix: AC_PATH_PREFIX,
  ...acSerialization,
  systemPrompt: acSystemPrompt,
  backend: {
    /**
     * The context is passed WHOLE, narrowed only by the local type.
     *
     * `AcMountContext` names the four read operations, the registry view, the
     * project root and `agentScope` — and deliberately omits `reader` and
     * `discovery`, which the real `MountContext` still carries. Reaching for
     * either from this package is a compile error rather than a review comment.
     */
    mcpServer: (_service: unknown, ctx: MountContext) =>
      createAcToolsServer(ctx as unknown as AcMountContext),
  },
};
