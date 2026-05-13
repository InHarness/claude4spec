import type { HttpMethod, Tag } from '../../shared/entities.js';

export const METHOD_STYLE: Record<
  HttpMethod,
  { bg: string; fg: string; label: string }
> = {
  GET: { bg: 'var(--c-blue-soft)', fg: 'var(--c-blue)', label: 'GET' },
  POST: { bg: 'var(--c-green-soft)', fg: 'var(--c-green)', label: 'POST' },
  PUT: { bg: 'var(--c-purple-soft)', fg: 'var(--c-purple)', label: 'PUT' },
  PATCH: { bg: 'var(--c-yellow)', fg: 'var(--c-yellow-ink)', label: 'PATCH' },
  DELETE: { bg: 'var(--c-red-soft)', fg: 'var(--c-red)', label: 'DEL' },
};

export function MethodBadge({ method, large = false }: { method: HttpMethod; large?: boolean }) {
  const s = METHOD_STYLE[method] ?? METHOD_STYLE.GET;
  return (
    <span
      className={`inline-flex items-center justify-center font-mono font-semibold tracking-wide rounded ${large ? 'px-2 py-1 text-[12px]' : 'px-1.5 py-[1px] text-[10.5px]'}`}
      style={{ background: s.bg, color: s.fg, minWidth: large ? 56 : 42 }}
    >
      {s.label}
    </span>
  );
}

interface TagChipProps {
  tag: Pick<Tag, 'slug' | 'name' | 'color'>;
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

export function TagChip({ tag, active, small, onClick, onRemove }: TagChipProps) {
  const color = tag.color ?? 'var(--c-muted)';
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full chip-hover transition"
      style={{
        padding: small ? '1px 7px' : '2px 8px',
        fontSize: small ? 10.5 : 11.5,
        background: active ? color : 'var(--c-panel)',
        color: active ? '#fff' : 'var(--c-ink)',
        border: `1px solid ${active ? color : 'var(--c-hair)'}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        className="rounded-full"
        style={{ width: 6, height: 6, background: active ? '#fff' : color }}
      />
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-70 hover:opacity-100"
          style={{ marginLeft: 2 }}
          aria-label={`remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
