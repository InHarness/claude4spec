import type { ComponentType } from 'react';
import { isRegisteredXmlTag } from '../../shared/xml-markup/registry.js';

/**
 * M51 — render assignment, browser side. The module that owns a registered tag
 * binds a PURE component to its name; the binding is separate from
 * registration because the component only exists in the browser. The page
 * editor and the chat read the same assigned component.
 *
 * Pure means: no editor instance, no editor commands. A component navigates
 * only through the editor bridge (`useEditorBridge`) and reports back through
 * the callbacks below, which the host surface (editor node view, chat chip)
 * wires to whatever it owns.
 */
export interface TagRenderProps {
  name: string;
  /** The tag's attributes; an absent one is `null`. */
  attrs: Readonly<Record<string, string | null>>;
  /**
   * `block` only in the page editor for a `block`-form tag; everywhere else —
   * inline tags, and every chip in chat — `inline`.
   */
  variant: 'inline' | 'block';
  /** Write attributes back (editor only — absent where the tag is read-only, e.g. chat). */
  onAttrsChange?: (next: Record<string, string | null>) => void;
  /**
   * Broken-reference state, for the editor's "N broken references" bar.
   * `unresolvedType` — the `type` resolves to no active module; `missingEntity`
   * — the type resolves but the target does not exist.
   */
  onBrokenChange?: (state: { unresolvedType: boolean; missingEntity: boolean }) => void;
}

export type TagRenderComponent = ComponentType<TagRenderProps>;

const renders = new Map<string, TagRenderComponent>();

/** Bind a render to a registered tag name. A name outside the registry is rejected. */
export function assignTagRender(name: string, component: TagRenderComponent): void {
  if (!isRegisteredXmlTag(name)) {
    throw new Error(`Cannot assign a render to "${name}" — it is not a registered XML tag`);
  }
  renders.set(name, component);
}

export function getTagRender(name: string): TagRenderComponent | undefined {
  return renders.get(name);
}
