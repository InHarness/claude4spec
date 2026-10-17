import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { editorBridgeRegistry } from '../runtime/editor-bridge.js';

export interface EditorBridge {
  openEntity: (type: EntityType, slug: string) => void;
  openSection: (pagePath: string, anchor: string) => void;
}

const Ctx = createContext<EditorBridge | null>(null);

/**
 * Supplies one pipeline's concrete `EditorBridge` (the editor's, or the chat's
 * chat-aware one) to its subtree — M20 `nvc5wy2p`.
 *
 * Chips do not read this context: they call the `editorBridge` singleton of
 * `@c4s/plugin-runtime`, which delegates to the NEAREST provider (2.1.28,
 * `m20l11sc`). To make that possible the provider registers its bridge with the
 * singleton while mounted, and marks itself active in the capture phase of any
 * click / key press inside its React subtree (portals included) — the innermost
 * provider marks itself last, so the chip's handler reaches it. The wrapper is
 * `display: contents`, so it adds no box to the layout.
 */
export function EditorBridgeProvider({
  bridge,
  children,
}: {
  bridge: EditorBridge;
  children: ReactNode;
}) {
  const idRef = useRef<number | null>(null);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  useEffect(() => {
    const id = editorBridgeRegistry.register(bridgeRef.current);
    idRef.current = id;
    return () => {
      editorBridgeRegistry.unregister(id);
      idRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (idRef.current !== null) editorBridgeRegistry.update(idRef.current, bridge);
  }, [bridge]);
  const activate = () => {
    if (idRef.current !== null) editorBridgeRegistry.activate(idRef.current);
  };
  return (
    <Ctx.Provider value={bridge}>
      <div
        data-editor-bridge-provider=""
        style={{ display: 'contents' }}
        onClickCapture={activate}
        onKeyDownCapture={activate}
      >
        {children}
      </div>
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
