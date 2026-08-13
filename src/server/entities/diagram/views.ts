import type { RawEntity } from '../../discovery/raw-entity-reader.js';
import { contentBytes } from '../../../shared/plugin-host/data-schema.js';
import { diagramPayloadUpgrades } from './upgrades.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '../../serialization/types.js';
import type { DiagramFormat } from '../../../shared/entities.js';

// ─── snapshot shape (committed file format) ─────────────────────────────────

export interface DiagramSnapshot {
  slug: string;
  title: string;
  format: DiagramFormat;
  /**
   * Literal DSL body, kept verbatim (no trim). May be empty.
   *
   * `contentBearing` since 0.2.22, and it STILL BELONGS HERE. The flag governs
   * reads, not writes: the snapshot is what the entity file contains and what a
   * release package carries, so excluding the body would make the file
   * unable to reproduce the entity — the one invariant the projection rests on.
   */
  source: string;
  tags: string[];
}

function readFormat(value: unknown): DiagramFormat {
  return value === 'd2' ? 'd2' : 'mermaid';
}

function readSource(value: unknown): string {
  // `source` is stored verbatim; coerce defensively (a JSON-shaped source could
  // be hydrated into a non-string by the generic reader — mermaid DSL never is).
  return typeof value === 'string' ? value : '';
}

// ─── view helpers ────────────────────────────────────────────────────────────

/**
 * The shape every diagram view starts from.
 *
 * `source` is NOT here any more. It used to be spread into `single_element` and
 * `detail`, which is precisely what `contentBearing` now forbids — and the field
 * does not need removing per view, because `project()` cuts it after
 * serialization on the strength of the schema flag. It is left out anyway, so
 * this file says the same thing the declaration does instead of relying on
 * something downstream to correct it.
 */
function baseSingle(entity: RawEntity) {
  return {
    type: 'diagram',
    slug: entity.slug,
    title: (entity.data.title as string) ?? entity.slug,
    format: readFormat(entity.data.format),
    tags: entity.tags,
  };
}

/**
 * 0.2.22 dropped `sourceLines`.
 *
 * It was a COMPUTED field on a list row — a measurement of a body the row did
 * not carry, invented by this type alone, in a system whose declared position is
 * that types compute no such thing. Its replacement, `sourceBytes`, comes from
 * the host's `contentBearing` rule and appears on every read of every
 * content-bearing field, spelled the same way for all of them.
 */
function trimItem(entity: RawEntity) {
  return baseSingle(entity);
}

// ─── snapshot / restore / diff ──────────────────────────────────────────────

function coerce(raw: unknown): DiagramSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? r.slug ?? ''),
    format: readFormat(r.format),
    source: readSource(r.source),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function diagramDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'diagram', slug, op: 'noop' };
  if (a == null) return { type: 'diagram', slug, op: 'created' };
  if (b == null) return { type: 'diagram', slug, op: 'deleted' };
  const sa = coerce(a);
  const sb = coerce(b);
  const changes: Record<string, unknown> = {};

  if (sa.title !== sb.title) changes.title_changed = { from: sa.title, to: sb.title };
  if (sa.format !== sb.format) changes.format_changed = { from: sa.format, to: sb.format };
  /**
   * A content-bearing field diffs by SIZE, not by value.
   *
   * `source_changed: true` said only that something moved. Two byte counts say
   * how much and in which direction, which is the most a reader can act on
   * without opening the bodies — and printing the bodies side by side is exactly
   * what the flag exists to stop. The shape is the host's default for every
   * content-bearing field, not a diagram-specific invention.
   */
  if (sa.source !== sb.source) {
    changes.source_changed = { fromBytes: contentBytes(sa.source), toBytes: contentBytes(sb.source) };
  }

  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'diagram', slug, op: 'noop' };
  return { type: 'diagram', slug, op: 'modified', changes };
}

export const diagramSerializer: SerializationContribution<RawEntity> = {
  payloadVersion: 2,
  payloadUpgrades: diagramPayloadUpgrades,
  views: {
    inline_mention: (entity) => ({
      type: 'diagram',
      slug: entity.slug,
      // Was the slug — this type had no other name to show. It has one now.
      label: (entity.data.title as string) ?? entity.slug,
      href: `/diagrams/${entity.slug}`,
    }),

    single_element: (entity) => baseSingle(entity),
    element_list_item: (entity) => trimItem(entity),
    tagged_list_item: (entity) => trimItem(entity),

    detail: (entity, reader) => {
      const base = baseSingle(entity);
      const references = reader.findSectionReferences('diagram', entity.slug).map((r) => ({
        anchor: r.anchor,
        pagePath: r.pagePath,
        headingText: r.headingText,
        relation: r.relation,
      }));
      return { ...base, _references: references };
    },
  },

  diff: diagramDiff,
};
