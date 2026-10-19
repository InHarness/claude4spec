import type { HttpMethod, Tag } from '../../shared/entities.js';
import { Badge } from '../host-ui-kit/actions/Badge.js';
import { TagChip as CatalogTagChip } from '../host-ui-kit/actions/TagChip.js';

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

interface MethodChipProps {
  method: HttpMethod;
  large?: boolean;
}

/**
 * HTTP method chip. Delegates to the Host UI Kit's `Badge` (M34/L12,
 * `experimental`): `Badge` owns the pill styling; this binds the method →
 * label/ink mapping (`METHOD_STYLE`) to it. Since 2.1.39 `Badge` is a plain
 * value marker, so only the ink (`fg`) carries the method colour.
 */
export function MethodChip({ method, large = false }: MethodChipProps) {
  const s = METHOD_STYLE[method] ?? METHOD_STYLE.GET;
  return (
    <Badge label={s.label} foreground={s.fg} mono small={!large} minWidth={large ? 56 : 42} />
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
 * Tag chip. Delegates to the Host UI Kit's `TagChip` (M34/L12, `experimental`),
 * which owns the pill styling; this binds the host's `Tag` shape to it.
 */
export function TagChip({ tag, active, small, onClick, onRemove }: TagChipProps) {
  return (
    <CatalogTagChip
      label={tag.name}
      color={tag.color ?? undefined}
      active={active}
      small={small}
      onClick={onClick}
      onRemove={onRemove}
    />
  );
}
