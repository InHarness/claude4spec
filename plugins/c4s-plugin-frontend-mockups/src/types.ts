/**
 * The domain types of the two entity types this package contributes, COPIED
 * VERBATIM from the host's `shared/entities.ts`.
 *
 * They live here because the types belong to whoever owns the entity. The host
 * keeps its own copies only for the generic shapes (`BrokenReference`,
 * `EntityType`) that are not specific to `ui-view` or `design-system`; those are
 * **re-declared** below rather than imported, because an extracted package
 * cannot reach into the host for a type.
 *
 * Nothing here validates. The generated zod at the router does that, from
 * `entity/<type>/schema.ts` — this file is the read-side contract only, and the
 * two must be kept in step by hand.
 */

/**
 * Widened to `string` for the same reason the host widened its own copy: a
 * union would enumerate the types this package happens to know about, and it
 * receives rows for every active type through the shared list/reference shapes.
 */
export type EntityType = string;

/** Generic — re-declared, not imported. Mirrors the host's `shared/entities.ts`. */
export interface BrokenReference {
  pagePath: string;
  tagType: string;
  line: number;
  slug?: string;
  type?: EntityType;
}

// --- UI View ---

export type UiViewParamLocation = 'path' | 'query' | 'hash';

export interface UiViewParam {
  name: string;
  in: UiViewParamLocation;
  type?: string;
  required?: boolean;
  default?: string;
  description?: string;
}

export interface UiView {
  slug: string;
  /** 0.2.22 — the reserved label, formerly `name`. `params[].name` is a parameter name and stays. */
  title: string;
  url: string | null;
  description: string | null;
  params: UiViewParam[];
  /** v0.1.59: structural (non-tag) relation to a design-system. NULL = none. Slug, no FK. */
  designSystemSlug: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UiViewCreateInput {
  title: string;
  url?: string | null;
  description?: string;
  params?: UiViewParam[];
  /** v0.1.59: slug of the referenced design-system (no FK). undefined/null = none. */
  designSystemSlug?: string | null;
  slug?: string;
  tags?: string[];
}

export interface UiViewUpdateInput {
  title?: string;
  url?: string | null;
  description?: string | null;
  params?: UiViewParam[];
  /** v0.1.59: undefined = unchanged; null = clear; string = set (dangling allowed). */
  designSystemSlug?: string | null;
  tags?: string[];
  newSlug?: string;
}

export interface UiViewListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UiViewDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
}

// --- v0.1.59: Design System ---

export type TokenTier = 'primitive' | 'semantic';

/** Best-effort vocabulary — the linter warns but never hard-validates `type`. */
export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'duration'
  | 'easing'
  | 'shadow'
  | 'opacity'
  | 'zIndex'
  | 'number'
  | 'string'
  | 'typography';

/** Token types whose `value` is a composite object (each field literal or `{alias}`). */
export const COMPOSITE_TOKEN_TYPES = ['typography', 'shadow'] as const;

/**
 * The character class a name must fall in to survive into the generated
 * stylesheet, where it becomes part of a CSS custom property name.
 *
 * It lives HERE rather than beside the generator because two layers have to
 * agree on it and they cannot import each other: the backend sheet generator
 * ENFORCES it (silently, dropping what fails), and the browser-side linter
 * WARNS about it before the author ever gets that far. Two copies of the same
 * regex would drift, and the drift would show up as a token that lints clean
 * and then vanishes from the sheet.
 *
 * Both layers apply it at the SAME three points — token name, composite field
 * key, mode name — and the granularity differs per point: a rejected field key
 * costs one declaration, a rejected token name costs the whole token, a
 * rejected mode name costs the whole mode block. `lintTokens` warns about all
 * three because the two expensive ones are the ones worth catching first.
 */
export const SAFE_CSS_NAME = /^[A-Za-z0-9_-]+$/;

/** Literal/alias string, or a composite object (typography/shadow). */
export type TokenValue = string | Record<string, string>;

export interface DesignToken {
  name: string;
  /** TokenType vocabulary, but typed loosely — linter is best-effort. */
  type: string;
  value: TokenValue;
  description?: string;
}

export interface TokenGroup {
  name: string;
  tier: TokenTier;
  tokens: DesignToken[];
}

export interface DesignModeOverride {
  token: string;
  value: TokenValue;
}

export interface DesignMode {
  name: string;
  overrides: DesignModeOverride[];
}

export interface DesignSystem {
  slug: string;
  /** 0.2.22 — the reserved label, formerly `name`. Token/group/mode names are unaffected. */
  title: string;
  description: string | null;
  groups: TokenGroup[];
  modes: DesignMode[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemCreateInput {
  title: string;
  description?: string;
  groups?: TokenGroup[];
  modes?: DesignMode[];
  /** Optional explicit slug — used by M17 restore to preserve identity. */
  slug?: string;
  tags?: string[];
}

export interface DesignSystemUpdateInput {
  title?: string;
  description?: string | null;
  /** Full replace of the array (not per-token patch). */
  groups?: TokenGroup[];
  /** Full replace of the array (not per-mode patch). */
  modes?: DesignMode[];
  tags?: string[];
  newSlug?: string;
}

export interface DesignSystemListQuery {
  tags?: string[];
  tagFilter?: 'and' | 'or';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DesignSystemDanglingUiView {
  slug: string;
}

export interface DesignSystemDeleteResult {
  deleted: true;
  brokenReferences: BrokenReference[];
  /** UI views whose `designSystemSlug` pointed at the deleted record (now dangling). */
  danglingUiViews: DesignSystemDanglingUiView[];
}

/** Resolved token value: literal string, resolved composite object, or the `unresolved` sentinel. */
export type ResolvedTokenValue = string | Record<string, string>;

/** Sentinel for an alias that cannot be resolved (cycle / missing target). Preview never crashes. */
export const UNRESOLVED_TOKEN = 'unresolved';
