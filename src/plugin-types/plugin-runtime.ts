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
  icon: ComponentType<{ className?: string; size?: number | string }>;
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
