/**
 * `@inharness-ai/claude4spec/plugin-runtime` — the PUBLISHED Host API type
 * surface for plugin authors (brief 0.1.85→0.1.86).
 *
 * This is the official, host-owned mirror of the contract a plugin's code
 * compiles against. It replaces the per-plugin vendored `c4s-runtime.d.ts`
 * ambient fallback: the host now ships these declarations so plugin authors
 * reference them instead of hand-copying. The value transport is unchanged —
 * at runtime a plugin's `import "@c4s/plugin-runtime"` still resolves to the
 * M33 import-map shim; these types are that contract's compile-time mirror.
 *
 * Two channels compose:
 *   - top-level exports here type the subpath `@inharness-ai/claude4spec/plugin-runtime`;
 *   - the ambient `declare module '@c4s/plugin-runtime'` in `./ambient.d.ts` binds
 *     the runtime value specifier to this same surface.
 *
 * SINGLE SOURCE OF TRUTH. The dep-free contract (manifest / EntityModule) is
 * RE-EXPORTED from its canonical host modules, so it cannot drift (a change to
 * the real interface flows through automatically; `published-surface.test.ts`
 * additionally asserts structural parity). The server- and client-coupled slots
 * (mount context, serializer, render props, runtime singletons) are declared
 * here with intentionally-loose external types: their real types pull host
 * internals (express Router, better-sqlite3 Database, the Tiptap registry) that
 * are NOT part of the contract and must not leak into the published surface
 * (AC2). This mirrors how the host itself types them `unknown` and narrows
 * internally.
 *
 * `hostApiVersion` is NOT bumped by publishing these types — `tsc` erases types
 * from emitted JS, so the alias-path argument that blocks publishing runtime
 * VALUES does not apply to declarations (brief "Version semantics").
 */

import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
// Import-then-export the dep-free contract so the names are usable locally
// (e.g. `FrontendModule extends EntityModuleManifest`) AND re-exported as the
// published surface. A bare `export … from` would not create a local binding.
import type {
  EntityModuleManifest,
  SystemPromptContribution,
} from '../shared/plugin-host/types.js';
import type { ValidatorFailure, ValidatorKind } from '../shared/plugin-host/named-validators.js';

// ── L11/L1 contract — dep-free, re-exported from the canonical host modules ──
// These are the interfaces the brief names as "the contract's home"; keeping
// them as live re-exports is what makes the emitted surface a faithful mirror.
export { HOST_API_VERSION } from '../shared/plugin-host/manifest.js';
export type {
  PluginManifest,
  PluginEngines,
  EntityContribution,
  // 0.2.19 (M37): the fifth manifest slot's shape. `WritingStyleContribution`
  // stays exported beside it — it is sugar, not a deprecation.
  PluginSkillContribution,
  WritingStyleContribution,
  // 0.2.66 (M37): the four interaction types, promoted from an inline union at
  // two use sites to a named contract type. A plugin author needs it to type
  // `contextTypes` on either a skill or a subagent contribution.
  ContextType,
  // 0.2.57 (M33/M05): the subagent slot's shape. It has been in the dictionary
  // since 0.2.53 but never reached this surface — an omission, not a policy:
  // without it a plugin author cannot type `contributes.subagents[]` at all.
  PluginSubagentContribution,
  PluginSettingField,
  PluginSettingsModule,
  PluginCommandContribution,
} from '../shared/plugin-host/manifest.js';
export type { EntityModuleManifest, SystemPromptContribution };

// ── L1 — the LOGICAL SCHEMA a type declares (Host API 2.0.0) ──
// `SqlMigration` and `backend.migrations` are gone: a type declares `data.schema`
// and the host generates the SQLite projection from it. Re-exported from the
// shared bundle rather than re-declared, so a plugin author and the generator
// read one definition.
export type {
  AccessHint,
  CollectionNode,
  DefaultPredicate,
  DataDeclaration,
  EnumNode,
  FieldFlags,
  FieldNode,
  FieldNormalization,
  IntegrityConstraint,
  ObjectNode,
  RecordNode,
  ScalarNode,
} from '../shared/plugin-host/data-schema.js';
export type { SlugPattern, SlugStep } from '../shared/plugin-host/slug-pattern.js';
export type { ValidatorKind, ValidatorFailure } from '../shared/plugin-host/named-validators.js';

// ── Backend mount context ──
// Host-provided dependencies are loosely typed: the real types (express Router,
// better-sqlite3 Database, the cross-cutting *Service classes) live deep in the
// host and are NOT part of the published contract. Loose shapes let a plugin's
// `mount(ctx)` body call host methods without casts.
export interface MountContext {
  app: any;
  /**
   * 2.0.0 (A.8) — `db` was REMOVED. A raw better-sqlite3 handle let a plugin
   * write a row the host never validated, in a shape its own `data.schema` does
   * not describe. `reader` is the read half (read-only by construction) and
   * `crud` is the host's declarative write path — the SAME one `/api/{type}s`
   * uses, so a plugin's own route and the generated router cannot disagree
   * about what a write means.
   *
   * `crud` carries `create` / `update` / `delete` of a whole entity, plus
   * `writeCollectionWindow(type, slug, field, entries, actor)` and
   * `mutateCollectionAxis(type, slug, field, axisKey, op, at, actor)` for a
   * KEYED collection. Use the window write for a cell or a range: `update`
   * reconciles a supplied keyed collection replace-all, so it is the wrong
   * verb for a grid. An entry with an empty payload deletes that key.
   */
  reader: any;
  crud: any;
  host: any;
  /**
   * 0.2.24 — the M39 read core, for a plugin that needs to READ an entity of a
   * type other than its own. A thunk: mounting runs before the core exists, so
   * call it at tool-call time, not at mount time.
   *
   * Reach reads through THIS, never through the host's serialization engine.
   * The core is the one read path every transport shares; the engine under it
   * is host-internal and held to a single caller.
   */
  discovery(): any;
  cwd: string;
  ws: { broadcast(msg: unknown): void };
  tagsService: any;
  versionService: any;
  referencesService: any;
  entityStore: any;
  registerMcpServer(name: string, factory: () => unknown): void;
  registerEntityService(type: string, service: unknown): void;
  /** 0.2.2 — `synthesizeMount` uses this to bind the listener generated from the type's `ref` flags. */
  registerRenameListener(fn: (ev: EntityRenamedEvent) => void): void;
}
export type PluginMountFn = (ctx: MountContext) => void;

/** 0.2.2 — an entity changed slug. See `registerRenameListener`. */
export interface EntityRenamedEvent {
  type: string;
  oldSlug: string;
  newSlug: string;
}

// ── M13 — generic entity-tools backend contract (declarative `backend.service`/
// `backend.crud` slots). A plugin implements this interface directly; the
// host-internal `BaseEntityCrudService` abstract base (default list/search over
// a derived index) is not part of the published surface — it is an in-process
// convenience for host-owned entities, not a contract plugin authors depend on.
export interface EntityCrudService<T = unknown> {
  create(data: unknown): { slug: string; warnings?: string[] } | Promise<{ slug: string; warnings?: string[] }>;
  get(slug: string): T | null;
  /** `data` may carry an explicit `newSlug` field to rename — not a separate parameter. */
  update(
    slug: string,
    data: unknown,
  ): { slug: string; warnings?: string[] } | Promise<{ slug: string; warnings?: string[] }>;
  delete(slug: string): void;
  list(opts: {
    tags?: string[];
    tagFilter?: 'and' | 'or';
    limit: number;
    offset: number;
  }): { items: T[]; total: number };
  // 0.2.4 — there is NO `search` slot, and no `backend.crud.searchableFields`
  // to go with it. Both were removed, not deprecated: search scope has exactly
  // one source, the text paths of `data.schema`, and a type cannot narrow,
  // re-weight or opt out of it. Declaring either one now fails to compile,
  // which is the intended signal — a silently-never-invoked `search()` was the
  // failure mode this removal exists to prevent.
}

// ── M13/L11 — MCP builder facade (0.1.133) ──
// A plugin that contributes a CUSTOM MCP server (the `backend.mcpServer` slot,
// for a type's non-CRUD tools) builds it by calling `createMcpServer`/`mcpTool`
// RE-EXPORTED from `@c4s/plugin-runtime` — NEVER by importing the vendor
// `@inharness-ai/agent-adapters` directly. These are C4S-owned FACADE signatures:
// the vendor is an internal host dependency hidden behind them, so its config
// shapes (`McpServerConfig`, `McpServerInstance`) are deliberately NOT part of
// this published surface, and a vendor version bump does not bump
// `hostApiVersion` as long as the facade shape below is preserved (see the
// versioning rule in `shared/plugin-host/manifest.ts`).
//
// BACKEND-ONLY VALUES. `createMcpServer` / `mcpTool` are server-side values
// consumed by a plugin's `backend.*` code; they run only in the host process. A
// plugin's FRONTEND (browser) module must NOT import them — the import-map shim
// that resolves `@c4s/plugin-runtime` in the browser serves only the client
// value surface (`PLUGIN_RUNTIME_EXPORT_NAMES`), so a browser import of these
// names fails to resolve at load time even though it type-checks against this
// shared surface (same as the backend types `MountContext` / `EntityCrudService`
// above, which a frontend module also must not depend on).
//
// `createMcpServer` / `mcpTool` are runtime VALUES; `declare`-d here so the
// emitted `.d.ts` carries the contract while `tsc` erases any implementation
// (the values ship from the backend barrel `server/plugin-runtime/index.ts`).

// A private brand makes `McpServerFactory` nominally opaque: a plugin cannot
// fabricate one structurally (an empty `interface {}` would be assignable from
// any value) — the ONLY way to obtain it is calling `createMcpServer(...)`.
declare const mcpServerFactoryBrand: unique symbol;
/**
 * Opaque, C4S-owned handle for a custom MCP server — the RESULT of
 * `createMcpServer(...)`, and the return type of the `backend.mcpServer` slot.
 * Nominally opaque to the plugin author (NOT `ReturnType<typeof createMcpServer>`
 * of the vendor, NOT a `() => instance` thunk): the host lowers it to the vendor
 * representation at `adapter.execute({ mcpServers })` and rebuilds a fresh server
 * per turn behind the facade.
 */
export interface McpServerFactory {
  /** @internal opaque brand — only `createMcpServer` produces this handle. */
  readonly [mcpServerFactoryBrand]: 'McpServerFactory';
}
/** Facade alias for one MCP tool — the real tool shape is a vendor detail behind the facade. */
export type McpTool = unknown;
/**
 * Loose mirror of zod's `ZodRawShape` — `zod` is a shared peer the plugin
 * already resolves at runtime, so the precise type is not pinned into this
 * published surface.
 */
export type ZodRawShape = Record<string, unknown>;
export declare function createMcpServer(def: { name: string; tools: McpTool[] }): McpServerFactory;
export declare function mcpTool(
  name: string,
  description: string,
  zodShape: ZodRawShape,
  handler: (input: unknown) => unknown,
): McpTool;

/**
 * The error a plugin's backend code throws to produce a structured host
 * response. A backend-only VALUE, like the MCP builders above.
 *
 * It must be THIS class, not a local one with the same shape. The host narrows
 * with `instanceof` — in the MCP `create_entities`/`update_entities` error
 * mapper and in the global Express error handler — and class identity is
 * nominal, not structural. A plugin that declares its own `DomainError`
 * type-checks everywhere and still has every code it raises collapse to
 * `INTERNAL` with a 500, which is how the caller learns that a slug conflict
 * (409) was a server crash.
 *
 * `code` is a free-form string; the host maps the codes it knows
 * (`NOT_FOUND` → 404, `SLUG_CONFLICT` → 409, `VALIDATION` → 400) and treats the
 * rest as 400.
 */
export declare class DomainError extends Error {
  constructor(code: string, message: string);
  code: string;
}

// 0.2.27 — the named-validator registry behind the `kind` value constraint.
//
// BACKEND-ONLY VALUES, published for ONE caller shape: a `payloadUpgrades` step
// migrating files onto a field that has just gained a validator. Such a step must
// decide whether a stored value passes, and it must refuse rather than repair when
// it does not — so it needs the host's rule, not a transcription of it. A plugin
// carrying its own copy of the identifier pattern or the reserved-word list drifts
// from the host on the first keyword the host adds, which is the whole reason the
// registry is the host's in the first place.
//
// The declaration side needs nothing from here: a type says
// `kind: 'sql-identifier'` in `data.schema` and the host does the enforcing.
export declare function checkValidator(kind: ValidatorKind, value: string): ValidatorFailure | null;
export declare function validatorMessage(
  kind: ValidatorKind,
  failure: ValidatorFailure,
  value: string,
): string;

// 0.2.27 — the UTF-8 byte count behind every `contentBearing` descriptor. A type
// overriding `diff` while declaring a content-bearing field must report the same
// numbers the read descriptors advertise; `.length` counts UTF-16 units and would
// disagree on the first non-ASCII character.
export declare function contentBytes(value: unknown): number;

// zod facade (0.1.134→next). A plugin's backend schema code (the `backend.crud`
// create/update schemas, a custom `backend.mcpServer`'s `mcpTool` shapes) MUST build
// with the host's `z`, obtained here — NOT a bundled `import { z } from 'zod'`. The
// host introspects those schemas with `z.toJSONSchema()` (a zod v4 API that walks each
// node's internal `.def`); a schema built by a SECOND zod instance has no v4-shaped
// `.def` and the walker throws `Cannot read properties of undefined (reading 'def')`.
// Importing `z` from `@c4s/plugin-runtime` guarantees the single host instance (the
// alias resolves to the host's backend barrel, which re-exports the host's own `z`).
// The host is on **zod v4** — a plugin written against v3 backend-schema APIs may need
// adjustment once it shares this `z`.
//
// BACKEND-ONLY VALUE — same rule as `createMcpServer` / `mcpTool` above: a plugin's
// FRONTEND (browser) module must NOT import `z`. The browser import-map shim that
// resolves `@c4s/plugin-runtime` serves only the client value surface
// (`PLUGIN_RUNTIME_EXPORT_NAMES`), which does not include `z`, so a browser import
// fails to resolve at load time even though it type-checks against this shared surface.
//
// The type resolves to the AUTHOR's installed zod (`import('zod')`, a peer they already
// carry alongside `react` / `lucide-react` at the top of this file); keep it out of the
// `mcpTool` signature above (that stays the loose `ZodRawShape`) so the facade shape
// does not pin a zod version into the versioned surface.
export declare const z: typeof import('zod').z;

// ── L9 serializer ──
/**
 * 0.2.2 — the reader, named. Previously `unknown`, which meant a plugin could
 * not read its own rows without casting the whole context.
 *
 * `db` and `host` are the escape hatches a type owning AUXILIARY tables needs:
 * a junction or side index cannot be expressed through the generic single-row
 * read, and `getEntityService` is how its restore path reaches its own service.
 * Both are `any` for the usual reason — their real types are better-sqlite3 and
 * the host's own registry, neither of which belongs in this contract.
 */
export interface HostEntityReader {
  /**
   * The project database. Touch what your module declared; nothing else.
   *
   * 2.0.0 — a LEGACY escape hatch, and the last one. `MountContext.db` was
   * removed outright (item 8); this survives only because one read has no
   * generic equivalent yet: the REVERSE direction of a `ref` (which entities
   * point AT me), which `dto.detail` needs and the host does not expose. Every
   * other use has moved to `readCollection`/`getEntity` below. Do not add a
   * fourth caller — if you need one, the host is missing a primitive, and that
   * is the thing to fix.
   */
  db: any;
  /**
   * Items of a collection the type declared with `keyFields` — i.e. one that
   * projects to its own table instead of being embedded JSON on the row.
   *
   * Keyed by the FIELD names the declaration uses, never by the column names
   * the projection holds, so a `column:` remapping is invisible here. Answers
   * `[]` for an unknown type or an undeclared field.
   *
   * Note the boundary: a collection WITHOUT `keyFields` is embedded and is read
   * straight off `entity.data.<field>`. Calling this for one of those silently
   * answers `[]`, because there is no table to read.
   */
  readCollection(type: string, slug: string, field: string): unknown[];
  /** The project plugin host, when one was wired. */
  host?: {
    getEntity(type: string): unknown;
    getEntityService?(type: string): unknown;
  };
  getEntity(type: string, slug: string): unknown;
  // 0.2.24 — `findSectionReferences` is gone. It was the entity→sections half of
  // the retired `detail._references`, and it lost its last caller with that
  // field; the question is answered by `find_references({ target: 'entity' })`,
  // which reads the same junction and is a tool rather than a reader method.
}

/** 0.2.2 — the restore-path writer, named. See `HostEntityReader`. */
export interface HostEntityWriter {
  upsert(type: string, slug: string, input: unknown, actor: 'user' | 'agent', opts?: unknown): unknown;
  syncTags(type: string, slug: string, tags: string[]): void;
  delete(type: string, slug: string, actor: 'user' | 'agent'): unknown;
}

export interface RestoreContext {
  reader: HostEntityReader;
  writer: HostEntityWriter;
  releaseId: number | null;
  actor: 'user' | 'agent';
}
export interface RestoreResult<T = unknown> {
  op: 'created' | 'updated' | 'deleted' | 'noop';
  entity: T | null;
  warnings?: string[];
}
export type SnapshotData = unknown;
/**
 * Host API 2.0.0 — a type contributes a payload TIMELINE, and nothing else.
 *
 * The `views?` map is gone as of 0.2.23, and with it `ViewKind` / `ViewFn` /
 * `ViewSet`. The record a caller receives is derived by the host from
 * `data.schema` and narrowed by the caller's own `select`, so a type that
 * declared a view was describing a decision that is no longer its to make.
 * Presentation still belongs to the type — through the `frontend.render*` slots,
 * which are untouched.
 *
 * 0.2.24 — DECLARE THESE ON THE TYPE, not inside a `serializer` object. The
 * container is rejected at registration now.
 *
 * 0.2.31 removed `diff?`, the last slot here that was not the payload's
 * history. The semantic delta is generated by the host from `data.schema` and
 * the `collection: { kind: 'value', identity }` declarations on it. A manifest
 * still carrying a `diff` key is REJECTED at registration — not ignored, because
 * an honoured-looking function that nothing calls is worse than a load failure.
 *
 * ```ts
 * // before                          // now
 * serializer: {                      payloadVersion: 2,
 *   payloadVersion: 2,               payloadUpgrades: [toV2],
 *   payloadUpgrades: [toV2],
 *   diff: myDiff,                    // and, in data.schema:
 * },                                 // fields: { collection: { kind: 'value', identity: ['name'] }, … }
 * ```
 */
export interface SerializationContribution<T = unknown> {
  /**
   * The type's payload shape version. Declared on the MANIFEST, where it has
   * always been the authority — it is named here only so this interface
   * describes the whole contribution.
   */
  payloadVersion?: number;
  /** `payloadUpgrades[i]`: payload `i+1` → `i+2`. Enforced by the host on load and restore. */
  payloadUpgrades?: Array<(payload: SnapshotData) => SnapshotData>;
  // `snapshot` and `restore` are GONE — both are generated from `data.schema`.
  // A manifest that still declares either is rejected at registration rather
  // than having the slot ignored, because an ignored snapshot slot means the
  // host writes files in a shape the plugin's own code disagrees with.
}

// ── Frontend render props (L5/L8) ──
export interface EntityChipProps<T = unknown> {
  slug: string;
  /** The host injects the resolved entity; `null` ⇒ broken reference. */
  entity: T | null;
  onOpen?: () => void;
}
export interface EntityCardProps<T = unknown> extends EntityChipProps<T> {
  /**
   * 0.2.15 — the `caption` written on THIS `<single_element/>` reference.
   * Advisory prose belonging to the reference, not to the entity, so it is never
   * synced back and is absent whenever the tag omitted it.
   */
  caption?: string;
}
export interface EntityRowProps<T = unknown> {
  slug: string;
  entity: T;
  active?: boolean;
  onOpen?: () => void;
}
export interface EntityDetailProps {
  slug: string;
  onDeleted: () => void;
  onRenamed: (newSlug: string) => void;
  onBack: () => void;
}
export interface SidebarTabSlot {
  /** M33/0.1.121: `lucide-react` is a declared, externalized peer — the icon
   * resolves to it directly, not to a copy bundled inside the plugin. */
  icon: LucideIcon;
  label: string;
  order: number;
  emptyState?: ComponentType<unknown>;
}
export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  hint: string;
  pluginPopoverKind?: string;
}
export interface EditorExtensionRegistration {
  name: string;
  extension?: unknown;
  priority?: number;
  availableIn?: string[];
  slashCommand?: SlashCommand;
}

// ── Phase 3 — page-routing contract (M33) ──
// `AnyRoute` is loose here; the real type comes from `@tanstack/react-router`,
// a shared library peer resolved at runtime via the host import map.
export type AnyRoute = unknown;
export type RouteTreeFragment = (ctx: { rootRoute: AnyRoute }) => AnyRoute[];

export interface FrontendModule extends EntityModuleManifest {
  renderChip: ComponentType<EntityChipProps<unknown>>;
  renderCard: ComponentType<EntityCardProps<unknown>>;
  /**
   * Optional. Without it the type is not rendered by `<element_list/>` or
   * `<tagged_list/>` — unsupported by contract, not by accident.
   */
  renderRow?: ComponentType<EntityRowProps<unknown>>;
  /**
   * Optional, and bound to `routes`: declare BOTH or NEITHER. Neither = a
   * HIDDEN entity, reachable only through XML references on a page (chip, card)
   * and through the agent / MCP — no sidebar entry, no detail route.
   *
   * 0.2.16 — the mandatory minimum for any type is `renderChip` + `renderCard`.
   * Hidden-ness is not a flag: it is what omitting these two slots MEANS.
   */
  detailPanel?: ComponentType<EntityDetailProps>;
  /**
   * The read-only fullscreen surface a hidden type's chip and card open, since
   * there is no detail route to navigate to.
   *
   * Required exactly when the type is hidden, and rejected otherwise: a type
   * with a detail route must send its clicks to `bridge.openEntity`, and an
   * overlay beside that route would be a second answer to where a click goes.
   */
  renderOverlay?: ComponentType<{ slug: string; caption?: string; onClose: () => void }>;
  useGetBySlug: (slug: string | null) => {
    data: unknown | null | undefined;
    isLoading: boolean;
  };
  listByTags: (args: {
    tags: string[];
    filter: 'and' | 'or';
  }) => Promise<Array<{ slug: string }>>;
  sidebarTab?: SidebarTabSlot;
  editorExtensions?: EditorExtensionRegistration[];
  /**
   * Phase 3 — page routes this module owns (factory bound to the host root).
   * Bound to `detailPanel`: declare BOTH or NEITHER (0.2.16).
   */
  routes?: RouteTreeFragment;
}

export interface EditorBridge {
  openEntity: (type: string, slug: string) => void;
  openSection: (pagePath: string, anchor: string) => void;
}

/**
 * Supplies the bridge to everything rendered beneath it — and publishes it into
 * the process-wide singleton for the lifetime of the mount.
 *
 * A plugin that contributes page ROUTES must wrap any route body containing a
 * `DocEditor` (i.e. any entity detail with a rich-text field) in one of these.
 * `DocEditor` resolves the bridge from React context and falls back to a no-op
 * when there is none, so the failure is silent: entity chips inside the body
 * stop navigating, and since the fallback is also published to the singleton,
 * chips rendered outside the tree stop navigating while that page is mounted.
 */
export declare function EditorBridgeProvider(props: {
  bridge: EditorBridge;
  children: ReactNode;
}): ReactElement | null;

// ── Runtime value singletons (the L11 "Version surface") ──
// Declared (not implemented) so emit stays decoupled from the live client
// modules. `queryClient` is opaque on purpose — its real type is TanStack's
// `QueryClient`, a peer the plugin already shares via the import map.
export declare const clientPluginHost: {
  registerFrontendModule(module: FrontendModule): void;
  /**
   * 0.2.2 — a registered module's identity, by type, whether or not it is
   * active. Published because a plugin rendering a breadcrumb or a view switcher
   * for an entity needs that type's `label`/`pathPrefix`, and reaching it
   * through the index signature forces a cast on the FUNCTION — which unbinds
   * the receiver and throws at render, while type-checking cleanly.
   */
  getAvailable(type: string): EntityModuleManifest | null;
  /**
   * The ACTIVE module for a type, or null. Published alongside `getAvailable`
   * for the same reason and with the same warning about binding.
   *
   * Prefer this one for anything that NAVIGATES: a deactivated type has no
   * routes mounted, so linking to its `pathPrefix` lands on a not-found. The
   * host's own `navigateToEntity` reads `getEntity(type) ?? getAvailable(type)`,
   * and a plugin that owns routes needs the same two-step to resolve a chip
   * pointing at a type it knows nothing about.
   */
  getEntity(type: string): EntityModuleManifest | null;
  [key: string]: unknown;
};
export declare function registerFrontendModule(module: FrontendModule): void;
export declare const queryClient: unknown;
export declare const editorBridge: EditorBridge;
export declare function registerExtensionReferenceType(...args: unknown[]): void;

// ── M34/L11 frontend data-service singletons + hooks ──
// Each mirrors a backend service already carried in MountContext, bound to
// the shared `queryClient` above. Query/mutation return shapes are
// intentionally loose (not `UseQueryResult<T>`/`UseMutationResult<T>`) so
// this surface stays decoupled from a specific `@tanstack/react-query`
// version — plugins already get the real types via that shared peer.
export interface VersionListItem {
  version: number;
  changedBy: 'user' | 'agent';
  changeSummary: string | null;
  createdAt: string;
  releaseId?: number;
  op?: 'create' | 'update' | 'delete';
}
export interface VersionDetail extends VersionListItem {
  entityType: string;
  entitySlug: string;
  data: unknown;
}
export interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
  [key: string]: unknown;
}
export interface MutationLike<TVariables, TData> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  [key: string]: unknown;
}

export declare const versionService: {
  listVersions(type: string, slug: string): Promise<VersionListItem[]>;
  getVersion(type: string, slug: string, version: number): Promise<VersionDetail>;
  restore(type: string, slug: string, version: number): Promise<VersionListItem>;
};
export declare function useVersions(type: string, slug: string | null): QueryLike<VersionListItem[]>;
export declare function useVersionDetail(type: string, slug: string | null, version: number | null): QueryLike<VersionDetail>;
export declare function useRestoreVersion(): MutationLike<{ type: string; slug: string; version: number }, VersionListItem>;
/**
 * The semantic delta between two captured versions, GENERATED by the host from
 * the type's logical schema (0.2.31).
 *
 * It used to mirror the L9 `diff` slot and fall back to a JSON deep-diff in
 * `raw` when a type shipped none. Both are gone: there is no slot to mirror and
 * no second mode to fall back to, so this is the `EntityDiff` envelope plus the
 * identity of the row it describes. `changes` is the CLOSED eight-operation
 * dictionary — a consumer can switch over it exhaustively, for every entity
 * type at once.
 */
export type DiffOpKind =
  | 'field_changed'
  | 'field_changed_opaque'
  | 'item_added'
  | 'item_removed'
  | 'item_modified'
  | 'item_rekeyed'
  | 'tag_added'
  | 'tag_removed';

export type IdentityKey = Record<string, string | number | boolean>;

export type DiffOp =
  | { op: 'field_changed'; path: string; from: unknown; to: unknown }
  | { op: 'field_changed_opaque'; path: string; fromBytes: number; toBytes: number }
  | { op: 'item_added'; path: string; identity: IdentityKey; item: unknown }
  | { op: 'item_removed'; path: string; identity: IdentityKey; item: unknown }
  | { op: 'item_modified'; path: string; identity: IdentityKey; changes: DiffOp[] }
  | { op: 'item_rekeyed'; path: string; identity: IdentityKey; field: string; from: unknown; to: unknown }
  | { op: 'tag_added'; tag: string }
  | { op: 'tag_removed'; tag: string };

export interface VersionDiff {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'updated' | 'noop';
  changes: DiffOp[];
}
export declare function useVersionDiff(
  type: string,
  slug: string | null,
  fromId: number | null,
  toId: number | null
): QueryLike<VersionDiff>;

export interface TagListItem {
  slug: string;
  name: string;
  color: string | null;
  description: string | null;
  counts: Record<string, number>;
}
export declare const tagsService: {
  list(): Promise<TagListItem[]>;
  getEntityTagSlugs(type: string, slug: string): Promise<string[]>;
  assign(type: string, slug: string, tags: string[]): Promise<string[]>;
  remove(type: string, slug: string, tagSlug: string): Promise<string[]>;
  create(name: string): Promise<TagListItem>;
};
export declare function useTags(): QueryLike<TagListItem[]>;
export declare function useEntityTags(type: string, slug: string | null): QueryLike<string[]>;
export declare function useAssignTags(): MutationLike<{ type: string; slug: string; tags: string[] }, string[]>;
export declare function useRemoveEntityTag(): MutationLike<{ type: string; slug: string; tagSlug: string }, string[]>;
export declare function useCreateTag(): MutationLike<string, TagListItem>;

export interface ReferenceHit {
  /** Which root the referencing page lives in. */
  rootId: string;
  pagePath: string;
  tagType: string;
  line: number;
  raw: string;
}
export declare const referencesService: {
  findReferrers(type: string, slug: string): Promise<ReferenceHit[]>;
};
export declare function useReferences(type: string, slug: string | null): QueryLike<ReferenceHit[]>;

// ── M17/L11 releases (READ-ONLY) ──
// A narrow mirror of release LABELS. Plugins never create, update or assign
// releases — the write side stays behind the host's MCP / REST / UI, and the
// backend `releaseService` is not part of `MountContext`.
export interface Release {
  id: number;
  name: string;
  description: string;
  createdBy: 'user' | 'agent';
  createdAt: string;
}
export declare const releasesService: {
  listReleases(): Promise<Release[]>;
};
/** `releaseId → name`. A version with no release is simply absent from the map. */
export declare function useReleases(): Map<number, string>;

// ── M13/L11 line-diff util ──
/**
 * Textual line-diff over two entity version snapshots, in the PUBLIC Host UI
 * Kit vocabulary (`DiffView.hunks`) — never the host-internal
 * `{ op: 'keep'|'added'|'removed'; content }` shape. A pure function, not a
 * singleton. Distinct from `useVersionDiff`, which is the semantic delta from
 * the L9 serializer's `diff` slot; neither replaces the other.
 */
export declare function lineDiffHunks(
  before: unknown,
  after: unknown
): { op: 'add' | 'del' | 'ctx'; line: string }[];
