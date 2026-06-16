import { describe, expect, it } from 'vitest';
import { diagramSerializer, type DiagramSnapshot } from './serializer.js';
import { canonicalize } from '../../serialization/snapshot.js';
import type { RawEntity } from '../../domain/raw-entity-reader.js';

const ctx = { reader: {} as never, depth: 0, maxDepth: 1 };

function rawEntity(data: Record<string, unknown>, tags: string[] = []): RawEntity {
  return { type: 'diagram', slug: String(data.slug ?? 'd'), data, tags };
}

describe('diagram serializer', () => {
  it('snapshot is deterministic: byte-identical, no timestamps, source verbatim, tags sorted', () => {
    const data = {
      slug: 'auth-flow',
      format: 'mermaid',
      source: 'flowchart TD\n  A-->B',
    };
    const first = diagramSerializer.snapshot!(rawEntity(data, ['zeta', 'alpha']), ctx) as DiagramSnapshot;
    const second = diagramSerializer.snapshot!(rawEntity(data, ['zeta', 'alpha']), ctx) as DiagramSnapshot;

    const firstJson = JSON.stringify(canonicalize(first));
    expect(JSON.stringify(canonicalize(second))).toBe(firstJson);
    expect(firstJson).not.toMatch(/"created_at":|"createdAt":/);
    expect(firstJson).not.toMatch(/"updated_at":|"updatedAt":/);

    // source kept verbatim (no trim); caption is NOT part of the snapshot
    expect(first.source).toBe('flowchart TD\n  A-->B');
    expect(firstJson).not.toMatch(/"caption"/);
    expect(first.tags).toEqual(['alpha', 'zeta']);
  });

  it('defaults format to mermaid and tolerates an empty (placeholder) source', () => {
    const snap = diagramSerializer.snapshot!(rawEntity({ slug: 'empty' }), ctx) as DiagramSnapshot;
    expect(snap.format).toBe('mermaid');
    expect(snap.source).toBe('');
  });

  it('diff reports format / source / tag changes and ignores no-ops', () => {
    const a: DiagramSnapshot = { slug: 'd', format: 'mermaid', source: 'graph TD; A-->B', tags: ['x'] };
    expect(diagramSerializer.diff!(a, a, 'd').op).toBe('noop');

    const b: DiagramSnapshot = { slug: 'd', format: 'mermaid', source: 'graph TD; A-->C', tags: ['x', 'y'] };
    const d = diagramSerializer.diff!(a, b, 'd');
    expect(d.op).toBe('modified');
    const changes = d.changes as Record<string, unknown>;
    expect(changes.source_changed).toBe(true);
    expect(changes.tag_added).toEqual(['y']);
  });

  it('serializer version is 1.0.0', () => {
    expect(diagramSerializer.version).toBe('1.0.0');
  });
});
