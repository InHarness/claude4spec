import { createContext, useContext, type ReactNode } from 'react';
import type { EntityType } from '../../shared/entities.js';

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
  return <Ctx.Provider value={bridge}>{children}</Ctx.Provider>;
}

export function useEditorBridge(): EditorBridge | null {
  return useContext(Ctx);
}
