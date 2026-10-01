import type { ComponentType, ReactNode } from 'react';
import type { PopoverFormProps } from '../Popover.js';
import type { PopoverKind } from '../events.js';
import { NewPageForm } from './NewPageForm.js';
import { CreateTagForm } from './CreateTagForm.js';
import { MentionForm, ElementForm } from './EntityRefForm.js';
import { ListForm } from './ListForm.js';
import { TaggedForm, TaggedMixedForm } from './TaggedForm.js';
import { DiagramForm } from './DiagramForm.js';
import { XmlTagForm } from './XmlTagForm.js';
import { PageRefBrokenForm } from './PageRefBrokenForm.js';
import { PageRefPopoverForm } from '../../tiptap/extensions/PageRefPopover.js';

type RendererMap = {
  [K in PopoverKind]: ComponentType<PopoverFormProps<K>>;
};

export const POPOVER_RENDERERS: RendererMap = {
  'new-page': NewPageForm,
  'create-tag': CreateTagForm,
  mention: MentionForm,
  element: ElementForm,
  list: ListForm,
  tagged: TaggedForm,
  'tagged-mixed': TaggedMixedForm,
  diagram: DiagramForm,
  'xml-tag': XmlTagForm,
  'page-ref': PageRefPopoverForm,
  'page-ref-broken': PageRefBrokenForm,
};

export type { ReactNode };
