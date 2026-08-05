import type { EntityContribution } from '@c4s/plugin-runtime';
import { DTO_DISPLAY_ORDER, DTO_PATH_PREFIX, DTO_TYPE } from '../../identity.js';
import { dtoSerializer } from './serializer.js';
import { dtoSystemPrompt } from './system-prompt.js';
import { dtoData, dtoSlugPattern } from './schema.js';

/**
 * The `dto` contribution — 2.0.0 tier K (item 57): NO `backend` block at all,
 * and no `backend/` directory left to hold one.
 *
 * The generated `/api/dtos` router serves every CRUD verb from `data` below; the
 * relation tools belong to `endpoint`. The one thing `DtoService` did that was
 * not CRUD was throw `EXAMPLE_NAME_CONFLICT` on two same-named examples inside a
 * DTO — a uniqueness rule invented on the write path, enforced nowhere else, and
 * capable of blocking a save the UI let the author compose. The examples block
 * stays; refusing the write does not.
 */
export const dtoEntity: EntityContribution = {
  type: DTO_TYPE,
  data: dtoData,
  slugPattern: dtoSlugPattern,
  payloadVersion: 1,
  label: 'DTO',
  labelPlural: 'DTOs',
  displayOrder: DTO_DISPLAY_ORDER,
  pathPrefix: DTO_PATH_PREFIX,
  serializer: dtoSerializer,
  systemPrompt: dtoSystemPrompt,
} as EntityContribution;
