import type { MouseEvent } from 'react';
import { Link2, type LucideIcon } from 'lucide-react';
import { withStability } from '../stability.js';
import { Badge } from './Badge.js';
import { openEntityHandler } from '../../entities/openEntity.js';
import { editorBridge } from '../../runtime/editor-bridge.js';

/**
 * 2.1.41 (M13 / M34) — one entry of a `refLookup` map, keyed `${type}:${slug}`
 * of the TARGET record. The host builds it (the row / card resolver, or
 * `useRefLookup`); `EntityRefValue` only draws it.
 *
 * The one declaration of this type: `@c4s/plugin-runtime/ui` exports it beside
 * `EntityRefValue`, and the root of `@c4s/plugin-runtime` re-exports the same
 * type because `useRefLookup` returns it.
 */
export interface RefLookupEntry {
  /** The target record's display name (its slug in a broken entry). */
  title: string;
  /** The target type's icon from the HOST's type registry (a fallback for a type without a tab). */
  icon: LucideIcon;
  /** deleted entity | inactive package | unknown type. */
  broken?: 'deleted' | 'inactive' | 'unknown';
}

/**
 * The icon of a target type without a sidebar tab (a hidden type), and of a
 * broken entry. A constant of this component, not a bridge lookup.
 */
export const ENTITY_REF_FALLBACK_ICON: LucideIcon = Link2;

export interface EntityRefValueProps {
  /** Label before the value — used inline in a list row. A detail `field-row` passes none. */
  label?: string;
  /** Target record's type. */
  type: string;
  /** Target record's slug — what the broken state shows. */
  slug: string;
  /**
   * The `refLookup` entry under `${type}:${slug}`; `undefined` or `broken` draws the
   * broken state. Required — pass `undefined` explicitly for a missing entry.
   *
   * Named `refEntry`, not `ref` as M34 spells it: React 18 strips `ref` from a
   * function component's props, so a `ref` prop would always arrive `undefined`
   * and every value would draw as broken.
   */
  refEntry: RefLookupEntry | undefined;
  /** Called on click, after the target record is opened. */
  onOpen?: () => void;
}

const BROKEN_REASON: Record<NonNullable<RefLookupEntry['broken']>, string> = {
  deleted: 'deleted entity',
  inactive: 'inactive package',
  unknown: 'unknown type',
};

/**
 * `EntityRefValue` (Actions, `experimental`, presentational, composes `badge`)
 * — a field VALUE that is a link to a record: the target type's icon and the
 * record's display name, in one line after an optional label.
 *
 * Click: `editorBridge.openEntity(type, slug)` — a hidden type opens its
 * `<type>-expand` window, as a chip does — then `onOpen?.()`; propagation is
 * stopped, so inside a list row it never opens the row. Broken (`refEntry`
 * absent or `refEntry.broken`): a non-clickable `Badge variant="broken"` showing the slug,
 * the cause in its tooltip. Fetches nothing (title, icon and cause arrive in
 * `refEntry`), so it has no loading state; edits nothing — that is a picker's role.
 *
 * Tag of a record → `TagChip`; a distinguishing value (enum, count, state) →
 * `Badge`; a value that IS a link to a record → `EntityRefValue`; an action or
 * a link without a record identity ("+N") → ghost `ActionButton`.
 */
function EntityRefValueImpl({ label, type, slug, refEntry: entry, onOpen }: EntityRefValueProps) {
  const labelNode = label ? (
    <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
      {label}
    </span>
  ) : null;

  if (!entry || entry.broken) {
    const reason = entry?.broken ? BROKEN_REASON[entry.broken] : 'record not found';
    return (
      <span className="entity-ref-value inline-flex items-center gap-1.5" data-broken={entry?.broken ?? 'missing'}>
        {labelNode}
        <span className="inline-flex items-center" title={`${type}:${slug} — ${reason}`}>
          <Badge label={slug} variant="broken" small />
        </span>
      </span>
    );
  }

  const Icon = entry.icon;
  const open = openEntityHandler(type, slug, editorBridge);
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    open?.();
    onOpen?.();
  };
  return (
    <span className="entity-ref-value inline-flex items-center gap-1.5">
      {labelNode}
      <button
        type="button"
        onClick={onClick}
        title={`Open ${type} ${slug}`}
        className="inline-flex items-center gap-1 rounded text-[12px] hover:underline"
        style={{ color: 'var(--c-accent)', cursor: 'pointer' }}
      >
        <Icon size={12} aria-hidden />
        <span>{entry.title}</span>
      </button>
    </span>
  );
}

export const EntityRefValue = withStability(EntityRefValueImpl, 'experimental');
