import { useCallback, useState } from 'react';
import { getEntityDef } from '../../../entities/registry.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { CardResolver } from '../../../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { editorBridge } from '../../../runtime/editor-bridge.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, EntityChip, useBrokenReport } from './shared.js';

/**
 * `<single_element type slug caption?/>` — the type's `renderCard` slot in the
 * page editor, with the caption under the card; a chip (`renderChip`) inline.
 * A broken one is the broken-reference card: one contract for every type.
 *
 * 2.1.63 (M13 chipprops) — the card's `onCaptionChange` writes the `caption`
 * ATTRIBUTE of this tag (through `onAttrsChange`, the node view's
 * `updateAttributes`), never the entity; where the tag is read-only
 * (`onAttrsChange` absent) the card gets no callback.
 */
export function SingleElementRender({ attrs, variant, onAttrsChange, onBrokenChange }: TagRenderProps) {
  useRegistryVersion();
  const type = attr(attrs, 'type');
  const slug = attr(attrs, 'slug');
  // Per-reference prose, absent unless the tag carried it.
  const caption = attrs.caption ? String(attrs.caption) : undefined;
  // Inline (every chat chip, and an inline tag in the editor) is a chip: no card, no caption callback.
  if (variant === 'inline') {
    return <EntityChip type={type} slug={slug} caption={caption} onBroken={onBrokenChange} />;
  }
  return (
    <SingleElementCard
      type={type}
      slug={slug}
      caption={caption}
      onCaptionChange={
        // An empty caption is no caption: the attribute goes, it never becomes `caption=""`.
        onAttrsChange ? (next) => onAttrsChange({ ...attrs, caption: next || null }) : undefined
      }
      onBrokenChange={onBrokenChange}
    />
  );
}

function SingleElementCard({
  type,
  slug,
  caption,
  onCaptionChange,
  onBrokenChange,
}: {
  type: string;
  slug: string;
  caption?: string;
  onCaptionChange?: (caption: string | null) => void;
  onBrokenChange: TagRenderProps['onBrokenChange'];
}) {
  const def = getEntityDef(type);
  const open = openEntityHandler(type, slug, editorBridge, caption);
  const [missing, setMissing] = useState(false);
  const onMissing = useCallback((m: boolean) => setMissing(m), []);
  useBrokenReport(onBrokenChange, !def, !!def && missing);

  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <BlockBrokenChip category={category} type={type} slug={slug} />;
  }
  return (
    <CardResolver
      type={type}
      slug={slug}
      caption={caption}
      onOpen={open}
      onCaptionChange={onCaptionChange}
      onMissing={onMissing}
    />
  );
}
