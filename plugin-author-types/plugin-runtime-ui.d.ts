/**
 * Ambient type stub for `@c4s/plugin-runtime/ui` — for runtime-plugin authors.
 *
 * The sibling subpath of `@c4s/plugin-runtime`. While the main specifier carries
 * the host's live, mutable singletons, this `/ui` subpath carries the host's
 * STABLE, purely-presentational component catalog (the Host UI Kit, M34/L12) plus
 * its token bridge. Like the main specifier it is host-provided via the import
 * map, not published to npm — so TypeScript in your plugin repo cannot find its
 * types on its own.
 *
 * COPY this file into your plugin repo alongside `plugin-runtime.d.ts`. Types
 * only; no runtime code. Hand-maintained mirror of `src/client/host-ui-kit`.
 *
 * Only the `Core (stable)` components below are part of the versioned
 * `hostApiVersion` surface — their prop shapes change only on a MAJOR Host API
 * bump. The kit also exports experimental components and a token bridge (listed
 * at the bottom); those may change without a major, so declare them yourself if
 * and when you use them.
 */
declare module '@c4s/plugin-runtime/ui' {
  import type { ComponentType, ReactNode } from 'react';
  import type { LucideIcon } from 'lucide-react';

  // --- Core (stable) — versioned hostApiVersion surface ---------------------

  /** One breadcrumb hop in the detail toolbar; the last (current) crumb omits onClick. */
  export interface DetailBreadcrumb {
    label: ReactNode;
    onClick?: () => void;
  }
  /** No `title` prop — the header is the last `breadcrumb` crumb. */
  export interface DetailPanelShellProps {
    breadcrumb: DetailBreadcrumb[];
    actions?: ReactNode;
    children: ReactNode;
  }
  export const DetailPanelShell: ComponentType<DetailPanelShellProps>;

  /** No `value` prop — the value is passed as `children` (any JSX). */
  export interface FieldRowProps {
    label: ReactNode;
    children: ReactNode;
    align?: 'center' | 'start';
  }
  export const FieldRow: ComponentType<FieldRowProps>;

  export interface FieldGridProps {
    children: ReactNode;
    /** Max content width in px; defaults to the host's 1000px detail body. */
    maxWidth?: number;
  }
  export const FieldGrid: ComponentType<FieldGridProps>;

  export interface EntityListHeaderProps {
    icon?: LucideIcon;
    title: string;
    /** Rendered as "N results" when provided. */
    count?: number;
    /** Search box state; omit to hide the search box. */
    search?: string;
    onSearchChange?: (q: string) => void;
    searchPlaceholder?: string;
    /** Filter slot, between search and actions. */
    filters?: ReactNode;
    /** Action slot (e.g. a create button), trailing edge. */
    actions?: ReactNode;
  }
  export const EntityListHeader: ComponentType<EntityListHeaderProps>;

  // --- Experimental (NOT versioned — props may change without a major) ------
  // Also exported by this module but intentionally left undeclared here; copy
  // their signatures from `src/client/host-ui-kit` if you adopt them:
  //   list/   : EntityListLayout, Pagination, EmptyState
  //   actions/: ActionButton, Badge, LoadingState
  //   form/   : FormField, InlineEditField
  //   tokens  : useHostTokens, readHostTokens, HOST_TOKEN_NAMES
}
