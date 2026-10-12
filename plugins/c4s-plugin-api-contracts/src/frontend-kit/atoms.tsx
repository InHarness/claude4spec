/**
 * DEBT (2.1.19, Host UI Kit slice of `c4s-plugin-api-contracts`, endpoint + dto): `MethodChip`
 * stands both in the list row and in the endpoint breadcrumb bar (fails
 * condition 1; condition 2 holds — its shape follows the endpoint's `method`);
 * `TagChip` — a tag chip is common to every entity type (fails condition 2).
 * Their catalog replacement is `Badge`. Recorded, not fixed here.
 */
import type { HttpMethod } from '../types.js';
import type { Tag } from '@c4s/plugin-runtime/ui';
import { Badge } from '@c4s/plugin-runtime/ui';

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
 * color/label mapping (`METHOD_STYLE`) to it, mirroring `TagChip` below.
 */
export function MethodChip({ method, large = false }: MethodChipProps) {
  const s = METHOD_STYLE[method] ?? METHOD_STYLE.GET;
  return (
    <Badge
      label={s.label}
      color={s.bg}
      foreground={s.fg}
      active
      dot={false}
      mono
      small={!large}
      minWidth={large ? 56 : 42}
    />
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
