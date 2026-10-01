import { useQuery } from '@tanstack/react-query';
import { getEntityDef } from '../../../entities/registry.js';
import { clientPluginHost, categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../../tiptap/EditorContext.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import { NotListable } from '../../../tiptap/extensions/views/NotListable.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, csv, TaggedPill } from './shared.js';

type Listed = { slug: string };

/**
 * `<tagged_list type tags filter?/>` — a dynamic list: `renderRow` of every
 * entity of `type` carrying the tags, with the tag badges. No match, or a tag
 * that does not exist, is an empty list with a message. Inline: a pill.
 */
export function TaggedListRender({ attrs, variant }: TagRenderProps) {
  // Re-read the registry when a plugin frontend registers late.
  useRegistryVersion();
  const type = attr(attrs, 'type');
  const filter: 'and' | 'or' = attrs.filter === 'or' ? 'or' : 'and';
  const tags = csv(attr(attrs, 'tags'));
  const def = getEntityDef(type);
  const bridge = useEditorBridge();

  const mod = clientPluginHost.getEntity(type);
  // Keyed under `['entities']`: every entity / tag change already invalidates
  // that prefix, so the list refreshes without a key of its own.
  const { data: results = [], isLoading } = useQuery<Listed[]>({
    queryKey: ['entities', 'tagged-list', type, tags, filter],
    queryFn: async () => (mod ? ((await mod.listByTags({ tags, filter })) as Listed[]) : []),
    enabled: variant === 'block' && tags.length > 0 && Boolean(mod),
  });

  if (variant === 'inline') return <TaggedPill tags={attr(attrs, 'tags')} filter={filter} typeLabel={type} />;

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <BlockBrokenChip category={category} type={type} />;
  }
  if (!def.renderRow) return <NotListable type={type} label={def.labelPlural} />;
  const RowComp = def.renderRow;

  return (
    <div className="rounded-md" style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--c-hair)' }}>
        <span className="text-[10.5px] uppercase tracking-wider font-mono" style={{ color: 'var(--c-subtle)' }}>
          {def.labelPlural} · tagged
        </span>
        {tags.map((t) => (
          <span
            key={t}
            className="text-[10.5px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          >
            {t}
          </span>
        ))}
        <span className="text-[10.5px] uppercase font-mono" style={{ color: 'var(--c-subtle)' }}>
          {filter}
        </span>
        <span className="flex-1" />
        <span className="text-[10.5px] font-mono" style={{ color: 'var(--c-subtle)' }}>
          {isLoading ? '…' : `${results.length}`}
        </span>
      </div>
      <ul className="p-1">
        {results.length === 0 && !isLoading && (
          <li className="px-3 py-2 text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
            No entities match these tags.
          </li>
        )}
        {results.map((entity) => (
          <li key={entity.slug}>
            {/*
              Through `openEntityHandler`, not straight to `bridge.openEntity`:
              a type may declare `renderRow` and still have no detail route, and
              then it must open its overlay rather than navigate into nowhere.
            */}
            <RowComp
              slug={entity.slug}
              entity={entity as never}
              onOpen={openEntityHandler(type, entity.slug, bridge)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
