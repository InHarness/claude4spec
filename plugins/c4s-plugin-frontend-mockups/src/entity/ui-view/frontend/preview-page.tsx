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
 * which is a REQUIREMENT and not a side effect. Isolation when that happens
 * comes from that route's `Content-Security-Policy: sandbox` response header
 * and from nothing else; the `sandbox` ATTRIBUTE below is defence in depth,
 * because an attribute only exists inside an `<iframe>` and says nothing about
 * a top-level open.
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

import { API_BASE } from '../../../frontend-kit/api-core.js';
import { useUiView } from './hooks.js';

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
        src={`${API_BASE}/ui-views/${encodeURIComponent(slug)}/mockup`}
        sandbox="allow-scripts allow-forms allow-modals"
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}
