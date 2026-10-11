/**
 * M43 — the `explicit-addressing` rule, as code (2.1.13).
 *
 * An operation over an artifact addresses it EXPLICITLY, by a parameter, never
 * by channel state. A thread's binding to an artifact is a rendering of the
 * `internal` channel, not part of the operation contract: the internal
 * rendering takes the address from the thread, an external rendering requires
 * it outright. The rule binds an artifact read exactly as it binds a mutation.
 *
 * The SHAPE of the addressing parameter, per channel, is decided here and only
 * here:
 *
 *  - external channels (`cli`, `mcp`, `rest`) — `required`, whatever the kind
 *    declares about isolation;
 *  - `internal`, by default — `optional`, not absent: optionality protects the
 *    ergonomics of the internal channel, explicitness keeps the operation
 *    callable from outside;
 *  - `internal`, under the ISOLATION EXCEPTION — `absent`. The exception fires
 *    only when the module owning the artifact kind declares that a thread sees
 *    exclusively the artifact it is pinned to. Isolation is then carried by the
 *    ABSENCE of the parameter: an optional parameter would be a default, and a
 *    default does not isolate (the same reasoning as the connection posture's
 *    bind, which is a default of `project`, not a permission boundary — l3axes00).
 *
 * The binding matrix (M36, `artifact-registry.ts`) only SUPPLIES the address the
 * internal rendering uses; it carries no rule about the parameter's shape.
 */

import type { ZodRawShape, ZodTypeAny } from 'zod';
import type { ChannelName } from './catalog.js';
import type { ArtifactKind } from '../services/artifact-registry.js';

/** The rule's stable id — what a catalog row cites in its `reguły` cell. */
export const EXPLICIT_ADDRESSING_RULE = 'explicit-addressing' as const;

/** How an operation's addressing parameter appears in one channel's input schema. */
export type AddressingParamShape = 'required' | 'optional' | 'absent';

/**
 * The rule itself. `ownerDeclaresIsolation` is the owning module's declaration
 * that a thread sees only its pinned artifact; it matters to `internal` alone.
 */
export function addressingParamShape(channel: ChannelName, ownerDeclaresIsolation: boolean): AddressingParamShape {
  if (channel !== 'internal') return 'required';
  return ownerDeclaresIsolation ? 'absent' : 'optional';
}

/**
 * The owners' isolation declarations, per artifact kind — the switch of the
 * isolation exception. The value cites where the owning module makes the
 * declaration. A kind missing here has made NO declaration, and its internal
 * addressing parameter stays optional.
 *
 * Only an owning module may add its kind here (M10 plans, M21 briefs, M23
 * patches); M36 never does — its matrix supplies the address, not the shape.
 */
// ASSUMPTION:dev-0001 — `brief-tools` (internal) still renders no `path` although
// M21 makes no isolation declaration; it is not wired to this rule in 2.1.13 and
// left as shipped, pending the specification's answer.
export const OWNER_THREAD_ISOLATION: Readonly<Partial<Record<ArtifactKind, string>>> = {};

/** Does the owner of this kind declare thread isolation? */
export function ownerDeclaresThreadIsolation(
  kind: ArtifactKind,
  declarations: Readonly<Partial<Record<ArtifactKind, string>>> = OWNER_THREAD_ISOLATION,
): boolean {
  return typeof declarations[kind] === 'string' && declarations[kind] !== '';
}

/** The rule applied to an artifact kind: its owner's declaration plus the channel. */
export function artifactAddressingShape(
  kind: ArtifactKind,
  channel: ChannelName,
  declarations: Readonly<Partial<Record<ArtifactKind, string>>> = OWNER_THREAD_ISOLATION,
): AddressingParamShape {
  return addressingParamShape(channel, ownerDeclaresThreadIsolation(kind, declarations));
}

/**
 * Render the addressing parameter into a zod raw shape for one channel:
 * `{ [name]: schema }`, `{ [name]: schema.optional() }`, or `{}`. Spread it into
 * a tool's input shape so the rendering cannot disagree with the rule.
 */
export function addressingParam<T extends ZodTypeAny>(
  name: string,
  shape: AddressingParamShape,
  schema: T,
): ZodRawShape {
  switch (shape) {
    case 'required':
      return { [name]: schema };
    case 'optional':
      return { [name]: schema.optional() };
    case 'absent':
      return {};
  }
}
