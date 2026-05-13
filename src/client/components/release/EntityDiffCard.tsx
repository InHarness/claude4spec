import type { RawDeltaEntityChange, SpecSnapshot } from '../../../shared/entities.js';
import { getEntityDef } from '../../entities/registry.js';
import { entityDiffToBullets } from '../../lib/release-diff/entity-diff-bullets.js';
import { colorForOp, labelForOp } from '../../lib/release-diff/colors.js';
import { snapshotToEntity } from '../../lib/release-diff/snapshot-to-entity.js';
import { BulletList } from './BulletList.js';

interface Props {
  change: RawDeltaEntityChange;
  /** Snapshot poprzedniego release'a — używany dla renderu stanu `from` przy `deleted`. */
  fromSnapshot?: SpecSnapshot;
}

/**
 * Card per encja w release detail (m17uidet01):
 *   1. header: typ + slug + label (added/modified/deleted)
 *   2. bullet list zmian (z `entityDiffToBullets`)
 *   3. pełny render encji:
 *      - added/modified → `single_element` w stanie `to` (current DB)
 *      - deleted        → `single_element` w stanie `from` (snapshot z poprzedniego release'a)
 */
export function EntityDiffCard({ change, fromSnapshot }: Props) {
  const op = colorForOp(change.op);
  const bullets = entityDiffToBullets(change.changes);
  const def = getEntityDef(change.type);

  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="inline-block rounded text-[10px] font-mono px-1.5 py-0.5 uppercase"
          style={{ background: op.bg, color: op.fg }}
        >
          {labelForOp(change.op)}
        </span>
        <span className="text-[11.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
          {change.type}
        </span>
        <span className="text-[13px] font-mono" style={{ color: 'var(--c-ink)' }}>
          {change.slug}
        </span>
        {change._serializerVersionMismatch && (
          <span
            className="text-[10px] rounded px-1.5 py-0.5"
            style={{ background: 'rgba(217,119,6,0.12)', color: '#d97706' }}
            title="Serializer version differs between releases"
          >
            schema bump
          </span>
        )}
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        {bullets.length > 0 ? (
          <BulletList bullets={bullets} />
        ) : (
          change.op !== 'noop' && (
            <div className="text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
              {change.op === 'created' ? 'added' : change.op}
            </div>
          )
        )}

        {change.op === 'deleted' ? (
          <DeletedEntityRender change={change} fromSnapshot={fromSnapshot} />
        ) : (
          def && <EntityCardWrap type={change.type} slug={change.slug} />
        )}
      </div>
    </div>
  );
}

function EntityCardWrap({ type, slug }: { type: string; slug: string }) {
  const def = getEntityDef(type);
  if (!def) return null;
  // Hook is invariant across renders for the same type — typical pattern with
  // entity registry: pick `useGetBySlug` from the def and call it.
  const { data, isLoading } = def.useGetBySlug(slug);
  if (isLoading && data == null) {
    return (
      <div
        className="rounded-md p-2 text-[11.5px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        Loading {def.label} {slug}…
      </div>
    );
  }
  if (data == null) {
    return (
      <div
        className="rounded-md p-2 text-[11.5px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        {def.label} {slug} no longer in spec.
      </div>
    );
  }
  const Card = def.renderCard;
  return <Card slug={slug} entity={data} />;
}

function DeletedEntityRender({
  change,
  fromSnapshot,
}: {
  change: RawDeltaEntityChange;
  fromSnapshot?: SpecSnapshot;
}) {
  const snapshot = fromSnapshot?.entities.find(
    (e) => e.type === change.type && e.slug === change.slug,
  );
  if (!snapshot) {
    return (
      <div
        className="rounded-md p-2 text-[11.5px] italic"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        Snapshot from previous release unavailable.
      </div>
    );
  }
  const def = getEntityDef(change.type);
  const entityShape = snapshotToEntity(change.type, snapshot.data);
  if (!def || entityShape == null) {
    return (
      <div
        className="rounded-md p-2"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
      >
        <pre
          className="font-mono text-[11.5px] whitespace-pre-wrap break-words"
          style={{ color: 'var(--c-ink)' }}
        >
          {JSON.stringify(snapshot.data, null, 2)}
        </pre>
      </div>
    );
  }
  const Card = def.renderCard;
  return (
    <div>
      <div
        className="text-[10.5px] uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--c-subtle)' }}
      >
        Snapshot from previous release
      </div>
      <Card slug={change.slug} entity={entityShape} />
    </div>
  );
}
