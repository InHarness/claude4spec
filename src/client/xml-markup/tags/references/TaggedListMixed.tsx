import { useQuery } from '@tanstack/react-query';
import { clientPluginHost } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../../tiptap/EditorContext.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, csv, TaggedPill } from './shared.js';

type Entity = { slug: string };
type Grouped = Record<string, Entity[]>;

/**
 * `<tagged_list_mixed tags filter?/>` — `renderRow` grouped by type, over the
 * ACTIVE types only: a type whose package goes inactive drops out of the
 * groups without any edit to the page. Inline: a pill.
 */
export function TaggedListMixedRender({ attrs, variant }: TagRenderProps) {
  // This view lists EVERY active type, so a late registration silently shortens
  // it rather than breaking it — re-read the registry when one lands.
  useRegistryVersion();
  const filter: 'and' | 'or' = attrs.filter === 'or' ? 'or' : 'and';
  const tags = csv(attr(attrs, 'tags'));
  const bridge = useEditorBridge();

  const activeModules = clientPluginHost.listEntities();
  const { data: grouped, isLoading } = useQuery<Grouped>({
    queryKey: ['entities', 'tagged-list-mixed', tags, filter, activeModules.map((m) => m.type).join(',')],
    queryFn: async () => {
      const lists = await Promise.all(
        activeModules.map(async (m) => [m.type, await m.listByTags({ tags, filter })] as const),
      );
      const out: Grouped = {};
      for (const [type, list] of lists) out[type] = list as Entity[];
      return out;
    },
    enabled: variant === 'block' && tags.length > 0,
  });

  if (variant === 'inline') return <TaggedPill tags={attr(attrs, 'tags')} filter={filter} typeLabel="mixed" />;

  const safe: Grouped = grouped ?? {};
  const totalCount = Object.values(safe).reduce((acc, list) => acc + list.length, 0);

  return (
    <div className="rounded-md" style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--c-hair)' }}>
        <span className="text-[10.5px] uppercase tracking-wider font-mono" style={{ color: 'var(--c-subtle)' }}>
          tagged · mixed
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
          {isLoading ? '…' : `${totalCount}`}
        </span>
      </div>
      <div>
        {activeModules.map((mod) => {
          const list = safe[mod.type] ?? [];
          if (list.length === 0) return null;
          // An embed-only type has no row: a per-group skip here, since the
          // other groups are perfectly listable.
          const RowComp = mod.renderRow;
          if (!RowComp) return null;
          return (
            <div key={mod.type}>
              <div
                className="px-3 py-1 text-[10.5px] uppercase tracking-wider font-mono"
                style={{ color: 'var(--c-subtle)', background: 'var(--c-panel)' }}
              >
                {mod.labelPlural}
              </div>
              <ul className="p-1">
                {list.map((entity) => (
                  <li key={entity.slug}>
                    <RowComp
                      slug={entity.slug}
                      entity={entity as never}
                      onOpen={openEntityHandler(mod.type, entity.slug, bridge)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {totalCount === 0 && !isLoading && (
          <div className="px-3 py-2 text-[12px] italic" style={{ color: 'var(--c-subtle)' }}>
            No entities match these tags.
          </div>
        )}
      </div>
    </div>
  );
}
