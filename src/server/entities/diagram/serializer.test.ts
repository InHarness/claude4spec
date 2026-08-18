import { describe, expect, it } from 'vitest';
import { diagramSerialization, type DiagramSnapshot } from './serializer.js';
import { diffFromSchema } from '../../serialization/schema-diff.js';
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

  /**
   * 0.2.31 — the delta is the HOST's, generated from `diagram`'s own schema.
   *
   * `diagram` declares no value collections at all, so its delta is provably
   * scalar: `field_changed` for `title`/`format`, `field_changed_opaque` for the
   * `contentBearing` `source`, and the two tag operations. No `item_*` operation
   * can appear here, and that is a property of the declaration rather than of
   * anything this type wrote.
   */
  it('[ac:ac-slot-diff-jest-opcjonalny-typ-bez-dek] delta reports format / source / tag changes and ignores no-ops', () => {
    const schema = diagramBackendModule.data!.schema;
    const a: DiagramSnapshot = { slug: 'd', title: 'D', format: 'mermaid', source: 'graph TD; A-->B', tags: ['x'] };
    expect(diffFromSchema(schema, a, a)).toEqual([]);

    const b: DiagramSnapshot = { slug: 'd', title: 'D', format: 'd2', source: 'graph TD; A-->C', tags: ['x', 'y'] };
    const changes = diffFromSchema(schema, a, b);
    expect(changes).toContainEqual({ op: 'field_changed', path: 'format', from: 'mermaid', to: 'd2' });
    /**
     * A content-bearing field diffs by SIZE. `source_changed: true` said only
     * that something moved; two byte counts say how much and in which direction,
     * which is the most a reader can act on without opening bodies the flag
     * exists to keep out of a delta. Equal sizes, different content — still a
     * change, and still reported without either body.
     */
    expect(changes).toContainEqual({
      op: 'field_changed_opaque',
      path: 'source',
      fromBytes: 15,
      toBytes: 15,
    });
    expect(changes).toContainEqual({ op: 'tag_added', tag: 'y' });
    expect(changes.some((c) => c.op.startsWith('item_'))).toBe(false);
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
