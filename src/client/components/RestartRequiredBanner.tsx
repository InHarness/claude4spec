import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useConfig } from '../hooks/useConfig.js';
import { projectKey } from '../state/persisted.js';

const MARKER_KEY = projectKey('c4s:settings:last-restart-patch-at');
const MARKER_EVENT = 'c4s:restart-marker-changed';

function readMarker(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; data?: unknown };
    return typeof parsed?.data === 'string' ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * M26 §2 — global "Restart required" banner. Visible when the last
 * restart-required PATCH (stored in localStorage by `usePatchConfig`) is
 * newer than the running server's boot timestamp (`config.serverStartedAt`).
 *
 * No dismiss button: the banner self-clears once the server restarts and a
 * fresh `serverStartedAt` makes the comparison fall. `useConfig` is the only
 * source of `serverStartedAt`; we listen to the in-session custom event so
 * the banner appears immediately after a PATCH without waiting for a config
 * refetch.
 */
export function RestartRequiredBanner() {
  const { data: config } = useConfig();
  const [marker, setMarker] = useState<string | null>(() => readMarker());

  useEffect(() => {
    const onChange = () => setMarker(readMarker());
    window.addEventListener(MARKER_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(MARKER_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  if (!marker || !config?.serverStartedAt) return null;
  if (marker <= config.serverStartedAt) return null;

  return (
    <div
      role="status"
      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-[12px]"
      style={{
        background: 'rgba(168, 112, 51, 0.18)',
        color: '#a87033',
        borderBottom: '1px solid rgba(168, 112, 51, 0.35)',
      }}
    >
      <AlertTriangle size={14} />
      <span>
        Restart the claude4spec server to apply your latest settings changes.
      </span>
    </div>
  );
}
