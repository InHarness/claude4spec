import type { ChipBrokenCategory } from '../../../core/plugin-host/host.js';
import { Badge } from '../../../host-ui-kit/actions/Badge.js';

/**
 * `rejected-slot` (0.2.88): the plugin is active and the entity may well exist,
 * but the plugin's `renderChip` threw in the host's smoke test and was
 * replaced by the host's stand-in (`RejectedSlotFallback`).
 */
export type BrokenChipCategory = ChipBrokenCategory | 'broken-reference' | 'rejected-slot';

/** The cause, as the tooltip names it (2.1.40, M19/M20). */
const CATEGORY_LABEL: Record<BrokenChipCategory, string> = {
  'inactive-plugin': 'inactive package',
  'unknown-type': 'unknown type',
  'broken-reference': 'missing entity',
  'rejected-slot': 'rejected slot',
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
 * Compact inline chip — the broken state of an inline entity chip (M51 §2).
 * 2.1.40 (M19/M20): the catalog's `Badge variant="broken"` (red ink and
 * hairline, ⚠ prefix) reading `[broken: slug]`, or `[broken: type]` where no
 * slug applies (a chat chip whose type has no module). Not clickable: no
 * handler, no button role. Why it is broken — unknown type, inactive package,
 * missing entity, rejected slot — is in the tooltip. In the Tiptap editor the
 * node view still adds the ProseMirror broken decoration around it.
 */
export function InlineBrokenChip({ category, type, slug, hint }: InlineBrokenChipProps) {
  return (
    <span
      className="inline-flex align-middle"
      title={brokenTitle(category, type, slug, hint)}
      data-broken-category={category}
    >
      <Badge variant="broken" small mono label={brokenLabel(type, slug)} />
    </span>
  );
}

interface BlockBrokenChipProps {
  category: BrokenChipCategory;
  type: string;
  slug?: string;
}

function brokenLabel(type: string, slug?: string): string {
  return `[broken: ${slug || type || '?'}]`;
}

/** The tooltip both host chips carry: WHY it is broken, which the label does not say. */
function brokenTitle(category: BrokenChipCategory, type: string, slug?: string, hint?: string): string {
  return `${CATEGORY_LABEL[category]}: ${type || '?'}${slug ? `/${slug}` : ''} — ${hint ?? CATEGORY_HINT[category]}`;
}

/**
 * The host's broken state of the block entity tags (2.1.7, M19/M20): the same
 * `[broken: <slug>]` `Badge variant="broken"` as the inline chip
 * (`[broken: <type>]` for a tag without a slug), on a line of its own, with the
 * cause in the tooltip and no click. The host draws it only when no type slot
 * can — an inactive package, an unknown type or a rejected slot; a deleted
 * entity of an active type is drawn by that type's own `null` branch.
 */
export function BlockBrokenChip({ category, type, slug }: BlockBrokenChipProps) {
  return (
    <div className="py-1" title={brokenTitle(category, type, slug)} data-broken-category={category}>
      <Badge variant="broken" mono label={brokenLabel(type, slug)} />
    </div>
  );
}
