import type { RawDeltaEntityChange, SpecSnapshot } from '../../../shared/entities.js';
import { getEntityDef } from '../../entities/registry.js';
import { HostCard } from '../../entities/HostCard.js';
import { entityDiffToBullets } from '../../lib/release-diff/entity-diff-bullets.js';
import { colorForOp, labelForOp } from '../../lib/release-diff/colors.js';
import { snapshotToEntity } from '../../lib/release-diff/snapshot-to-entity.js';
import { BulletList } from './BulletList.js';
import { MasterEntityLink, ShadowOnlyLabel, type ShadowCompare } from './ShadowCardParts.js';

interface Props {
  change: RawDeltaEntityChange;
  /** Snapshot poprzedniego release'a — używany dla renderu stanu `from` przy `deleted`. */
  fromSnapshot?: SpecSnapshot;
  /**
   * 2.1.46 (m17ui002): set in a shadow comparison. `added` → no link, label
   * `shadow only`, no full render (the element is not on the master);
   * `modified` / `deleted` → a link to the master's version; `deleted` renders
   * its state from `shadow.before` (the left side of the delta). The right
   * side's state is not part of the response, so `modified` has no full render.
   */
  shadow?: ShadowCompare;
}

/**
 * Card per encja w release detail (m17uidet01):
 *   1. header: typ + slug + label (added/modified/deleted)
 *   2. bullet list zmian (z `entityDiffToBullets`)
 *   3. pełny render encji:
 *      - added/modified → `single_element` w stanie `to` (current DB)
 *      - deleted        → `single_element` w stanie `from` (snapshot z poprzedniego release'a)
 */
export function EntityDiffCard({ change, fromSnapshot, shadow }: Props) {
  const op = colorForOp(change.op);
  const bullets = entityDiffToBullets(change.changes);
  const def = getEntityDef(change.type);

  return (
    <div
      className="rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      data-diff-card={`${change.type}:${change.slug}`}
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
        {shadow && (
          <>
            <span className="flex-1" />
            {change.op === 'created' ? (
              <ShadowOnlyLabel />
            ) : (
              <MasterEntityLink type={change.type} slug={change.slug} />
            )}
          </>
        )}
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        {bullets.length > 0 ? (
          <BulletList bullets={bullets} />
        ) : (
          change.op !== 'noop' && (
            <div className="text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
              {labelForOp(change.op)}
            </div>
          )
        )}

        {shadow ? (
          change.op === 'deleted' && <ShadowDeletedEntityRender change={change} before={shadow.before} />
        ) : change.op === 'deleted' ? (
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
  return <HostCard type={type} card={def.renderCard} slug={slug} entity={data} />;
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
  if (!snapshot) return <UnavailableState text="Snapshot from previous release unavailable." />;
  return <FromStateRender change={change} data={snapshot.data} heading="Snapshot from previous release" />;
}

/**
 * 2.1.46 (m17ui002) — a deleted entity in a shadow comparison: its `from` state
 * is the response's `before[type][slug]` (HEAD in `merge` mode, the base in
 * `shadow-only`), not a release snapshot.
 */
function ShadowDeletedEntityRender({
  change,
  before,
}: {
  change: RawDeltaEntityChange;
  before: ShadowCompare['before'];
}) {
  const data = before[change.type]?.[change.slug];
  if (!data) return <UnavailableState text="The state before the change is unavailable." />;
  return <FromStateRender change={change} data={data} heading="Before the shadow" />;
}

function UnavailableState({ text }: { text: string }) {
  return (
    <div
      className="rounded-md p-2 text-[11.5px] italic"
      style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
    >
      {text}
    </div>
  );
}

/** The full `from` state of a deleted entity, through the type's card (raw JSON without one). */
function FromStateRender({
  change,
  data,
  heading,
}: {
  change: RawDeltaEntityChange;
  data: unknown;
  heading: string;
}) {
  const def = getEntityDef(change.type);
  const entityShape = snapshotToEntity(change.type, data);
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
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }
  return (
    <div>
      <div
        className="text-[10.5px] uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--c-subtle)' }}
      >
        {heading}
      </div>
      <HostCard type={change.type} card={def.renderCard} slug={change.slug} entity={entityShape} />
    </div>
  );
}
