import type { ComponentType, ReactNode } from 'react';
import { isRegisteredXmlTag } from '../../shared/xml-markup/registry.js';

export type TagAttrs = Record<string, string | null>;

/**
 * M51/M20 — ONE edit-popover convention for every XML tag (the `xml-tag`
 * popover kind): the shell, footer, Save / Remove / Cancel and the "save only
 * after a change" rule are generic; the module owning a tag contributes only
 * its FIELDS here, keyed by tag name — never a popover kind of its own.
 */
export interface TagFieldsProps {
  mode: 'create' | 'edit';
  value: TagAttrs;
  onChange: (next: TagAttrs) => void;
  /** Submit from inside a field (Enter in a one-line input, pick in a list). */
  submit: (value?: TagAttrs) => void;
}

export interface TagPopoverFields {
  title: { create: string; edit: string };
  icon?: ReactNode;
  width?: number;
  Fields: ComponentType<TagFieldsProps>;
  /** An error message when `value` cannot be saved in `mode`; `null` when it can. */
  validate?: (value: TagAttrs, mode: 'create' | 'edit') => string | null;
  /** Shape the value written into the tag (trim, drop empties, …). */
  normalize?: (value: TagAttrs) => TagAttrs;
  /** Besides the conventional Alt+click, a double-click on the chip opens the edit popover. */
  openOnDoubleClick?: boolean;
}

const fields = new Map<string, TagPopoverFields>();

export function registerTagPopoverFields(name: string, def: TagPopoverFields): void {
  if (!isRegisteredXmlTag(name)) {
    throw new Error(`Cannot register popover fields for "${name}" — it is not a registered XML tag`);
  }
  fields.set(name, def);
}

export function getTagPopoverFields(name: string): TagPopoverFields | undefined {
  return fields.get(name);
}
