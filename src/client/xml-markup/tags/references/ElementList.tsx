import { getEntityDef } from '../../../entities/registry.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../../tiptap/EditorContext.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import { NotListable } from '../../../tiptap/extensions/views/NotListable.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, csv, EntityChip } from './shared.js';

/**
 * `<element_list type slugs/>` — one `renderRow` per slug, in the fixed order
 * of `slugs`. A slug with no entity is skipped (the consistency check reports
 * it); a type without a row slot (hidden types) cannot be listed. Inline: one
 * chip per slug.
 */
export function ElementListRender({ attrs, variant }: TagRenderProps) {
  useRegistryVersion();
  const type = attr(attrs, 'type');
  const slugs = csv(attr(attrs, 'slugs'));
  const def = getEntityDef(type);
  const bridge = useEditorBridge();

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
          <Row key={slug} type={type} slug={slug} onOpen={openEntityHandler(type, slug, bridge)} />
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

function Row({ type, slug, onOpen }: { type: string; slug: string; onOpen?: () => void }) {
  const def = getEntityDef(type)!;
  const { data, isLoading } = def.useGetBySlug(slug);
  if (isLoading && data === undefined) {
    return (
      <li className="px-3 py-1.5 text-[12.5px]" style={{ color: 'var(--c-subtle)' }}>
        {slug}…
      </li>
    );
  }
  // A slug with no entity is skipped in the render; check_consistency reports it.
  if (!data) return null;
  // Non-null by the guard in ElementListRender, which never renders a Row for a
  // type without one.
  const RowComp = def.renderRow!;
  return (
    <li>
      <RowComp slug={slug} entity={data} onOpen={onOpen} />
    </li>
  );
}
