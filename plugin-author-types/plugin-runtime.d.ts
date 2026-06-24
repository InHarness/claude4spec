/**
 * Ambient type stub for `@c4s/plugin-runtime` — for runtime-plugin authors.
 *
 * `@c4s/plugin-runtime` is NOT an npm package: the host provides it to your
 * plugin at load time through an import map (the specifier resolves to the
 * host's already-loaded singletons — one shared plugin registry, QueryClient,
 * editor bridge and extension-reference registry). Because nothing is published
 * to npm, TypeScript in your (separate) plugin repo cannot find the module's
 * types and reports "Cannot find module '@c4s/plugin-runtime'".
 *
 * COPY this file into your plugin repo (anywhere `tsconfig` picks up `.d.ts`,
 * e.g. `types/`) so your plugin's frontend compiles. It declares types only and
 * ships no runtime code. It is a hand-maintained mirror of the host's real
 * surface (`src/client/runtime/plugin-runtime.ts`); the host MAY ship an updated
 * copy when the surface changes — re-copy after a Host API bump.
 *
 * The peers `react`, `react-dom`, `@tiptap/core`, `@tanstack/react-query` and
 * `lucide-react` are likewise host-provided; install them as devDependencies in
 * your plugin repo so their types resolve.
 */
declare module '@c4s/plugin-runtime' {
  import type { ComponentType } from 'react';
  import type { QueryClient } from '@tanstack/react-query';

  // --- Entity slot props (host-resolver contract) ---------------------------
  // The shared host `ChipResolver` fetches the entity and injects it; your slot
  // renders from props ONLY — no `useQuery`/`useGetBySlug`, no `useEditor()`.
  export interface EntityChipProps<T> {
    slug: string;
    /** Resolved entity, or `null` for a broken/missing reference. */
    entity: T | null;
    onOpen?: () => void;
  }
  export interface EntityCardProps<T> extends EntityChipProps<T> {}
  export interface EntityRowProps<T> {
    slug: string;
    /** Rows render only for resolved entities — never `null`. */
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

  // --- Module manifest ------------------------------------------------------
  export interface EntityModuleManifest {
    type: string;
    table: string;
    label: string;
    labelPlural: string;
    displayOrder: number;
    slugFrom: (data: unknown) => string;
    pathPrefix: string;
  }
  export interface SidebarTabSlot {
    icon: ComponentType<{ className?: string; size?: number | string }>;
    label: string;
    order: number;
    emptyState?: ComponentType<unknown>;
  }
  /** Opaque to plugins — built from the host's tiptap registration helpers. */
  export interface EditorExtensionRegistration {
    name: string;
    [key: string]: unknown;
  }

  export interface FrontendModule extends EntityModuleManifest {
    renderChip: ComponentType<EntityChipProps<unknown>>;
    renderCard: ComponentType<EntityCardProps<unknown>>;
    renderRow: ComponentType<EntityRowProps<unknown>>;
    detailPanel: ComponentType<EntityDetailProps>;
    useGetBySlug: (
      slug: string | null,
    ) => { data: unknown | null | undefined; isLoading: boolean };
    listByTags: (args: {
      tags: string[];
      filter: 'and' | 'or';
    }) => Promise<Array<{ slug: string }>>;
    sidebarTab?: SidebarTabSlot;
    editorExtensions?: EditorExtensionRegistration[];
  }

  // --- Editor bridge --------------------------------------------------------
  export interface EditorBridge {
    /** `type` is the entity-type discriminator (e.g. "endpoint"). */
    openEntity: (type: string, slug: string) => void;
    openSection: (pagePath: string, anchor: string) => void;
  }

  // --- Extension-reference registry -----------------------------------------
  export interface ExtensionReferenceValidateResult {
    ok: boolean;
    [key: string]: unknown;
  }
  export interface ExtensionReferenceType {
    tag: string;
    attrOrder: readonly string[];
    validate?: (attrs: Record<string, string>) => ExtensionReferenceValidateResult;
  }

  export interface ClientPluginHost {
    registerFrontendModule(module: FrontendModule): void;
    listAvailable(): FrontendModule[];
    listEntities(): FrontendModule[];
    getEntity(type: string): FrontendModule | null;
    getAvailable(type: string): FrontendModule | null;
    isActive(type: string): boolean;
  }

  // --- Live host singletons (shared, mutable) -------------------------------
  export const clientPluginHost: ClientPluginHost;
  export function registerFrontendModule(module: FrontendModule): void;
  export const queryClient: QueryClient;
  export const editorBridge: EditorBridge;
  export function registerExtensionReferenceType(spec: ExtensionReferenceType): void;

  /** Semver of the Host API this runtime implements (the loader gates on major). */
  export const HOST_API_VERSION: string;
}
