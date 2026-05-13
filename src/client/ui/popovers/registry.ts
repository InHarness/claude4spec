import type { ComponentType, ReactNode } from 'react';
import type { PopoverFormProps } from '../Popover.js';
import type { PopoverKind } from '../events.js';
import { NewPageForm } from './NewPageForm.js';
import { CreateEndpointForm } from './CreateEndpointForm.js';
import { CreateDtoForm } from './CreateDtoForm.js';
import { CreateAcForm } from './CreateAcForm.js';
import { CreateTagForm } from './CreateTagForm.js';
import { MentionForm, ElementForm } from './EntityRefForm.js';
import { ListForm } from './ListForm.js';
import { TaggedForm, TaggedMixedForm } from './TaggedForm.js';
import { EditChipForm } from './EditChipForm.js';
import { DiagramForm } from './DiagramForm.js';
import { SectionPickerForm } from './SectionPickerForm.js';

type RendererMap = {
  [K in PopoverKind]: ComponentType<PopoverFormProps<K>>;
};

export const POPOVER_RENDERERS: RendererMap = {
  'new-page': NewPageForm,
  'create-endpoint': CreateEndpointForm,
  'create-dto': CreateDtoForm,
  'create-ac': CreateAcForm,
  'create-tag': CreateTagForm,
  mention: MentionForm,
  element: ElementForm,
  list: ListForm,
  tagged: TaggedForm,
  'tagged-mixed': TaggedMixedForm,
  'edit-chip': EditChipForm,
  diagram: DiagramForm,
  section: SectionPickerForm,
};

export type { ReactNode };
