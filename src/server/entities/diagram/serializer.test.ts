import { describe, expect, it } from 'vitest';
import { diagramSerialization, type DiagramSnapshot } from './serializer.js';
import { diagramBackendModule } from './plugin.js';
import { canonicalize } from '../../serialization/snapshot.js';
import { snapshotFromSchema } from '../../serialization/schema-snapshot.js';
import type { RawEntity } from '../../discovery/raw-entity-reader.js';

/**
 * 0.2.9 — the snapshot is GENERATED, so these assert the generator's output for
 * diagram's declaration rather than a function diagram ships. What is being
 * checked is unchanged and is diagram-specific: a source kept verbatim, a
 * transient `caption` that never reaches the file, the enum's default.
 */
const reader = { readCollection: () => [] } as never;
const snapshot = (e: RawEntity) => snapshotFromSchema(diagramBackendModule, e, reader);

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
    const first = snapshot(rawEntity(data, ['zeta', 'alpha'])) as DiagramSnapshot;
    const second = snapshot(rawEntity(data, ['zeta', 'alpha'])) as DiagramSnapshot;

    const firstJson = JSON.stringify(canonicalize(first));
    expect(JSON.stringify(canonicalize(second))).toBe(firstJson);
    expect(firstJson).not.toMatch(/"created_at":|"createdAt":/);
    expect(firstJson).not.toMatch(/"updated_at":|"updatedAt":/);

    // source kept verbatim (no trim); caption is NOT part of the snapshot
    expect(first.source).toBe('flowchart TD\n  A-->B');
    expect(firstJson).not.toMatch(/"caption"/);
    expect(first.tags).toEqual(['alpha', 'zeta']);
  });

  it('fills an absent format and an absent source from their declared defaults', () => {
    // Both values come from the DECLARATION now (`format` defaults to
    // 'mermaid', `source` to ''), where they used to come from coercions
    // written into the snapshot function. Same answers, one source of truth.
    const snap = snapshot(rawEntity({ slug: 'empty' })) as DiagramSnapshot;
    expect(snap.format).toBe('mermaid');
    expect(snap.source).toBe('');
  });

  it('diff reports format / source / tag changes and ignores no-ops', () => {
    const a: DiagramSnapshot = { slug: 'd', format: 'mermaid', source: 'graph TD; A-->B', tags: ['x'] };
    expect(diagramSerialization.diff(a, a, 'd').op).toBe('noop');

    const b: DiagramSnapshot = { slug: 'd', format: 'mermaid', source: 'graph TD; A-->C', tags: ['x', 'y'] };
    const d = diagramSerialization.diff(a, b, 'd');
    expect(d.op).toBe('modified');
    const changes = d.changes as Record<string, unknown>;
    /**
     * 0.2.22 — a content-bearing field diffs by SIZE. `source_changed: true`
     * said only that something moved; two byte counts say how much and in which
     * direction, which is the most a reader can act on without opening bodies
     * the flag exists to keep out of a diff.
     */
    expect(changes.source_changed).toEqual({ fromBytes: 15, toBytes: 15 });
    expect(changes.tag_added).toEqual(['y']);
  });

  it('carries its payload version and a step for each transition', () => {
    // 0.2.24 — ONE copy of the number. The contribution's echo went with the
    // `serializer` wrapper, so there is nothing left for a half-done bump to
    // disagree with; the chain length is what registration checks it against.
    expect(diagramBackendModule.payloadVersion).toBe(2);
    expect(diagramBackendModule.payloadUpgrades).toHaveLength(1);
    expect(diagramSerialization.payloadUpgrades).toHaveLength(1);
  });
});
