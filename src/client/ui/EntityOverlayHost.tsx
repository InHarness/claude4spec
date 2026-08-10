import { useEffect, useState } from 'react';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { UI_EVENTS, type EntityOverlayRequest } from './events.js';

/**
 * 0.2.15 — the single listener for `openEntityOverlay`, mounted once beside
 * `ModalHost`.
 *
 * A hidden ("embed-only") entity type has no detail route, so its chip and card
 * open a read-only fullscreen surface instead of navigating. Which surface is
 * the TYPE's business, not this component's: it resolves `renderOverlay` off the
 * client plugin host and renders it. A request naming a type that is unknown,
 * inactive, or not embed-only resolves to nothing and is dropped — which is
 * exactly the broken-chip case, where clicking must do nothing rather than
 * open an empty shell.
 */
export function EntityOverlayHost() {
  const [request, setRequest] = useState<EntityOverlayRequest | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setRequest((e as CustomEvent<EntityOverlayRequest>).detail);
    };
    window.addEventListener(UI_EVENTS.ENTITY_OVERLAY, handler as EventListener);
    return () => window.removeEventListener(UI_EVENTS.ENTITY_OVERLAY, handler as EventListener);
  }, []);

  if (!request) return null;
  const Overlay = clientPluginHost.getEntity(request.type)?.renderOverlay;
  if (!Overlay) return null;

  return (
    <Overlay
      slug={request.slug}
      {...(request.caption ? { caption: request.caption } : {})}
      onClose={() => setRequest(null)}
    />
  );
}
