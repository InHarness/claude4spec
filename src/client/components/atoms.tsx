import type { HttpMethod, Tag } from '../../shared/entities.js';
import { Badge } from '../host-ui-kit/actions/Badge.js';

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

/**
 * Tag chip. Delegates to the Host UI Kit's `Badge` (M34/L12, `experimental`):
 * `Badge` owns the pill styling; this binds the host's `Tag` shape to it. The
 * external prop API and rendered output are unchanged.
 */
export function TagChip({ tag, active, small, onClick, onRemove }: TagChipProps) {
  return (
    <Badge
      label={tag.name}
      color={tag.color ?? undefined}
      active={active}
      small={small}
      onClick={onClick}
      onRemove={onRemove}
    />
  );
}
