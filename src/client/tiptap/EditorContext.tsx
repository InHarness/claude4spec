import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { EntityType } from '../../shared/entities.js';
import { editorBridge as bridgeSingleton } from '../runtime/editor-bridge.js';

export interface EditorBridge {
  openEntity: (type: EntityType, slug: string) => void;
  openSection: (pagePath: string, anchor: string) => void;
}

const Ctx = createContext<EditorBridge | null>(null);

export function EditorBridgeProvider({
  bridge,
  children,
}: {
  bridge: EditorBridge;
  children: ReactNode;
}) {
  // M33: also publish the live bridge into the process-wide singleton so runtime
  // plugins (which render outside this provider's tree) can drive navigation.
  useEffect(() => {
    bridgeSingleton.set(bridge);
    return () => bridgeSingleton.set(null);
  }, [bridge]);
  return <Ctx.Provider value={bridge}>{children}</Ctx.Provider>;
}

export function useEditorBridge(): EditorBridge | null {
  return useContext(Ctx);
}
