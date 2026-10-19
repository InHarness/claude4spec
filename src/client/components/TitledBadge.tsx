import { Badge, type BadgeProps } from '../host-ui-kit/actions/Badge.js';

/**
 * 2.1.40 (M34) — the catalog `Badge` with a native tooltip. The host's value
 * markers (a brief's provenance, a patch's `patch_kind`, `applied` / `pending`,
 * `Plan v{N}`, a brief's implementation state) are `Badge`s, not hand-drawn
 * pills; `Badge` declares no `title`, so the tooltip rides on a wrapper.
 */
export function TitledBadge({ title, ...badge }: BadgeProps & { title?: string }) {
  return (
    <span className="inline-flex items-center" title={title}>
      <Badge {...badge} />
    </span>
  );
}
