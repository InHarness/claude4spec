/**
 * 2.1.11 — the release read operations, ONE function per catalog row.
 *
 * `release_list`, `release_show` and `release_diff` used to be computed inside
 * the MCP adapter (`mcp/release-tools/index.ts`): filter validation, windows,
 * projection and the response budget lived there, and REST answered only the raw
 * L2 shape. That made the payload a property of one channel. Here it is a
 * property of the OPERATION: the MCP tool, the REST routes with `view=operation`
 * and the `c4s release-*` commands (through those routes) all call these
 * functions with the operation's own parameters, so the three channels cannot
 * disagree about a filter, a window or a hint.
 *
 * The functions take the MCP input schema's parameters verbatim; a channel only
 * translates its own transport (query keys, flags) into them.
 */

import { DomainError } from './tags.js';
import { splitPageKey, type ReleaseService } from './release.js';
import { CURRENT_RELEASE_NAME, type Release } from '../../shared/entities.js';
import type { Root } from '../../shared/types.js';
import {
  DEFAULT_PAGE_LIMIT,
  projectReleaseDiff,
  projectSpecSnapshot,
} from '../mcp/release-tools/projection.js';
import type {
  EntityTypeFilter,
  IncludeFilter,
  MCPReleaseDiff,
  MCPSpecSnapshot,
} from '../mcp/release-tools/types.js';

export interface ReleaseOperationDeps {
  releaseService: ReleaseService;
  /**
   * 2.1.8: the project's PAGE roots (`kind: pages`) — the only roots a
   * `roots`/`paths` filter may name. Any other id (unknown, or a system root
   * such as `plans`/`entities`) is refused with this list.
   */
  roots: () => ReadonlyArray<Pick<Root, 'id'>>;
}

/**
 * The literals that name STATES rather than releases. `current` is HEAD and is
 * legal only on the right side of a diff; `initial` and `null` are the empty
 * state and are legal only on the left side.
 */
export const INITIAL_RELEASE_LITERAL = 'initial';
export const NULL_RELEASE_LITERAL = 'null';

/**
 * A release reference as the channels hand it in. The MCP tools still accept a
 * numeric id (name-only addressing of the MCP inputs is a separate change);
 * REST and CLI only ever send strings.
 */
export type ReleaseRef = string | number;

export const INCLUDE_VALUES = ['pages', 'entities'] as const;
export const DEFAULT_INCLUDE: IncludeFilter[] = ['pages', 'entities'];

export interface ReleaseListParams {
  limit?: number;
  offset?: number;
}

export interface ReleaseShowParams {
  releaseName: ReleaseRef;
  include?: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
  limit?: number;
  offset?: number;
}

export interface ReleaseDiffParams {
  fromReleaseName: ReleaseRef | null;
  toReleaseName: ReleaseRef;
  include?: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
  slugs?: string[];
  roots?: string[];
  paths?: string[];
  summaryOnly?: boolean;
  limit?: number;
  offset?: number;
  sectionOffset?: number;
  sectionLimit?: number;
}

export function releaseListOperation(
  deps: ReleaseOperationDeps,
  params: ReleaseListParams,
): { releases: Release[]; total: number } {
  const { limit, offset } = resolvePagination(params.limit, params.offset);
  const all = deps.releaseService.listReleases();
  return { releases: all.slice(offset, offset + limit), total: all.length };
}

export function releaseShowOperation(
  deps: ReleaseOperationDeps,
  params: ReleaseShowParams,
): MCPSpecSnapshot {
  validateFilters(params.include, params.entityTypes);
  const { limit, offset } = resolvePagination(params.limit, params.offset);
  const include = params.include ?? DEFAULT_INCLUDE;
  const raw = deps.releaseService.getReleaseSnapshot(params.releaseName);
  return projectSpecSnapshot(raw, { include, entityTypes: params.entityTypes }, { limit, offset });
}

/**
 * `release_diff`, step by step:
 *   1. validation — pagination and the section window first (a negative value is
 *      a 400 even under `summaryOnly`), then every single-filter refusal, then
 *      the combinations, then the literals of both sides;
 *   2. literals — `initial` / `null` on the left, `current` on the right,
 *      otherwise a release; `from === to` is an empty diff;
 *   3. the delta — `getUnreleasedDiff` for `current`, `getReleaseDiff` otherwise;
 *   4–7. projection, `slugs` narrowing before `total`, windows, budget + hint
 *      (all inside `projectReleaseDiff`).
 */
export async function releaseDiffOperation(
  deps: ReleaseOperationDeps,
  params: ReleaseDiffParams,
): Promise<MCPReleaseDiff> {
  const { limit, offset } = resolvePagination(params.limit, params.offset);
  const { sectionOffset, sectionLimit } = resolveSectionWindow(params.sectionOffset, params.sectionLimit);
  const summaryOnly = params.summaryOnly === true;
  const { entityTypes, slugs, roots, paths } = params;
  validateDiffFilters(
    { include: params.include, entityTypes, slugs, roots, paths },
    deps.roots(),
    sectionOffset !== undefined || sectionLimit !== undefined,
  );
  const include = params.include ?? DEFAULT_INCLUDE;
  const { from, to } = resolveDiffRange(params.fromReleaseName, params.toReleaseName);

  // The reserved literal is settled BEFORE anything resolves a name. Resolve
  // first and a real release named `current` — which `createRelease` refuses, but
  // an older database or a hand-written row could still hold — would shadow the
  // literal and silently answer a historical diff to a caller asking about HEAD.
  // Two engines, ONE projection: only `to.id` (null) says which branch answered.
  const isCurrent = to === CURRENT_RELEASE_NAME;
  const raw = isCurrent
    ? await deps.releaseService.getUnreleasedDiff(from, { roots, paths })
    : await deps.releaseService.getReleaseDiff(from, to, { roots, paths });
  const toSnap = isCurrent
    ? deps.releaseService.getCurrentSnapshot()
    : deps.releaseService.getReleaseSnapshot(to);
  const fromSnap = from === null ? null : deps.releaseService.getReleaseSnapshot(from);

  return projectReleaseDiff(raw, fromSnap, toSnap, { include, entityTypes, slugs }, {
    summaryOnly,
    limit,
    offset,
    singlePath: paths?.length === 1,
    sectionOffset,
    sectionLimit,
  });
}

/**
 * The diff window's literal matrix. Every side-swapped literal is a 400
 * `INVALID_DIFF_RANGE` — never a 404, because the caller named a STATE, just on
 * the wrong side — and so is "from nothing to HEAD": the initial brief is a claim
 * about a frozen pair, and that pairing would answer it with whatever is on disk.
 * The whole current state is `release_show`'s job.
 */
export function resolveDiffRange(
  fromReleaseName: ReleaseRef | null,
  toReleaseName: ReleaseRef,
): { from: ReleaseRef | null; to: ReleaseRef } {
  const from =
    fromReleaseName === null || fromReleaseName === NULL_RELEASE_LITERAL || fromReleaseName === INITIAL_RELEASE_LITERAL
      ? null
      : fromReleaseName;
  if (from === CURRENT_RELEASE_NAME) {
    throw new DomainError(
      'INVALID_DIFF_RANGE',
      'fromReleaseName: "current" is not a diff start — `current` (HEAD) is legal only as toReleaseName',
    );
  }
  if (toReleaseName === INITIAL_RELEASE_LITERAL || toReleaseName === NULL_RELEASE_LITERAL) {
    throw new DomainError(
      'INVALID_DIFF_RANGE',
      `toReleaseName: "${toReleaseName}" is not a diff end — the empty state is legal only as fromReleaseName`,
    );
  }
  if (from === null && toReleaseName === CURRENT_RELEASE_NAME) {
    throw new DomainError(
      'INVALID_DIFF_RANGE',
      'the empty state cannot be combined with toReleaseName: "current" — read the whole current state with release_show',
    );
  }
  return { from, to: toReleaseName };
}

const DEFAULT_OFFSET = 0;

/**
 * `limit`/`offset` of the operation window. Negative values are a loud 400
 * `INVALID_PAGINATION` (no silent clamp). The schemas keep these loose
 * (`z.number()`) so negatives reach this check rather than failing as a generic
 * schema error.
 */
export function resolvePagination(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const l = typeof limit === 'number' ? limit : DEFAULT_PAGE_LIMIT;
  const o = typeof offset === 'number' ? offset : DEFAULT_OFFSET;
  if (l < 0 || o < 0) {
    throw new DomainError('INVALID_PAGINATION', 'limit and offset must be >= 0');
  }
  return { limit: l, offset: o };
}

/**
 * 2.1.5 — `release_diff`'s section window, checked with `limit`/`offset` and for
 * the same reason: a negative value is a 400 even under `summaryOnly: true`,
 * which then ignores the window. Absent stays absent — the projection tells "no
 * window" (the page whole) from an explicit one.
 */
export function resolveSectionWindow(
  sectionOffset: unknown,
  sectionLimit: unknown,
): { sectionOffset?: number; sectionLimit?: number } {
  const o = typeof sectionOffset === 'number' ? sectionOffset : undefined;
  const l = typeof sectionLimit === 'number' ? sectionLimit : undefined;
  if ((o !== undefined && o < 0) || (l !== undefined && l < 0)) {
    throw new DomainError('INVALID_PAGINATION', 'sectionOffset and sectionLimit must be >= 0');
  }
  return { ...(o !== undefined ? { sectionOffset: o } : {}), ...(l !== undefined ? { sectionLimit: l } : {}) };
}

function validateFilters(include: IncludeFilter[] | undefined, entityTypes: EntityTypeFilter[] | undefined): void {
  if (include !== undefined && include.length === 0) {
    throw new DomainError('INVALID_INCLUDE_FILTER', 'include must not be an empty array');
  }
  if (entityTypes !== undefined && entityTypes.length === 0) {
    throw new DomainError('INVALID_ENTITY_TYPES_FILTER', 'entityTypes must not be an empty array');
  }
  if (entityTypes !== undefined && !(include ?? DEFAULT_INCLUDE).includes('entities')) {
    throw new DomainError('CONFLICTING_FILTERS', "entityTypes filter requires 'entities' in include");
  }
}

interface DiffFilters {
  include?: IncludeFilter[];
  entityTypes?: EntityTypeFilter[];
  slugs?: string[];
  roots?: string[];
  paths?: string[];
}

/**
 * 2.1.8 (M17 m17errtx1): the `roots` filter refusal, shared by every channel of
 * `release_diff` (MCP, REST `view=operation`, `c4s release-diff`) and by the raw
 * REST release diff (`GET /api/releases/:from/diff/:to?roots=`), so they all
 * answer with one contract: an unknown id or a root of a kind other than `pages`
 * is `INVALID_ROOTS_FILTER`, never silently skipped, and the message and hint
 * list the `kind: pages` roots.
 */
export function refuseNonPageRoots(roots: readonly string[], pageRootIds: readonly string[]): void {
  const notPage = roots.find((r) => !pageRootIds.includes(r));
  if (notPage === undefined) return;
  const available = `page roots: [${pageRootIds.join(', ')}]`;
  throw new DomainError('INVALID_ROOTS_FILTER', `roots: '${notPage}' is not a page root (${available})`, available);
}

/**
 * `release_diff`'s filter validation. 2.1.11 order: EVERY single-filter refusal
 * (`INVALID_*_FILTER`, root and path checks included) before ANY combination
 * refusal (`CONFLICTING_FILTERS`) — a caller told its filters conflict fixes the
 * combination and then trips over the filter that was malformed all along.
 * `roots` and `paths` REFUSE an id that is not a page root (2.1.8: unknown, or a
 * system root) instead of silently skipping it, and the refusal names the page
 * roots.
 */
function validateDiffFilters(
  { include, entityTypes, slugs, roots, paths }: DiffFilters,
  pageRoots: ReadonlyArray<Pick<Root, 'id'>>,
  sectionWindow: boolean,
): void {
  const pageRootIds = pageRoots.map((r) => r.id);
  const available = `page roots: [${pageRootIds.join(', ')}]`;
  const refuse = (code: string, message: string): never => {
    throw new DomainError(code, `${message} (${available})`, available);
  };
  const rootProblem = (id: string): string | null =>
    pageRootIds.includes(id) ? null : `'${id}' is not a page root`;

  // 1. Single filters.
  if (include !== undefined && include.length === 0) {
    throw new DomainError('INVALID_INCLUDE_FILTER', 'include must not be an empty array');
  }
  if (entityTypes !== undefined && entityTypes.length === 0) {
    throw new DomainError('INVALID_ENTITY_TYPES_FILTER', 'entityTypes must not be an empty array');
  }
  if (slugs !== undefined && (slugs.length === 0 || slugs.some((s) => s.length === 0))) {
    throw new DomainError(
      'INVALID_SLUGS_FILTER',
      slugs.length === 0 ? 'slugs must not be an empty array' : 'slugs must not contain an empty element',
    );
  }
  if (roots !== undefined && roots.length === 0) refuse('INVALID_ROOTS_FILTER', 'roots must not be an empty array');
  refuseNonPageRoots(roots ?? [], pageRootIds);
  if (paths !== undefined && paths.length === 0) refuse('INVALID_PATHS_FILTER', 'paths must not be an empty array');
  for (const key of paths ?? []) {
    const parsed = splitPageKey(key);
    if (!parsed) {
      refuse('INVALID_PATHS_FILTER', `paths: '${key}' has no root prefix — expected a page's full key <rootId>/<relPath>`);
    }
    const problem = rootProblem(parsed!.rootId);
    if (problem) refuse('INVALID_PATHS_FILTER', `paths: '${key}': ${problem}`);
  }

  // 2. Combinations.
  const effectiveInclude = include ?? DEFAULT_INCLUDE;
  if (entityTypes !== undefined && !effectiveInclude.includes('entities')) {
    throw new DomainError('CONFLICTING_FILTERS', "entityTypes filter requires 'entities' in include");
  }
  if (slugs !== undefined) {
    // An entity's identity in the delta is the PAIR type + slug, so a bare slug
    // means something only once exactly one type is named.
    if (!effectiveInclude.includes('entities')) {
      throw new DomainError('CONFLICTING_FILTERS', "slugs filter requires 'entities' in include");
    }
    if (entityTypes === undefined || entityTypes.length !== 1) {
      throw new DomainError(
        'CONFLICTING_FILTERS',
        'slugs filter requires exactly one element in entityTypes — an entity is identified by type + slug',
      );
    }
  }
  if (paths !== undefined && !effectiveInclude.includes('pages')) {
    throw new DomainError('CONFLICTING_FILTERS', "paths filter requires 'pages' in include");
  }
  if (paths !== undefined && roots !== undefined) {
    throw new DomainError('CONFLICTING_FILTERS', 'paths and roots are mutually exclusive — pass one of them');
  }
  // A silent ignore would answer a different query than the one asked.
  if (sectionWindow && paths?.length !== 1) {
    throw new DomainError(
      'CONFLICTING_FILTERS',
      'sectionOffset / sectionLimit address the sections of ONE page — pass exactly one element in paths',
    );
  }
}
