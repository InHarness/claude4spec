import { useCallback, useEffect, useState } from 'react';
import { getEntityDef } from '../../../entities/registry.js';
import { openEntityHandler } from '../../../entities/openEntity.js';
import { categoriseBrokenChip } from '../../../core/plugin-host/host.js';
import { useRegistryVersion } from '../../../core/plugin-host/useRegistryVersion.js';
import { useEditorBridge } from '../../../tiptap/EditorContext.js';
import { BlockBrokenChip } from '../../../tiptap/extensions/views/BrokenChip.js';
import { isMissingEntity } from '../../../state/brokenRefs.js';
import type { TagRenderProps } from '../../renders.js';
import { attr, EntityChip, useBrokenReport } from './shared.js';

/**
 * `<single_element type slug caption?/>` — the type's `renderCard` slot in the
 * page editor, with the caption under the card; a chip (`renderChip`) inline.
 * A broken one is the broken-reference card: one contract for every type.
 */
export function SingleElementRender({ attrs, variant, onAttrsChange, onBrokenChange }: TagRenderProps) {
  useRegistryVersion();
  const type = attr(attrs, 'type');
  const slug = attr(attrs, 'slug');
  // Per-reference prose, absent unless the tag carried it.
  const caption = attrs.caption ? String(attrs.caption) : undefined;
  if (variant === 'inline') {
    return <EntityChip type={type} slug={slug} caption={caption} onBroken={onBrokenChange} />;
  }
  return (
    <SingleElementCard
      type={type}
      slug={slug}
      caption={caption}
      onCaptionChange={onAttrsChange ? (next) => onAttrsChange({ ...attrs, caption: next }) : undefined}
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
  const bridge = useEditorBridge();
  const open = openEntityHandler(type, slug, bridge, caption);
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
      onCaptionChange={onCaptionChange ?? (() => {})}
      onMissing={onMissing}
    />
  );
}

function CardResolver({
  type,
  slug,
  caption,
  onOpen,
  onCaptionChange,
  onMissing,
}: {
  type: string;
  slug: string;
  caption?: string;
  onOpen?: () => void;
  onCaptionChange: (caption: string | null) => void;
  onMissing: (missing: boolean) => void;
}) {
  const def = getEntityDef(type)!;
  const result = def.useGetBySlug(slug);
  const { data, isLoading } = result;
  const missing = isMissingEntity(result);
  useEffect(() => {
    onMissing(missing);
  }, [missing, onMissing]);
  if (isLoading && data === undefined) {
    return (
      <div
        className="rounded-md p-3 text-[12.5px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        Loading {def.label} {slug}…
      </div>
    );
  }
  const Card = def.renderCard;
  return (
    <Card
      slug={slug}
      entity={data ?? null}
      {...(caption ? { caption } : {})}
      onOpen={onOpen}
      onCaptionChange={onCaptionChange}
    />
  );
}
