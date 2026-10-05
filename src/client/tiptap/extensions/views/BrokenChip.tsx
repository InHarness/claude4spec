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

/**
 * Compact inline chip — the broken state of an inline entity chip (M51 §2):
 * red, reading `[broken: slug]`, or `[broken: type]` where no slug applies
 * (a chat chip whose type has no module). Why it is broken — unknown type,
 * inactive plugin, missing entity, rejected slot — is in the tooltip.
 */
export function InlineBrokenChip({ category, type, slug, hint }: InlineBrokenChipProps) {
  const text = `[broken: ${slug || type || '?'}]`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px] font-mono"
      style={{
        background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
        color: 'var(--c-red, #c45a3b)',
        border: '1px solid var(--c-red, #c45a3b)',
      }}
      title={brokenTitle(category, type, slug, hint)}
      data-broken-category={category}
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

/** The tooltip both host chips carry: WHY it is broken, which the label does not say. */
function brokenTitle(category: BrokenChipCategory, type: string, slug?: string, hint?: string): string {
  return `${CATEGORY_LABEL[category]}: ${type || '?'}${slug ? `/${slug}` : ''} — ${hint ?? CATEGORY_HINT[category]}`;
}

/**
 * Block-level dashed card — the host's broken state of the block entity tags
 * (2.1.7, M19/M20): the same `[broken: <slug>]` label as the inline chip
 * (`[broken: <type>]` for a tag without a slug), red, with the cause in the
 * tooltip. The host draws it only when no type slot can — an inactive plugin,
 * an unknown type or a rejected slot; a deleted entity of an active type is
 * drawn by that type's own `null` branch.
 */
export function BlockBrokenChip({ category, type, slug }: BlockBrokenChipProps) {
  return (
    <div
      className="rounded-md px-3 py-2 text-[12px] font-mono"
      style={{
        border: '1px dashed var(--c-red, #c45a3b)',
        background: 'var(--c-red-soft, rgba(196,90,59,0.14))',
        color: 'var(--c-red, #c45a3b)',
      }}
      title={brokenTitle(category, type, slug)}
      data-broken-category={category}
    >
      {`[broken: ${slug || type || '?'}]`}
    </div>
  );
}
