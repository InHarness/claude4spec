import type { ChipBrokenCategory } from '../../../core/plugin-host/host.js';

const CATEGORY_LABEL: Record<ChipBrokenCategory | 'broken-reference', string> = {
  'inactive-plugin': 'inactive plugin',
  'unknown-type': 'unknown type',
  'broken-reference': 'broken reference',
};

const CATEGORY_HINT: Record<ChipBrokenCategory | 'broken-reference', string> = {
  'inactive-plugin':
    'Type registered but disabled via config.entities. Re-enable in project config to render.',
  'unknown-type':
    'No plugin registered for this type. Likely a typo or a plugin that was removed.',
  'broken-reference':
    'Plugin active but the referenced entity does not exist (deleted or renamed).',
};

interface InlineBrokenChipProps {
  category: ChipBrokenCategory | 'broken-reference';
  type: string;
  slug?: string;
}

/** Compact inline chip — used by InlineMentionView. */
export function InlineBrokenChip({ category, type, slug }: InlineBrokenChipProps) {
  const text =
    category === 'broken-reference'
      ? `⚠ missing: ${type}/${slug ?? '?'}`
      : `⚠ ${CATEGORY_LABEL[category]}: ${type || '?'}`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px] font-mono"
      style={{
        background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
        color: 'var(--c-red, #c45a3b)',
        border: '1px solid var(--c-red, #c45a3b)',
      }}
      title={CATEGORY_HINT[category]}
    >
      {text}
    </span>
  );
}

interface BlockBrokenChipProps {
  category: ChipBrokenCategory | 'broken-reference';
  type: string;
  slug?: string;
}

/** Block-level dashed card — used by SingleElementView, ElementListView, TaggedListView. */
export function BlockBrokenChip({ category, type, slug }: BlockBrokenChipProps) {
  const heading =
    category === 'broken-reference'
      ? `Missing entity: ${type}/${slug ?? '?'}`
      : `${CATEGORY_LABEL[category]}: ${type || '?'}`;
  return (
    <div
      className="rounded-md p-3 text-[12px] font-mono"
      style={{ border: '1px dashed var(--c-red, #c45a3b)', color: 'var(--c-red, #c45a3b)' }}
      title={CATEGORY_HINT[category]}
    >
      ⚠ {heading}
      <div className="mt-1 text-[11px]" style={{ opacity: 0.85 }}>
        {CATEGORY_HINT[category]}
      </div>
    </div>
  );
}
