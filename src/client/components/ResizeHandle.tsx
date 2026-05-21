import { useEffect, useRef } from 'react';

interface Props {
  onDrag: (clientX: number) => void;
}

export function ResizeHandle({ onDrag }: Props) {
  const active = useRef(false);

  useEffect(() => {
    const up = () => {
      active.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const move = (e: MouseEvent) => {
      if (active.current) onDrag(e.clientX);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onDrag]);

  return (
    <div
      onMouseDown={() => {
        active.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      className="relative shrink-0 group hover:bg-[var(--c-accent)] transition-colors"
      style={{
        width: 1,
        cursor: 'col-resize',
        background: 'var(--c-hair)',
        zIndex: 20,
      }}
      title="Drag to resize"
    />
  );
}
