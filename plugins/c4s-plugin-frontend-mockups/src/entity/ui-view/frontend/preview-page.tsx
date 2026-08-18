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
import { API_BASE } from '../../../frontend-kit/api-core.js';
import { useUiView } from './hooks.js';

/**
 * Built once, for both the frame and the link — they must never drift apart.
 * Root-absolute (`API_BASE` is `/api/projects/<id>`), so it resolves the same
 * as an `href` from anywhere in the route space as it does as an iframe `src`.
 */
function mockupUrl(slug: string): string {
  return `${API_BASE}/ui-views/${encodeURIComponent(slug)}/mockup`;
}

export function UiViewPreview({ slug }: { slug: string }) {
  const { data: view } = useUiView(slug);

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: 'var(--c-panel)' }}>
      <iframe
        // A REMOUNT KEY, not decoration. `mockupHtml` is agent-written and not
        // editable anywhere in the UI, so it changes under a mounted frame.
        // React keeps the same element while `src` is unchanged and the browser
        // then makes no request at all — which is why the route's
        // `Cache-Control: no-store` cannot help. Keying on `updatedAt` forces a
        // fresh element, and with it a fresh GET.
        key={`${slug}:${view?.updatedAt ?? ''}`}
        title={`Mockup preview: ${slug}`}
        src={mockupUrl(slug)}
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
 * Styled like an inactive `SegmentButton` but deliberately NOT inside the
 * switcher's `ButtonGroup`: it is an action, not a view, and a segment there
 * would carry an `aria-pressed` that claims otherwise.
 */
export function UiViewOpenExternal({ slug }: { slug: string }) {
  return (
    <a
      href={mockupUrl(slug)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the mockup in a new tab"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition"
      style={{ color: 'var(--c-ink)', border: '1px solid transparent' }}
    >
      <ExternalLink size={12} />
      Open
    </a>
  );
}
