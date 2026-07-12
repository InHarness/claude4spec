/**
 * M33 "Option B" shared-singleton shims.
 *
 * The host publishes its OWN already-imported module namespaces onto
 * `window.__c4s_shared` (see client `shared-runtime.ts`). The import map points
 * each bare peer specifier at one of these tiny server-served ESM modules, which
 * re-export from that global. A plugin's `import "react"` therefore resolves to
 * the host's live React reconciler — not a second copy.
 *
 * The named-export list per peer is enumerated from the actually-installed
 * package at runtime (cached), so the shim never drifts from the host's exports
 * — avoiding a brittle hand-maintained list. `@c4s/plugin-runtime` is our own
 * fixed surface (and a browser module the server can't import), so it is listed
 * explicitly.
 */

import {
  SHARED_PEER_SPECIFIERS,
  PLUGIN_RUNTIME_EXPORT_NAMES,
  PLUGIN_RUNTIME_UI_EXPORT_NAMES,
} from '../../../shared/plugin-host/frontend-manifest.js';
import type { SharedPeerSpecifier } from '../../../shared/plugin-host/frontend-manifest.js';

/** Bare specifier → URL slug used in `/api/plugins/runtime/<slug>.js`. */
export const PEER_SLUG: Record<SharedPeerSpecifier, string> = {
  react: 'react',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react/jsx-dev-runtime': 'react-jsx-dev-runtime',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom-client',
  '@tiptap/core': 'tiptap-core',
  '@tanstack/react-query': 'react-query',
  '@tanstack/react-router': 'react-router',
  'lucide-react': 'lucide-react',
  '@c4s/plugin-runtime': 'plugin-runtime',
  '@c4s/plugin-runtime/ui': 'plugin-runtime-ui',
};

const SLUG_PEER: Record<string, SharedPeerSpecifier> = Object.fromEntries(
  SHARED_PEER_SPECIFIERS.map((spec) => [PEER_SLUG[spec], spec]),
) as Record<string, SharedPeerSpecifier>;

/**
 * The named exports of our own client surfaces — browser modules the server
 * can't introspect. Single source of truth lives in shared; parity tests
 * (plugin-runtime.test.ts, plugin-runtime-ui.test.ts) guard them against drift.
 */
const PLUGIN_RUNTIME_EXPORTS: readonly string[] = PLUGIN_RUNTIME_EXPORT_NAMES;
const PLUGIN_RUNTIME_UI_EXPORTS: readonly string[] = PLUGIN_RUNTIME_UI_EXPORT_NAMES;

/** Build the import map injected into the page. Bare specifier → shim URL. */
export function buildImportMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const spec of SHARED_PEER_SPECIFIERS) {
    map[spec] = `/api/plugins/runtime/${PEER_SLUG[spec]}.js`;
  }
  return map;
}

const ID_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderShimSource(specifier: string, names: string[]): string {
  const accessor = `globalThis.__c4s_shared[${JSON.stringify(specifier)}]`;
  const lines = [
    `// Auto-generated host singleton shim for "${specifier}".`,
    `const __m = ${accessor};`,
    `if (!__m) throw new Error('c4s plugin-runtime: missing shared singleton "${specifier}" — host did not publish window.__c4s_shared');`,
    `export default (__m && __m.default !== undefined ? __m.default : __m);`,
  ];
  for (const name of names) {
    if (name === 'default' || name === '__esModule' || !ID_RE.test(name)) continue;
    lines.push(`export const ${name} = __m[${JSON.stringify(name)}];`);
  }
  return lines.join('\n') + '\n';
}

const shimCache = new Map<string, string>();

/**
 * Render (and cache) the ESM shim for one runtime slug. Returns `null` for an
 * unknown slug. Never throws — a peer whose package can't be introspected
 * server-side falls back to a default-only shim.
 */
export async function getRuntimeShim(slug: string): Promise<string | null> {
  const cached = shimCache.get(slug);
  if (cached) return cached;

  const specifier = SLUG_PEER[slug];
  if (!specifier) return null;

  let names: string[];
  if (specifier === '@c4s/plugin-runtime') {
    names = [...PLUGIN_RUNTIME_EXPORTS];
  } else if (specifier === '@c4s/plugin-runtime/ui') {
    names = [...PLUGIN_RUNTIME_UI_EXPORTS];
  } else {
    try {
      const ns = (await import(specifier)) as Record<string, unknown>;
      names = Object.keys(ns);
    } catch (err) {
      console.warn(
        `[plugin-runtime] could not introspect "${specifier}" for shim exports: ${(err as Error).message}`,
      );
      names = [];
    }
  }

  const source = renderShimSource(specifier, names);
  shimCache.set(slug, source);
  return source;
}
