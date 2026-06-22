/**
 * M33: process-wide EditorBridge singleton.
 *
 * The host's bridge (open an entity / jump to a section) was previously only a
 * React context (`useEditorBridge`). Runtime plugins render chips/NodeViews
 * outside the host's component tree path that wired that context, so they need a
 * plain singleton to call. `EditorBridgeProvider` pushes its live impl here on
 * mount; the singleton forwards to it. Exposed to plugins through
 * `@c4s/plugin-runtime`.
 */

import type { EditorBridge } from '../tiptap/EditorContext.js';
import type { EntityType } from '../../shared/entities.js';

let current: EditorBridge | null = null;

export const editorBridge = {
  /** Wire the active host bridge implementation (called by EditorBridgeProvider). */
  set(impl: EditorBridge | null): void {
    current = impl;
  },
  openEntity(type: EntityType, slug: string): void {
    current?.openEntity(type, slug);
  },
  openSection(pagePath: string, anchor: string): void {
    current?.openSection(pagePath, anchor);
  },
};

export type EditorBridgeSingleton = typeof editorBridge;
