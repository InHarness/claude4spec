import type { ChipBrokenCategory } from '../../../core/plugin-host/host.js';

/**
 * `rejected-slot` (0.2.88): the plugin is active and the entity may well exist,
 * but the plugin's `renderChip` threw in the host's smoke test and was
 * replaced by the host's stand-in (`RejectedSlotFallback`).
 */
export type BrokenChipCategory = ChipBrokenCategory | 'broken-reference' | 'rejected-slot';

const CATEGORY_LABEL: Record<BrokenChipCategory, string> = {
  'inactive-plugin': 'inactive plugin',
  'unknown-type': 'unknown type',
  'broken-reference': 'broken reference',
  'rejected-slot': 'broken',
};

const CATEGORY_HINT: Record<BrokenChipCategory, string> = {
  'inactive-plugin':
    'Type registered but disabled via config.entities. Re-enable in project config to render.',
  'unknown-type':
    'No plugin registered for this type. Likely a typo or a plugin that was removed.',
  'broken-reference':
    'Plugin active but the referenced entity does not exist (deleted or renamed).',
  'rejected-slot': 'The plugin\'s chip renderer threw and was rejected by the plugin host.',
};

interface InlineBrokenChipProps {
  category: BrokenChipCategory;
  type: string;
  slug?: string;
  /** Overrides the category's generic tooltip (e.g. with the rejection reason). */
  hint?: string;
}

/** Compact inline chip — used by InlineMentionView and RejectedSlotFallback. */
export function InlineBrokenChip({ category, type, slug, hint }: InlineBrokenChipProps) {
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
      title={hint ?? CATEGORY_HINT[category]}
    >
      {text}
    </span>
  );
}

interface BlockBrokenChipProps {
  category: BrokenChipCategory;
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
