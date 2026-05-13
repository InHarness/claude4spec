import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { getEntityDef } from '../../../entities/registry.js';
import { clientPluginHost } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import type { EntityType } from '../../../../shared/entities.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';

type Entity = { slug: string };

export function TaggedListMixedView(props: NodeViewProps) {
  const { node } = props;
  const rawTags = String(node.attrs.tags ?? '');
  const filter: 'and' | 'or' = node.attrs.filter === 'or' ? 'or' : 'and';
  const tags = rawTags.split(',').map((s) => s.trim()).filter(Boolean);
  const bridge = useEditorBridge();
  const onAltClick = useEditChipOnAltClick(props);
  const altCapture = (e: React.MouseEvent) => {
    if (e.altKey) void onAltClick(e);
  };

  type Grouped = Record<string, Entity[]>;
  const activeModules = clientPluginHost.listEntities();
  const { data: grouped, isLoading } = useQuery<Grouped>({
    queryKey: ['tagged-list-mixed', tags, filter, activeModules.map((m) => m.type).join(',')],
    queryFn: async () => {
      const lists = await Promise.all(
        activeModules.map(async (m) => [m.type, await m.listByTags({ tags, filter })] as const)
      );
      const out: Grouped = {};
      for (const [type, list] of lists) out[type] = list as Entity[];
      return out;
    },
    enabled: tags.length > 0,
  });

  const safe: Grouped = grouped ?? {};
  const totalCount = Object.values(safe).reduce((acc, list) => acc + list.length, 0);

  return (
    <NodeViewWrapper className="my-3" contentEditable={false} onClickCapture={altCapture}>
      <div
        className="rounded-md"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          <span
            className="text-[10.5px] uppercase tracking-wider font-mono"
            style={{ color: 'var(--c-subtle)' }}
          >
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
          <span
            className="text-[10.5px] uppercase font-mono"
            style={{ color: 'var(--c-subtle)' }}
          >
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
            const RowComp = mod.renderRow;
            return (
              <div key={mod.type}>
                <div
                  className="px-3 py-1 text-[10.5px] uppercase tracking-wider font-mono"
                  style={{ color: 'var(--c-subtle)', background: 'var(--c-panel)' }}
                >
                  {mod.labelPlural}
                </div>
                <ul className="p-1">
                  {list.map((entity: Entity) => {
                    const slug = entity.slug;
                    return (
                      <li key={slug}>
                        <RowComp
                          entity={entity as never}
                          onOpen={() => bridge?.openEntity(mod.type as EntityType, slug)}
                        />
                      </li>
                    );
                  })}
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
    </NodeViewWrapper>
  );
}

// silence unused import — kept until other NodeViews migrate to host lookups.
void getEntityDef;
