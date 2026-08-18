import type { RawEntity } from '../../host-kit/host-types.js';
import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { DtoExample, DtoField } from '../../types.js';
import { dtoPayloadUpgrades } from './upgrades.js';

// ─── M17 Snapshot shape (entities/dto.md `dtosn0sho`) ───────────────────────

export interface DtoSnapshot {
  slug: string;
  title: string;
  description: string | null;
  fields: DtoField[];
  examples: DtoExample[];
  tags: string[];
}

/**
 * 0.2.23 — `dto` computes NOTHING.
 *
 * It kept two views until now: `inline_mention`, because `label`/`href` were a
 * rendering decision rather than fields, and `detail`, because it JOINED — the
 * endpoints referencing this DTO and the page sections mentioning it, neither of
 * which lives in `dto`'s own row.
 *
 * Both are gone. The chip's label is the reserved `title` and its `href` is
 * derived by the host from the manifest's `pathPrefix`, so the first view was
 * reproducing what the projection now produces for every type alike. The joins
 * went with it: `_references` because the page-scanning `find_references` (M19)
 * answers that question directly, and `endpoints` because the spec keeps the
 * endpoint↔DTO edge once, on the endpoint side, and describes no read surface
 * for the reverse direction. A patch is filed for the latter — the DTO detail
 * panel's "Used by endpoints" list has no specified operation behind it.
 */
/**
 * 0.2.24 — spread onto the type. The `serializer` wrapper is rejected now, and
 * `payloadVersion` is not echoed here: the manifest in `index.ts` declares it,
 * and it was always the only copy anything read.
 */
export const dtoSerialization = {
  payloadUpgrades: dtoPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;
