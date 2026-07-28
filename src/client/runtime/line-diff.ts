/**
 * M13/L11 — `lineDiffHunks`: the textual line-diff over two entity version
 * snapshots, exposed on the plugin runtime surface as a PURE FUNCTION (not a
 * singleton — there is no single-instance requirement).
 *
 * It is the plugin-facing counterpart of the host-internal `LineDiffViewer`
 * (M17/L5) and fetches nothing. Note the deliberate vocabulary split: the
 * internal `LineDiffLite` speaks `{ op: 'keep'|'added'|'removed'; content }`,
 * while the public Host UI Kit contract (`DiffView.hunks`) speaks
 * `{ op: 'add'|'del'|'ctx'; line }`. L11 speaks L12's dictionary, so this
 * module owns the mapping and the internal shape never leaks outward.
 *
 * Distinct from `useVersionDiff`, which is a different layer: that one is the
 * SEMANTIC delta from the L9 serializer's `diff` slot; this one is a textual
 * line diff over the raw JSON snapshots. Neither replaces the other.
 */

import { computeLineDiffClient } from '../lib/release-diff/compute-line-diff.js';
import type { DiffViewLine } from '../host-ui-kit/detail/DiffView.js';

/** Version snapshots arrive as parsed JSON; pre-stringified text is passed through. */
function asText(snapshot: unknown): string {
  if (typeof snapshot === 'string') return snapshot;
  if (snapshot === undefined) return '';
  return JSON.stringify(snapshot, null, 2) ?? '';
}

/**
 * Line-diff two entity version snapshots into `DiffView.hunks`.
 *
 * @param before the older snapshot (a `VersionDetail['data']` object, or text)
 * @param after  the newer snapshot
 */
export function lineDiffHunks(before: unknown, after: unknown): DiffViewLine[] {
  const { lines } = computeLineDiffClient(asText(before), asText(after));
  return lines.map((l) => ({
    op: l.op === 'added' ? 'add' : l.op === 'removed' ? 'del' : 'ctx',
    line: l.content,
  }));
}
