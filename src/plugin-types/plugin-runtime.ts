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

import type { ComponentType } from 'react';
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
}
export type PluginMountFn = (ctx: MountContext) => void;

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

// ── L9 serializer ──
export interface SerializeContext {
  reader: unknown;
  depth: number;
  maxDepth: number;
}
export interface RestoreContext {
  reader: unknown;
  writer: unknown;
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

// ── Runtime value singletons (the L11 "Version surface") ──
// Declared (not implemented) so emit stays decoupled from the live client
// modules. `queryClient` is opaque on purpose — its real type is TanStack's
// `QueryClient`, a peer the plugin already shares via the import map.
export declare const clientPluginHost: {
  registerFrontendModule(module: FrontendModule): void;
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
