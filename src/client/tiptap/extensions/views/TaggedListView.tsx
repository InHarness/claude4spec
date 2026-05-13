import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { getEntityDef } from '../../../entities/registry.js';
import { clientPluginHost, categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import type { EntityType } from '../../../../shared/entities.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { BlockBrokenChip } from './BrokenChip.js';

type Listed = { slug: string };

export function TaggedListView(props: NodeViewProps) {
  const { node } = props;
  const type = String(node.attrs.type ?? '');
  const rawTags = String(node.attrs.tags ?? '');
  const filter: 'and' | 'or' = node.attrs.filter === 'or' ? 'or' : 'and';
  const tags = rawTags.split(',').map((s) => s.trim()).filter(Boolean);
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  const onAltClick = useEditChipOnAltClick(props);
  const altCapture = (e: React.MouseEvent) => {
    if (e.altKey) void onAltClick(e);
  };

  // Dispatch to the plugin host's listByTags slot; absent module = empty list.
  const mod = clientPluginHost.getEntity(type);
  const { data: results = [], isLoading } = useQuery<Listed[]>({
    queryKey: ['tagged-list', type, tags, filter],
    queryFn: async () => (mod ? (await mod.listByTags({ tags, filter })) as Listed[] : []),
    enabled: tags.length > 0 && Boolean(mod),
  });

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return (
      <NodeViewWrapper className="my-3" contentEditable={false} onClickCapture={altCapture}>
        <BlockBrokenChip category={category} type={type} />
      </NodeViewWrapper>
    );
  }

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
          <span
            className="text-[10.5px] uppercase font-mono"
            style={{ color: 'var(--c-subtle)' }}
          >
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
          {results.map((entity: Listed) => {
            const slug = entity.slug;
            const RowComp = def.renderRow;
            return (
              <li key={slug}>
                <RowComp
                  entity={entity as any}
                  onOpen={() => bridge?.openEntity(type as EntityType, slug)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </NodeViewWrapper>
  );
}
