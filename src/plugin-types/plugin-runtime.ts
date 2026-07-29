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

// ── L11/L1 contract — dep-free, re-exported from the canonical host modules ──
// These are the interfaces the brief names as "the contract's home"; keeping
// them as live re-exports is what makes the emitted surface a faithful mirror.
export { HOST_API_VERSION } from '../shared/plugin-host/manifest.js';
export type {
  PluginManifest,
  PluginEngines,
  EntityContribution,
  WritingStyleContribution,
  PluginSettingField,
  PluginSettingsModule,
  PluginCommandContribution,
  ReferenceTypeContribution,
} from '../shared/plugin-host/manifest.js';
export type { EntityModuleManifest, SystemPromptContribution };

// ── L1 — per-plugin SQL migrations (server `SqlMigration`) ──
export interface SqlMigration {
  version: number;
  name: string;
  /** Idempotent SQL — must tolerate replay. */
  up: string;
}

// ── Backend mount context ──
// Host-provided dependencies are loosely typed: the real types (express Router,
// better-sqlite3 Database, the cross-cutting *Service classes) live deep in the
// host and are NOT part of the published contract. Loose shapes let a plugin's
// `mount(ctx)` body call host methods without casts.
export interface MountContext {
  app: any;
  db: any;
  host: any;
  cwd: string;
  ws: { broadcast(msg: unknown): void };
  tagsService: any;
  versionService: any;
  referencesService: any;
  entityStore: any;
  registerMcpServer(name: string, factory: () => unknown): void;
  registerEntityService(type: string, service: unknown): void;
  /** 0.2.2 — see `backend.onEntityRenamed`; `synthesizeMount` uses this to bind it. */
  registerRenameListener(fn: (ev: EntityRenamedEvent) => void): void;
}
export type PluginMountFn = (ctx: MountContext) => void;

/** 0.2.2 — an entity changed slug. See `backend.onEntityRenamed`. */
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
  search?(query: string, opts: { limit: number; offset: number }): { items: T[]; total: number };
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
  /** The project database. Touch what your module declared; nothing else. */
  db: any;
  /** The project plugin host, when one was wired. */
  host?: {
    getEntity(type: string): unknown;
    getEntityService?(type: string): unknown;
  };
  getEntity(type: string, slug: string): unknown;
  /** Page sections referencing this entity — `{anchor, pagePath, headingText, relation}`. */
  findSectionReferences(type: string, slug: string): unknown[];
}

/** 0.2.2 — the restore-path writer, named. See `HostEntityReader`. */
export interface HostEntityWriter {
  upsert(type: string, slug: string, input: unknown, actor: 'user' | 'agent', opts?: unknown): unknown;
  syncTags(type: string, slug: string, tags: string[]): void;
  delete(type: string, slug: string, actor: 'user' | 'agent'): unknown;
}

export interface SerializeContext {
  reader: HostEntityReader;
  depth: number;
  maxDepth: number;
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
export interface EntityDiff {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  changes?: Record<string, unknown>;
}
export type SnapshotData = unknown;
export interface EntitySerializer<T = unknown> {
  type: string;
  version: string;
  inlineMention?: (entity: T, ctx: SerializeContext) => unknown;
  singleElement?: (entity: T, ctx: SerializeContext) => unknown;
  elementListItem?: (entity: T, ctx: SerializeContext) => unknown;
  taggedListItem?: (entity: T, ctx: SerializeContext) => unknown;
  detail?: (entity: T, ctx: SerializeContext) => unknown;
  snapshot?: (entity: T, ctx: SerializeContext) => SnapshotData;
  restore?: (data: SnapshotData, ctx: RestoreContext) => RestoreResult;
  diff?: (a: SnapshotData, b: SnapshotData, slug: string) => EntityDiff;
}

// ── Frontend render props (L5/L8) ──
export interface EntityChipProps<T = unknown> {
  slug: string;
  /** The host injects the resolved entity; `null` ⇒ broken reference. */
  entity: T | null;
  onOpen?: () => void;
}
export interface EntityCardProps<T = unknown> extends EntityChipProps<T> {}
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
  renderRow: ComponentType<EntityRowProps<unknown>>;
  detailPanel: ComponentType<EntityDetailProps>;
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
  /** Phase 3 — page routes this module owns (factory bound to the host root). */
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
 * M13/M34: computed diff between two captured versions, via the L9
 * `EntitySerializer.diff` slot (falls back to a JSON deep-diff, surfaced in
 * `raw`, when the plugin's serializer provides no `diff`). Distinct from the
 * narrower `EntityDiff` above (that one is what a plugin's own `diff()`
 * returns; this is what the host hands back to the client either way).
 */
export interface VersionDiff {
  type: string;
  slug: string;
  op: 'created' | 'deleted' | 'modified' | 'noop';
  changes?: Record<string, unknown>;
  raw?: { added: Record<string, unknown>; removed: Record<string, unknown>; changed: Record<string, unknown> };
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
