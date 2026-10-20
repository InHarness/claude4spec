import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { editorBridge } from '../../../runtime/editor-bridge.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import { NotListable } from '../../../tiptap/extensions/views/NotListable.js';
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
 * the consistency check reports the slug). A type without a row slot (hidden
 * types) cannot be listed. Inline: one chip per slug.
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
  // 2.1.41 — one refLookup for the whole list, like tagLookup.
  const refLookup = useListRefLookup(variant === 'inline' ? [] : slugs.map((slug) => ({ type, slug })));
  const def = getEntityDef(type);

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

  // An embed-only type has no row; say so instead of drawing an empty frame
  // that reads as "no results".
  if (!def.renderRow) return <NotListable type={type} label={def.labelPlural} />;

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
  // Non-null by the guard in ElementListRender, which never renders a Row for a
  // type without one.
  const RowComp = def.renderRow!;
  return (
    <li>
      <RowComp slug={slug} entity={data} onOpen={onOpen} tagLookup={tagLookup} refLookup={refLookup} />
    </li>
  );
}
