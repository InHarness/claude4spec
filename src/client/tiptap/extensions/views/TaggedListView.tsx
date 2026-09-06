import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { getEntityDef } from '../../../entities/registry.js';
import { clientPluginHost, categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useEditorBridge } from '../../EditorContext.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditChipOnAltClick } from './useEditChipOnAltClick.js';
import { BlockBrokenChip } from './BrokenChip.js';
import { NotListable } from './NotListable.js';

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

  // 0.2.15 — an embed-only type has no row (see NotListable).
  if (!def.renderRow) {
    return (
      <NodeViewWrapper className="my-3" contentEditable={false} onClickCapture={altCapture}>
        <NotListable type={type} label={def.labelPlural} />
      </NodeViewWrapper>
    );
  }
  const RowComp = def.renderRow;

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
            return (
              <li key={slug}>
                <RowComp
                  slug={slug}
                  entity={entity as any}
                  /*
                   * Through `openEntityHandler`, NOT straight to
                   * `bridge.openEntity` — this was the fourth call site that
                   * helper's docblock warns about, and it was the one that had
                   * it wrong.
                   *
                   * Nothing noticed until 0.2.70, because a row is only drawn
                   * for a type declaring `renderRow`, and until `module-dependency`
                   * every such type also had a detail route to navigate to. A
                   * HIDDEN type has none, so the direct call navigated to a route
                   * nothing registers and threw the reader off the page. The
                   * helper sends it to the type's overlay instead, and returns
                   * `undefined` for a type that resolves to nothing, which makes
                   * a broken row inert rather than navigating into nowhere.
                   */
                  onOpen={openEntityHandler(type, slug, bridge)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </NodeViewWrapper>
  );
}
