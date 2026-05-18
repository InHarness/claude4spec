import { List } from 'lucide-react';
import { useOutlineStore } from '../state/outline.js';
import { SegmentButton } from './ButtonGroup.js';

export function OutlineButton({ onPage = false }: { onPage?: boolean }) {
  const editor = useOutlineStore((s) => s.editor);
  const outlineOpen = useOutlineStore((s) => s.outlineOpen);
  const toggleOutline = useOutlineStore((s) => s.toggleOutline);

  if (!onPage && !editor) return null;

  const disabled = !editor;

  return (
    <SegmentButton
      icon={<List size={12} />}
      label="Outline"
      active={!disabled && outlineOpen}
      onClick={toggleOutline}
      title={disabled ? 'Outline unavailable' : outlineOpen ? 'Hide outline' : 'Show outline'}
      disabled={disabled}
    />
  );
}
