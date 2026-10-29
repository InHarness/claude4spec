import { useQuery } from '@tanstack/react-query';
import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { editorBridge } from '../../../runtime/editor-bridge.js';
import { entitiesApi } from '../../../lib/api.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import { NoListView } from '../../../tiptap/extensions/views/NoListView.js';
import { useListTagLookup } from '../../../entities/useListTagLookup.js';
import { useListRefLookup } from '../../../entities/useRefLookup.js';
import type { RefLookupEntry } from '../../../host-ui-kit/actions/EntityRefValue.js';
import type { Tag } from '../../../../shared/plugin-host/tag.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, csv, EntityChip } from './shared.js';

/**
 * `<element_list type slugs/>` — one `renderRow` per slug, in the fixed order
 * of `slugs`. A slug with no entity (deleted) renders no row at all — it is
 * skipped, never degraded to a chip, and `renderRow` only ever receives a
 * resolved entity, so the slot has no `null` branch (M19 `m19broken`, 2.1.16;
 * the consistency check reports the slug). Inline: one chip per slug.
 *
 * 2.1.63 (M19 `m19hidden`): an ACTIVE type without a row slot has no list view —
 * in both variants the list is one information block naming the type, with the
 * number of its listed slugs that name an existing entity, and no rows or chips.
 *
 * 2.1.40: every row gets the same `tagLookup`, from one `['tags']` query made
 * here, once for the whole list. 2.1.41: and the same `refLookup`, built once
 * per list from the rows' reference fields (`useListRefLookup`).
 */
export function ElementListRender({ attrs, variant }: TagRenderProps) {
  useRegistryVersion();
  const tagLookup = useListTagLookup();
  const type = attr(attrs, 'type');
  const slugs = csv(attr(attrs, 'slugs'));
  const def = getEntityDef(type);
  const noListView = !!def && !def.renderRow;
  // 2.1.41 — one refLookup for the whole list, like tagLookup. Nothing to
  // resolve where no row is drawn.
  const refLookup = useListRefLookup(
    variant === 'inline' || noListView ? [] : slugs.map((slug) => ({ type, slug })),
  );
  // 2.1.63 — the info block's count: ONE "read by slugs" for the whole list,
  // only for a type without a list view. Keyed under `['entities']`, so every
  // entity change refreshes it with no key of its own.
  const { data: found } = useQuery({
    queryKey: ['entities', 'no-list-view', type, slugs],
    queryFn: async () => (await entitiesApi.getBySlugs(type, slugs)).filter((r) => r.entity !== null).length,
    enabled: noListView && slugs.length > 0,
  });

  if (noListView) {
    return <NoListView type={type} count={slugs.length === 0 ? 0 : (found ?? null)} variant={variant} />;
  }

  if (variant === 'inline') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {slugs.map((s) => (
          <EntityChip key={s} type={type} slug={s} />
        ))}
      </span>
    );
  }

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <BlockBrokenChip category={category} type={type} />;
  }

  return (
    <div className="rounded-md" style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}>
      <div
        className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider font-mono"
        style={{ color: 'var(--c-subtle)', borderBottom: '1px solid var(--c-hair)' }}
      >
        {def.labelPlural} · {slugs.length}
      </div>
      <ul className="p-1">
        {slugs.map((slug) => (
          <Row
            key={slug}
            type={type}
            slug={slug}
            tagLookup={tagLookup}
            refLookup={refLookup}
            onOpen={openEntityHandler(type, slug, editorBridge)}
          />
        ))}
        {slugs.length === 0 && (
          <li className="px-3 py-2 text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
            empty list
          </li>
        )}
      </ul>
    </div>
  );
}

function Row({
  type,
  slug,
  tagLookup,
  refLookup,
  onOpen,
}: {
  type: string;
  slug: string;
  tagLookup: ReadonlyMap<string, Tag>;
  refLookup: ReadonlyMap<string, RefLookupEntry>;
  onOpen?: () => void;
}) {
  const def = getEntityDef(type)!;
  const { data, isLoading } = def.useGetBySlug(slug);
  if (isLoading && data === undefined) {
    return (
      <li className="px-3 py-1.5 text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
        {slug}…
      </li>
    );
  }
  // A slug with no entity yields no row — not a broken chip, not a `null` entity
  // handed to `renderRow`; check_consistency reports it.
  if (!data) return null;
  // Non-null: ElementListRender answers a type without one with the info block
  // and never renders a Row for it.
  const RowComp = def.renderRow!;
  return (
    <li>
      <RowComp slug={slug} entity={data} onOpen={onOpen} tagLookup={tagLookup} refLookup={refLookup} />
    </li>
  );
}
