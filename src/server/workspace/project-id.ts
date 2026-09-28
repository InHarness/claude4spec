import { createHash } from 'node:crypto';

/**
 * M31 #13 (2.1.0): `project-id` is readable, unique within a workspace and
 * immutable — minted ONCE at registration and stored in `ProjectRecord.id`.
 * It is the only address of a project: URL segment (`/p/<id>/`,
 * `/api/projects/<id>`), DB slot directory (`~/.claude4spec/<ws>/<id>/`),
 * WS room, browser-state key suffix, `--project <id>`, MCP `ask.project`.
 *
 * Form: transliterated to `[a-z0-9-]`, at most {@link PROJECT_ID_MAX} chars
 * (suffix included), empty → `project`. Implementation choices for what the
 * spec leaves open: every run of characters outside `[a-z0-9]` collapses to a
 * single `-`, leading/trailing `-` are trimmed, and the core is shortened so a
 * collision suffix (`-2`, `-3`, …) still fits the limit.
 */
export const PROJECT_ID_MAX = 48;
export const PROJECT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const FALLBACK_ID = 'project';

// NFKD strips most diacritics; these letters have no decomposition.
const TRANSLIT: Record<string, string> = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE' };

export function normalizeProjectId(raw: string): string {
  const ascii = raw
    .replace(/[łŁøØđĐßæÆœŒ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, PROJECT_ID_MAX).replace(/-+$/, '');
  return cut || FALLBACK_ID;
}

/**
 * First free id for `base` (already normalized or raw): `base`, `base-2`,
 * `base-3`… `taken` = ids of live records ∪ slot directory names in the
 * workspace (a detached project's slot keeps its id reserved).
 */
export function mintProjectId(base: string, taken: ReadonlySet<string>): string {
  const core = normalizeProjectId(base);
  if (!taken.has(core)) return core;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const head = core.slice(0, PROJECT_ID_MAX - suffix.length).replace(/-+$/, '') || FALLBACK_ID;
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The 2.0.0 identity, `sha1(cwd).slice(0,12)`. Kept ONLY for the one-way
 * registry migration and for recovering a legacy (pre-2.1.0) slot of a
 * detached project by its directory — never used to address a project.
 */
export function legacyHashId(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}
