import { useCallback, useEffect, useState } from 'react';
import { getEntityDef } from '../../../entities/registry.js';
import { ChipResolver } from '../../../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { useEditorBridge } from '../../../tiptap/EditorContext.js';
import { InlineBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import type { TagRenderProps } from '../../renders.js';

export function attr(attrs: TagRenderProps['attrs'], key: string): string {
  return String(attrs[key] ?? '');
}

export function csv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Report broken state upward whenever it changes. */
export function useBrokenReport(
  onBrokenChange: TagRenderProps['onBrokenChange'],
  unresolvedType: boolean,
  missingEntity: boolean,
): void {
  useEffect(() => {
    onBrokenChange?.({ unresolvedType, missingEntity });
  }, [onBrokenChange, unresolvedType, missingEntity]);
}

/**
 * One entity as an inline chip: the type's `renderChip` slot, or the broken
 * chip when the type resolves to no active module. A hidden type opens its
 * overlay, a normal one navigates — through the bridge only.
 */
export function EntityChip({
  type,
  slug,
  caption,
  onBroken,
}: {
  type: string;
  slug: string;
  caption?: string;
  onBroken?: (state: { unresolvedType: boolean; missingEntity: boolean }) => void;
}) {
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  const open = openEntityHandler(type, slug, bridge, caption);
  const [missing, setMissing] = useState(false);
  const onMissing = useCallback((m: boolean) => setMissing(m), []);
  useBrokenReport(onBroken, !def, !!def && missing);
  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <InlineBrokenChip category={category} type={type} slug={slug} />;
  }
  return <ChipResolver type={type} slug={slug} onOpen={open} onMissing={onMissing} />;
}

/** The inline (chat) shape of a list tag: a `#tags · type` pill. */
export function TaggedPill({ tags, filter, typeLabel }: { tags: string; filter: string; typeLabel: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px] font-mono"
      style={{
        background: 'var(--c-panel)',
        color: 'var(--c-muted)',
        border: '1px solid var(--c-hair-strong)',
      }}
      title={`tagged_list ${typeLabel} · ${filter}-filter`}
    >
      <span style={{ opacity: 0.7 }}>#</span>
      <span>{tags}</span>
      <span style={{ opacity: 0.5 }}>· {typeLabel}</span>
    </span>
  );
}
