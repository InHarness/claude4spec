import type { RawEntity } from '../../discovery/raw-entity-reader.js';
import { acPayloadUpgrades } from './upgrades.js';
import type {
  EntityDiff,
  RestoreContext,
  RestoreResult,
  SerializationContribution,
} from '../../serialization/types.js';
import type { AcKind, AcStatus, AcVerifyRef } from '../../../shared/entities.js';

// ─── M17 Snapshot shape ─────────────────────────────────────────────────────

export interface AcSnapshot {
  slug: string;
  title: string;
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string | null;
  tags: string[];
}

function coerceAc(raw: unknown): AcSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const verifies = Array.isArray(r.verifies)
    ? (r.verifies as AcVerifyRef[]).filter((v) => v && typeof v.type === 'string' && typeof v.slug === 'string')
    : [];
  return {
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    text: String(r.text ?? ''),
    kind: ((r.kind as AcKind) ?? 'requirement') as AcKind,
    status: ((r.status as AcStatus) ?? 'active') as AcStatus,
    verifies,
    description: (r.description as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
  };
}

function acDiff(a: unknown, b: unknown, slug: string): EntityDiff {
  if (a == null && b == null) return { type: 'ac', slug, op: 'noop' };
  if (a == null) return { type: 'ac', slug, op: 'created' };
  if (b == null) return { type: 'ac', slug, op: 'deleted' };
  const sa = coerceAc(a);
  const sb = coerceAc(b);
  const changes: Record<string, unknown> = {};

  if (sa.title !== sb.title) changes.title_changed = { from: sa.title, to: sb.title };
  if (sa.text !== sb.text) changes.text_changed = { from: sa.text, to: sb.text };
  if (sa.kind !== sb.kind) changes.kind_changed = { from: sa.kind, to: sb.kind };
  if (sa.status !== sb.status) changes.status_changed = { from: sa.status, to: sb.status };
  if (sa.description !== sb.description) {
    changes.description_changed = { from: sa.description, to: sb.description };
  }

  const verifyKey = (v: AcVerifyRef) => `${v.type}/${v.slug}`;
  const aVerify = new Set(sa.verifies.map(verifyKey));
  const bVerify = new Set(sb.verifies.map(verifyKey));
  const verifyAdded = sb.verifies.filter((v) => !aVerify.has(verifyKey(v)));
  const verifyRemoved = sa.verifies.filter((v) => !bVerify.has(verifyKey(v)));
  if (verifyAdded.length) changes.verify_added = verifyAdded;
  if (verifyRemoved.length) changes.verify_removed = verifyRemoved;

  const tagAdded = sb.tags.filter((t) => !sa.tags.includes(t));
  const tagRemoved = sa.tags.filter((t) => !sb.tags.includes(t));
  if (tagAdded.length) changes.tag_added = tagAdded;
  if (tagRemoved.length) changes.tag_removed = tagRemoved;

  if (Object.keys(changes).length === 0) return { type: 'ac', slug, op: 'noop' };
  return { type: 'ac', slug, op: 'modified', changes };
}

export const acSerializer: SerializationContribution<RawEntity> = {
  payloadVersion: 2,
  payloadUpgrades: acPayloadUpgrades,
  diff: acDiff,
};
