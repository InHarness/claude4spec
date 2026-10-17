import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { editorBridgeRegistry, type EditorBridgeHolder } from '../runtime/editor-bridge.js';

export interface EditorBridge {
  openEntity: (type: EntityType, slug: string) => void;
  openSection: (pagePath: string, anchor: string) => void;
}

const Ctx = createContext<EditorBridge | null>(null);
/** Carries the provider's registered holder; read only by the singleton's tree walk. */
const HolderCtx = createContext<EditorBridgeHolder | null>(null);

/**
 * Supplies one pipeline's concrete `EditorBridge` (the editor's, or the chat's
 * chat-aware one) to its subtree — M20 `nvc5wy2p`.
 *
 * Chips do not read this context: they call the `editorBridge` singleton of
 * `@c4s/plugin-runtime`, which delegates to the NEAREST provider (2.1.28,
 * `m20l11sc`). To make that possible the provider registers a stable holder of
 * its bridge with the singleton while mounted and puts the same holder into a
 * context of its own; on a click / key press the singleton walks the React
 * tree up from the event target (portals included) to the innermost
 * registered holder. The provider renders no DOM element of its own — the
 * page editor keeps exactly the DOM it had without it.
 */
export function EditorBridgeProvider({
  bridge,
  children,
}: {
  bridge: EditorBridge;
  children: ReactNode;
}) {
  // Stable for the provider's lifetime: the singleton recognises the provider
  // by this object, and a re-render with a new bridge only swaps `current`.
  const holder = useRef<EditorBridgeHolder>({ current: bridge }).current;
  holder.current = bridge;
  useEffect(() => {
    const id = editorBridgeRegistry.register(holder);
    return () => editorBridgeRegistry.unregister(id);
  }, [holder]);
  return (
    <Ctx.Provider value={bridge}>
      <HolderCtx.Provider value={holder}>{children}</HolderCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * Host-internal: host components that need the bridge object itself (e.g.
 * `DocEditor`, which re-provides the ambient bridge to its own subtree). Not
 * part of `@c4s/plugin-runtime`; chips navigate through the `editorBridge`
 * singleton instead.
 */
export function useEditorBridge(): EditorBridge | null {
  return useContext(Ctx);
}
