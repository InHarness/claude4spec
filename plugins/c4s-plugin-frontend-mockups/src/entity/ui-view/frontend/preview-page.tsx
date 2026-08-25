/**
 * The `preview` view — the mockup document, given the whole pane.
 *
 * It started life as a 420px `FieldRow` inside the detail form (0.2.28) and
 * moved here the same release: a SCREEN mockup is the wrong shape for a form
 * row, and the thing being previewed is a view of the entity rather than one
 * of its fields.
 *
 * Nothing is rendered from `mockupHtml` here — the frame's `src` is the
 * document route, the same address a person can paste into the address bar,
 * which is a REQUIREMENT and not a side effect. `UiViewOpenExternal` below is
 * that requirement made reachable: the same URL, opened top-level. Isolation
 * when that happens comes from that route's `Content-Security-Policy: sandbox`
 * response header and from nothing else; the `sandbox` ATTRIBUTE is defence in
 * depth, because an attribute only exists inside an `<iframe>` and says
 * nothing about a top-level open.
 *
 * Deliberately WITHOUT `allow-same-origin`: the document is agent-authored HTML
 * served from our own origin, so it gets an opaque one. `allow-forms` and
 * `allow-modals` are kept for the same reason the header keeps them — without
 * them a mockup with a form or a `confirm()` breaks in silence.
 *
 * There is no client-side empty state, and the tab is never disabled: a view
 * with no mockup — which is most of them, since `mockupHtml` is optional and
 * agent-written — still answers `200` with a placeholder, so the empty state
 * shows up INSIDE the frame rather than as a browser error page or a greyed-out
 * segment that flickers while the record loads.
 */

import { ExternalLink } from 'lucide-react';
import { FormField, SegmentedControlTabs } from '@c4s/plugin-runtime/ui';
import { API_BASE } from '../../../frontend-kit/api-core.js';
import { useDesignSystem } from '../../design-system/frontend/hooks.js';
import { useUiView } from './hooks.js';

/**
 * The preview VARIANT — one value per axis, or `undefined` for that axis's
 * default. It arrives from the route's search params and goes back there; it is
 * never component state, because a variant has to survive a refresh and be
 * sendable as a link.
 */
export interface PreviewVariant {
  state?: string;
  mode?: string;
}

/**
 * Built once, for the frame, the link AND the variant box — they must never
 * drift apart. Root-absolute (`API_BASE` is `/api/projects/<id>`), so it
 * resolves the same as an `href` from anywhere in the route space as it does as
 * an iframe `src`.
 *
 * An axis at its default contributes NO parameter. The document has no sentinel
 * value for "default variant" — absence is the signal — so emitting `state=`
 * empty would be a different request than the one the box means.
 */
function mockupUrl(slug: string, variant: PreviewVariant = {}): string {
  const query = new URLSearchParams();
  if (variant.state) query.set('state', variant.state);
  if (variant.mode) query.set('mode', variant.mode);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return `${API_BASE}/ui-views/${encodeURIComponent(slug)}/mockup${suffix}`;
}

/** Past this many options a row of segments stops being readable and becomes a select. */
const SEGMENTS_MAX = 5;

/** The synthetic first option of each axis — see `VariantAxis`. */
const DEFAULT_STATE = '__default__';
const BASE_MODE = '__base__';

/**
 * One axis of the variant box.
 *
 * The SYNTHETIC FIRST OPTION is the whole subtlety here: neither collection
 * contains an entry for its default — `states[]` enumerates deviations from the
 * unattributed mockup, and a design system's `modes[]` enumerates overrides of
 * its base tokens. So "Default"/"Base" is an option this component invents, and
 * choosing it means emitting no query param at all.
 *
 * Both shapes come from the catalog (`SegmentedControlTabs`, `FormField` + a
 * select). Nothing here is host-local, and `ModeSwitcher` from the
 * design-system detail panel is deliberately NOT reused: it is an editor
 * control with an "Add mode" affordance, it is private to that panel, and
 * vendoring a copy of a catalog control is the anti-pattern `EntityViewSwitcher`
 * was written to remove.
 */
function VariantAxis({
  label,
  defaultId,
  defaultLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  defaultId: string;
  defaultLabel: string;
  options: { id: string; label: string }[];
  value: string | undefined;
  onChange(next: string | undefined): void;
}) {
  // DEDUPED BY ID, because `states[]` is a value collection with no uniqueness
  // constraint anywhere: `identity: ['name']` governs how the delta MATCHES
  // items, not what the store accepts, so two states named `empty` round-trip
  // fine. Rendering both gives two segments with the same React key and the
  // same `?state=`, i.e. a control where one of two identical-looking buttons
  // silently does nothing. The first entry wins — the same one the mockup's
  // selector would resolve to.
  const all = [{ id: defaultId, label: defaultLabel }, ...options].filter(
    (o, i, xs) => xs.findIndex((x) => x.id === o.id) === i,
  );
  const active = value ?? defaultId;
  const pick = (id: string) => onChange(id === defaultId ? undefined : id);

  if (all.length > SEGMENTS_MAX) {
    return (
      <FormField label={label}>
        <select
          value={active}
          onChange={(e) => pick(e.target.value)}
          className="w-full rounded px-2 py-1 text-[12px]"
          style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair)',
            color: 'var(--c-ink)',
          }}
        >
          {all.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </FormField>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
        {label}
      </span>
      <SegmentedControlTabs tabs={all} active={active} onChange={pick} />
    </div>
  );
}

/**
 * The variant options box — NATIVE HOST UI, outside the iframe.
 *
 * Never an injected script: the document has an opaque origin (no
 * `allow-same-origin`), so the host cannot reach into its DOM even if it wanted
 * to — which is also why changing a variant costs a full frame reload. That
 * cost is accepted deliberately rather than worked around; the alternative
 * would be giving up the isolation the whole route is built on.
 *
 * AN AXIS WITH NOTHING TO SHOW DOES NOT RENDER. A view that declares no states
 * gets no state axis; a view with no design system, or one whose design system
 * has no modes, gets no mode axis. A view with neither looks exactly as it did
 * before this box existed — no empty chrome, no disabled control.
 */
export function UiViewVariantBox({
  slug,
  variant,
  onChange,
}: {
  slug: string;
  variant: PreviewVariant;
  onChange(next: PreviewVariant): void;
}) {
  const { data: view } = useUiView(slug);
  const { data: designSystem } = useDesignSystem(view?.designSystemSlug ?? null);

  const states = view?.states ?? [];
  const modes = designSystem?.modes ?? [];
  if (states.length === 0 && modes.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-4 px-4 py-2"
      style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-card)' }}
    >
      {states.length > 0 && (
        <VariantAxis
          label="State"
          defaultId={DEFAULT_STATE}
          defaultLabel="Default"
          options={states.map((s) => ({ id: s.name, label: s.label || s.name }))}
          value={variant.state}
          onChange={(state) => onChange({ ...variant, state })}
        />
      )}
      {modes.length > 0 && (
        <VariantAxis
          label="Mode"
          defaultId={BASE_MODE}
          defaultLabel="Base"
          options={modes.map((m) => ({ id: m.name, label: m.name }))}
          value={variant.mode}
          onChange={(mode) => onChange({ ...variant, mode })}
        />
      )}
    </div>
  );
}

export function UiViewPreview({
  slug,
  variant = {},
  onVariantChange,
}: {
  slug: string;
  variant?: PreviewVariant;
  onVariantChange?(next: PreviewVariant): void;
}) {
  const { data: view } = useUiView(slug);

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: 'var(--c-panel)' }}>
      {onVariantChange && (
        <UiViewVariantBox slug={slug} variant={variant} onChange={onVariantChange} />
      )}
      <iframe
        // A REMOUNT KEY, not decoration, and it carries the VARIANT for a
        // second reason on top of the first.
        //
        // `mockupHtml` is agent-written and not editable anywhere in the UI, so
        // it changes under a mounted frame. React keeps the same element while
        // `src` is unchanged and the browser then makes no request at all —
        // which is why the route's `Cache-Control: no-store` cannot help.
        // `updatedAt` forces a fresh element, and with it a fresh GET.
        //
        // The variant is in the key because a `src` change on a MOUNTED iframe
        // is a navigation, and an iframe navigation pushes onto the joint
        // session history. The route picks variants with `replace: true`
        // precisely so that flipping through them does not fill up Back; a
        // live-navigating frame would put every one of those entries back,
        // under an address bar that never moved. Remounting instead makes each
        // switch a new element loading its initial `src`, which is not history.
        key={`${slug}:${view?.updatedAt ?? ''}:${variant.state ?? ''}:${variant.mode ?? ''}`}
        title={`Mockup preview: ${slug}`}
        src={mockupUrl(slug, variant)}
        sandbox="allow-scripts allow-forms allow-modals"
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}

/**
 * "Open" — the same document, top-level, in a new tab.
 *
 * An anchor rather than a button calling `window.open`: middle-click,
 * cmd-click, "open in new window" and "copy link address" all come for free,
 * and no popup blocker weighs in. `rel` is belt-and-braces — the opened
 * document is agent-authored HTML and never gets a handle back here.
 *
 * This is the case the isolation contract was written for. The frame's
 * `sandbox` ATTRIBUTE does not travel with the link — an attribute only exists
 * inside an `<iframe>` — so the opaque origin the new tab gets comes from the
 * route's `Content-Security-Policy: sandbox` response header, and from nothing
 * else.
 *
 * Styled like the kit's inactive tab — `--c-muted`, no border, no background — but
 * deliberately NOT inside the switcher's
 * `SegmentedControlTabs`: it is an action, not a view, and a segment there would
 * carry an `aria-selected` — and a `role="tab"` — that claim otherwise.
 */
export function UiViewOpenExternal({
  slug,
  variant = {},
}: {
  slug: string;
  variant?: PreviewVariant;
}) {
  return (
    <a
      // The SAME URL the frame is showing, variant included — from the same
      // builder, so the two cannot drift. A reviewer opens what they are
      // looking at, not the default variant of it.
      href={mockupUrl(slug, variant)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the mockup in a new tab"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition"
      style={{ color: 'var(--c-muted)' }}
    >
      <ExternalLink size={12} />
      Open
    </a>
  );
}
