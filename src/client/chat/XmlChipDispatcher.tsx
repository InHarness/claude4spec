import { getEntityDef } from '../entities/registry.js';
import { ChipResolver } from '../entities/ChipResolver.js';
import { categoriseBrokenChip } from '../core/plugin-host/host.js';
import { InlineBrokenChip } from '../tiptap/extensions/views/BrokenChip.js';
import { useEditorBridge } from '../tiptap/EditorContext.js';
import { openEntityHandler } from '../entities/openEntity.js';
import { getTagRender } from '../xml-markup/renders.js';
import type { SanitizedChip } from './xml-chip-preprocess.js';

/**
 * Render one chip tag in chat markdown (2.1.2, M51). The component is picked
 * in this order:
 *  1. the render the owning module assigned to the tag's name;
 *  2. for a tag targeting an entity — the `renderChip` slot of the type in
 *     its `type` attribute;
 *  3. no module for that type — the broken chip `[broken: type]`.
 * Every chip renders its INLINE variant in chat, a `block` tag included: the
 * block card stays in the page editor only.
 */
export function XmlChipDispatcher({ chip }: { chip: SanitizedChip }) {
  const Render = getTagRender(chip.kind);
  if (Render) return <Render name={chip.kind} attrs={chip.attrs} variant="inline" />;
  return <TypeChip type={chip.attrs.type ?? ''} slug={chip.attrs.slug ?? ''} />;
}

function TypeChip({ type, slug }: { type: string; slug: string }) {
  const def = getEntityDef(type);
  const bridge = useEditorBridge();
  // A hidden type opens its fullscreen overlay, a normal one navigates. In chat
  // there is often no `EditorBridge` at all, and a diagram chip still has to open.
  const open = openEntityHandler(type, slug, bridge);
  if (!def) {
    const category = categoriseBrokenChip(type) ?? 'unknown-type';
    return <InlineBrokenChip category={category} type={type} />;
  }
  return <ChipResolver type={type} slug={slug} onOpen={open} />;
}
