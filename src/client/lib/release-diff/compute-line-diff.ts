import { diffLines } from 'diff';
import { ANCHOR_PATTERN_SOURCE } from '../../../shared/anchor-pattern.js';
import type { LineDiffLite } from '../../../shared/entities.js';

const ANCHOR_LINE_RE = new RegExp(`^\\s*${ANCHOR_PATTERN_SOURCE}\\s*$`);
const CODE_FENCE_RE = /^\s*```/m;

/**
 * Client-side mirror of `computeLineDiff` from server file-serializer.
 * Used for ad-hoc inline diff between two arbitrary text snapshots
 * (e.g. entity versions in VersionHistory). Output shape matches
 * `LineDiffLite` so it can be passed to `LineDiffViewer`.
 */
export function computeLineDiffClient(a: string, b: string): LineDiffLite {
  const lines: LineDiffLite['lines'] = [];
  const parts = diffLines(a, b);
  for (const part of parts) {
    const op: LineDiffLite['lines'][number]['op'] = part.added
      ? 'added'
      : part.removed
        ? 'removed'
        : 'keep';
    const partLines = part.value.split('\n');
    if (partLines.length > 0 && partLines[partLines.length - 1] === '') partLines.pop();
    for (const content of partLines) {
      lines.push({ op, content });
    }
  }
  if (CODE_FENCE_RE.test(a) || CODE_FENCE_RE.test(b)) {
    return { lines };
  }
  const filtered = lines.filter((l) => {
    if (l.op === 'keep') return true;
    if (l.content.trim() === '') return false;
    if (ANCHOR_LINE_RE.test(l.content)) return false;
    return true;
  });
  return { lines: filtered };
}
