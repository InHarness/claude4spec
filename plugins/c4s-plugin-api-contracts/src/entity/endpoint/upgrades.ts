import type { SnapshotData } from '@c4s/plugin-runtime';

/**
 * `endpoint` payload v1 → v2 — the repo's first real payload migration.
 *
 * v1 was written by a hand-written `snapshot()` that had drifted from the type's
 * own declaration in two ways, both invisible until the host started generating
 * the payload from that declaration:
 *
 *   - it spelled the junction in COLUMN names (`linked_dtos`, `dto_slug`,
 *     `status_code`) while the schema declares `linkedDtos` / `dto` /
 *     `statusCode`. A snapshot is keyed by what the type declared — the restore
 *     path hands the payload straight to a field-keyed writer — so the column
 *     spelling had to go. Reproducing it generically would have meant a THIRD
 *     naming concept on the manifest, permanently encoding a legacy spelling.
 *   - it coerced an empty `summary` to `null` (`((x as string) ?? '') || null`)
 *     against a declaration that says `required, default: ''`. The type
 *     contradicted itself and the file recorded the contradiction.
 *
 * Both legacy spellings are handled here, including the pre-M17 `dtos[]` shape
 * that used to live in `coerceEndpoint`'s defensive branch. That branch belongs
 * here rather than in `diff`: it is a shape migration, and shape migrations now
 * have exactly one home.
 */
export function endpointPayloadV1ToV2(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };

  const legacy =
    (Array.isArray(p.linked_dtos) ? (p.linked_dtos as Array<Record<string, unknown>>) : null) ??
    // Pre-M17: the junction was emitted as the view's `dtos[]`, carrying
    // `dtoSlug`/`statusCode` and a resolved `dtoName` that was never content.
    (Array.isArray(p.dtos) ? (p.dtos as Array<Record<string, unknown>>) : null);

  if (legacy) {
    p.linkedDtos = legacy.map((l) => ({
      dto: String(l.dto ?? l.dto_slug ?? l.dtoSlug ?? ''),
      relation: String(l.relation ?? ''),
      statusCode: (l.statusCode ?? l.status_code ?? null) as number | null,
    }));
  } else if (!Array.isArray(p.linkedDtos)) {
    // An endpoint with no links at all: the v1 file still carried the key as
    // `[]`, and dropping it here would make the collection read as absent.
    p.linkedDtos = [];
  }
  delete p.linked_dtos;
  delete p.dtos;

  // The declaration's own answer, applied to the value the declaration was
  // being contradicted about.
  if (p.summary === null || p.summary === undefined) p.summary = '';

  return p;
}

/**
 * v2 → v3: the endpoint gains the reserved `title`.
 *
 * `title := "{method} {path}"` — the same string four renderers used to build
 * for themselves, now stored once. `method` and `path` stay: they are how a
 * route is addressed and filtered, and the title is a label over them, not a
 * replacement for them.
 *
 * The slug is unaffected. `slugify("GET /api/users/:id")` and the retired
 * `{method}-{slugify(path)}` produce the same string, so nothing re-slugs.
 *
 * Idempotent: a payload already carrying a title is returned untouched.
 */
export function endpointPayloadV2ToV3(payload: SnapshotData): SnapshotData {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = { ...(payload as Record<string, unknown>) };
  if (typeof p.title === 'string' && p.title.trim() !== '') return p;
  p.title = `${String(p.method ?? '')} ${String(p.path ?? '')}`.trim();
  return p;
}
