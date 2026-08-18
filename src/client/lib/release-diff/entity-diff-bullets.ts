/**
 * `EntityDiff → Bullet[]` — the generic mapper, and now the ONLY one (M17 L5).
 *
 * What this file used to be is the argument for what it is. It received an
 * untyped `changes` bag whose keys each entity type invented for itself, and
 * reverse-engineered their meaning from a SUFFIX CONVENTION: `*_added` meant an
 * addition, `*_changed` meant an edit, `field_changes` and `meta_changes` were
 * arrays of `{field, from, to}`, `status_code_changed` was an endpoint-shaped
 * special case, and anything unrecognised fell through to a bullet labelled with
 * the raw key. That convention was never declared anywhere; it was inferred from
 * four serializers that happened to agree, and a fifth that did not.
 *
 * 0.2.31 replaced the bag with a closed dictionary of eight operations, so this
 * is a `switch` with no default worth writing and — the point — NOT ONE BRANCH
 * PER ENTITY TYPE. Where a rendering genuinely differs, it keys off the schema
 * `path` (a rendering decision inside one mapper) rather than off the type (a
 * fork in the contract).
 */

import type { DiffOp } from '../../../shared/entities.js';

export type BulletKind = 'add' | 'modify' | 'remove';

export interface Bullet {
  kind: BulletKind;
  /** Human-friendly label, e.g. `method`, `linkedDtos[user-create:response]`, `tags[admin]` */
  label: string;
  from?: unknown;
  to?: unknown;
  /** Bytes, for the opaque class — the content itself is never comparable. */
  fromBytes?: number;
  toBytes?: number;
  /** Nested operations (`item_modified`), same grammar, rendered recursively. */
  children?: Bullet[];
  /** The full item, for `item_added` / `item_removed`. */
  item?: unknown;
  /** True when the row carries something worth expanding. */
  expandable?: boolean;
}

type IdentityKey = Record<string, string | number | boolean>;

/**
 * `linkedDtos[user-create:response]` rather than `linkedDtos[{"dto":…}]`.
 *
 * The values in declaration order, colon-joined — which reproduces the labels
 * the hand-written formatters used to build (`linked_dtos[user-create]`,
 * `tokens[color-500]`) without any of them saying so, because the order of an
 * identity tuple is the order the type declared it in.
 */
function labelOf(path: string, identity: IdentityKey): string {
  const values = Object.values(identity).map(String).filter(Boolean);
  return values.length ? `${path}[${values.join(':')}]` : path;
}

/**
 * The one place a rendering keys off `path`.
 *
 * An endpoint's DTO links read much better with the HTTP status code in the
 * label, and `statusCode` is deliberately NOT part of that collection's
 * identity (changing it is an edit to the link, not a different link), so it
 * would otherwise never reach the row. Keyed by the schema path, not by
 * `type === 'endpoint'`: a second type declaring a field of the same shape
 * would get the same treatment, which is the honest generalisation.
 */
function decorate(path: string, item: unknown): string {
  if (path !== 'linkedDtos' || item === null || typeof item !== 'object') return '';
  const status = (item as { statusCode?: unknown }).statusCode;
  return status == null ? '' : ` (${String(status)})`;
}

export function entityDiffToBullets(changes: readonly DiffOp[] | undefined): Bullet[] {
  if (!changes?.length) return [];
  const out: Bullet[] = [];

  for (const change of changes) {
    switch (change.op) {
      case 'field_changed':
        out.push({ kind: 'modify', label: change.path, from: change.from, to: change.to });
        break;

      case 'field_changed_opaque':
        // Sizes, never the bodies: this operation exists precisely because the
        // two values cannot be shown side by side.
        out.push({
          kind: 'modify',
          label: change.path,
          fromBytes: change.fromBytes,
          toBytes: change.toBytes,
        });
        break;

      case 'item_added':
        out.push({
          kind: 'add',
          label: labelOf(change.path, change.identity) + decorate(change.path, change.item),
          item: change.item,
          expandable: true,
        });
        break;

      case 'item_removed':
        out.push({
          kind: 'remove',
          label: labelOf(change.path, change.identity) + decorate(change.path, change.item),
          item: change.item,
          expandable: true,
        });
        break;

      case 'item_modified':
        out.push({
          kind: 'modify',
          label: labelOf(change.path, change.identity),
          // RECURSION, not a count. The nested list is the same grammar, so the
          // renderer that draws this level draws that one too.
          children: entityDiffToBullets(change.changes),
          expandable: true,
        });
        break;

      case 'item_rekeyed':
        out.push({
          kind: 'modify',
          label: `${labelOf(change.path, change.identity)}.${change.field}`,
          from: change.from,
          to: change.to,
        });
        break;

      case 'tag_added':
        out.push({ kind: 'add', label: `tags[${change.tag}]` });
        break;

      case 'tag_removed':
        out.push({ kind: 'remove', label: `tags[${change.tag}]` });
        break;
    }
  }

  return out;
}
