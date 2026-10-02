import { useCallback, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getXmlTag } from '../../../../shared/xml-markup/registry.js';
import { serializeXmlTag } from '../../../../shared/xml-tags.js';
import { getTagRender } from '../../../xml-markup/renders.js';
import { getTagPopoverFields } from '../../../xml-markup/popover-fields.js';
import { openPopover, type XmlTagAttrs } from '../../../ui/events.js';
import { useReportBrokenRef } from '../../../state/brokenRefs.js';

type Broken = { unresolvedType: boolean; missingEntity: boolean };

/**
 * M20 — the ONE node view of every XML tag node. It owns everything that needs
 * the editor instance, so the render it shows can stay pure:
 *  - the wrapper (inline span / block div) chosen by the tag's `form`;
 *  - the edit-popover convention — Alt+click opens the `xml-tag` popover, and
 *    a double-click too when the owner's fields ask for it;
 *  - writing attributes back and reporting broken references to the editor's
 *    "N broken references" bar.
 * A registered tag with no assigned render shows its own source as code.
 */
export function XmlTagView(props: NodeViewProps) {
  const name = props.node.type.name;
  const inline = getXmlTag(name)?.form === 'inline';
  const Render = getTagRender(name);
  const fields = getTagPopoverFields(name);
  const attrs = props.node.attrs as XmlTagAttrs;
  const wrapperRef = useRef<HTMLElement>(null);

  const [broken, setBroken] = useState<Broken>({ unresolvedType: false, missingEntity: false });
  const onBrokenChange = useCallback((next: Broken) => {
    setBroken((prev) =>
      prev.unresolvedType === next.unresolvedType && prev.missingEntity === next.missingEntity ? prev : next,
    );
  }, []);
  useReportBrokenRef(props.editor, broken, props.deleteNode);

  const openEdit = useCallback(
    (e: React.MouseEvent) => {
      if (!fields) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = (wrapperRef.current ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
      void openPopover('xml-tag', {
        x: rect.left,
        y: rect.bottom + 4,
        name,
        mode: 'edit',
        attrs: { ...attrs },
        onRemove: () => props.deleteNode(),
      }).then((result) => {
        if (result) props.updateAttributes(result);
      });
    },
    [fields, name, attrs, props],
  );

  const content = Render ? (
    <Render
      name={name}
      attrs={attrs}
      variant={inline ? 'inline' : 'block'}
      onAttrsChange={(next) => props.updateAttributes(next)}
      onBrokenChange={onBrokenChange}
    />
  ) : (
    <code>{serializeXmlTag(name, attrs)}</code>
  );

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as={inline ? 'span' : 'div'}
      className={inline ? 'inline-flex align-middle' : 'my-3 not-prose'}
      contentEditable={false}
      data-xml-tag={name}
      onClickCapture={(e: React.MouseEvent) => {
        if (e.altKey) openEdit(e);
      }}
      onDoubleClick={fields?.openOnDoubleClick ? openEdit : undefined}
    >
      {content}
    </NodeViewWrapper>
  );
}
