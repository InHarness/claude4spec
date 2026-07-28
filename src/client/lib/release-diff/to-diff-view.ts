import type { LineDiffLite } from '../../../shared/entities.js';
import type { DiffViewLine } from '../../host-ui-kit/detail/DiffView.js';

/**
 * Maps M17's historical hunk shape onto the catalog's line-diff vocabulary.
 *
 * C4S has ONE line-diff renderer (`DiffView`) and ONE hunk dictionary
 * (`{ op: 'add'|'del'|'ctx', line }`). M17's producer predates it and still
 * emits `{ op: 'keep'|'added'|'removed', content }` — so it adapts here, at the
 * boundary, rather than getting a second renderer. This is a pure mapping: no
 * rendering decisions, no filtering, no reordering.
 *
 * `DiffView` also tolerates the legacy shape for plugins compiled against the
 * old `.d.ts`, but that path logs a deprecation warning and is not for host
 * code — the host converts explicitly.
 */
const OP: Record<'keep' | 'added' | 'removed', DiffViewLine['op']> = {
  keep: 'ctx',
  added: 'add',
  removed: 'del',
};

export function toDiffViewHunks(lineDiff: LineDiffLite): DiffViewLine[] {
  return lineDiff.lines.map((l) => ({ op: OP[l.op], line: l.content }));
}
