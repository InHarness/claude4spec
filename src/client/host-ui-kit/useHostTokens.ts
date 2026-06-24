import { useEffect, useState } from 'react';
import { readHostTokens, type HostTokenName } from './tokens.js';

/**
 * React hook returning the host's resolved `--c-*` tokens for the active theme.
 *
 * It reads the computed values off `<html>` and re-reads whenever the M26 mode
 * changes — observed via the `.dark` class toggle on `document.documentElement`
 * (the same signal `state/tweaks.ts` writes from the `localStorage` preference).
 * Using a `MutationObserver` keeps it correct regardless of effect ordering, so
 * the returned object always matches the painted theme.
 *
 * Plugins styling with `var(--c-*)` do NOT need this hook — the CSS variables
 * cascade on their own. It exists for the rare case a plugin needs the resolved
 * values in JS (e.g. to paint a canvas).
 */
export function useHostTokens(): Record<HostTokenName, string> {
  const [tokens, setTokens] = useState(readHostTokens);

  useEffect(() => {
    const root = document.documentElement;
    const refresh = () => setTokens(readHostTokens());
    // Re-read after mount (covers the first paint) and on every theme toggle.
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return tokens;
}
