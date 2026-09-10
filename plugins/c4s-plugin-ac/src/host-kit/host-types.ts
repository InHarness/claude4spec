/**
 * The slice of `MountContext` this envelope actually uses, declared
 * STRUCTURALLY.
 *
 * Same device `c4s-plugin-api-contracts` uses: the envelope names the shape it
 * depends on instead of importing the host's full interface, so what it needs is
 * legible in one screen and a widening of `MountContext` cannot silently become
 * a widening of this package's reach.
 *
 * Note what is NOT here: `reader` and `discovery`. Both exist on the real
 * context and both would hand back raw projection rows or the whole read
 * catalogue — the two things the plugin surface deliberately does not expose.
 * Leaving them off the local shape is what makes reaching for them a compile
 * error rather than a code-review question.
 */

import type {
  AgentTurnScope,
  DescribeTypesInput,
  DescribeTypesResult,
  GetEntitiesInput,
  GetEntitiesResult,
  GetFieldContentInput,
  GetFieldContentResult,
  ListEntitiesInput,
  ListEntitiesResult,
} from '@c4s/plugin-runtime';

/**
 * The four host questions the envelope asks about types it does not own.
 *
 * `describeTypes` cannot answer the first two: it throws `INVALID_TYPE` for an
 * unregistered type AND for a deactivated one, so `unknown` and `inactive`
 * collapse into one verdict. `ctx.host` keeps them apart, and the specification
 * names this channel for this envelope by name — the read core is for entity
 * SHAPES and RECORDS, `host.getAvailable` / `isActive` for whether a type is
 * there at all.
 */
/**
 * A projection row as the host's own reader shapes it. Mirrored structurally —
 * `c4s-plugin-frontend-mockups` carries the same four fields for the same
 * reason. It appears here ONLY as the type parameter of
 * `SerializationContribution`, which is a host-facing declaration; nothing in
 * this package ever holds one.
 */
export interface RawEntity {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
}

export interface HostRegistryView {
  getAvailable(type: string): unknown;
  isActive(type: string): boolean;
  entityExists(type: string, slug: string): boolean;
  getEntity(type: string): unknown;
}

/** The read operations this envelope binds, from the M39 plugin surface. */
export interface ReadOps {
  getEntities(input: GetEntitiesInput): GetEntitiesResult;
  listEntities(input: ListEntitiesInput): ListEntitiesResult;
  describeTypes(input?: DescribeTypesInput): DescribeTypesResult;
  getFieldContent(input: GetFieldContentInput): GetFieldContentResult;
}

export interface AcMountContext extends ReadOps {
  host: HostRegistryView;
  /** Project root — the working directory of the audit's adapter turn. */
  cwd: string;
  /** The turn's resolved scope. Host-owned; see `MountContext.agentScope`. */
  agentScope(opts?: { planMode?: boolean }): AgentTurnScope;
}
