/**
 * Render slot `renderOverlay` — the read-only surface a chip or card opens.
 *
 * REQUIRED, not optional: the host's slot rules refuse to register a hidden type
 * without it ("its chip has no detail route to open"). The brief names three
 * render slots and this is a fourth, because a hidden type with a clickable chip
 * and nowhere for the click to go is not a shape the host will accept.
 *
 * Read-only by design and not merely by omission. An edge is authored in a
 * workflow step, not while reading a page, so this surface offers no edit
 * affordance at all — there is no popover and no slash command for this type
 * either, for the same reason.
 *
 * ONE entrance, and it always fetches. `EntityOverlayHost` is the only thing that
 * mounts this slot and it passes `{ slug, caption, onClose }` — the slot type
 * carries no `entity` prop at all, so there is no "the caller already has the
 * record" path to take. The refetch is one bounded `GET`: nothing here is
 * `contentBearing`, so the record arrives whole.
 */

import React from 'react';
import { Dialog, FieldGrid, FieldRow, LoadingState } from '@c4s/plugin-runtime/ui';
import { DependencySentence } from './sentence.js';
import { fetchModuleDependency, type ModuleDependency } from './types.js';

export function ModuleDependencyOverlay({
  slug,
  caption,
  onClose,
}: {
  slug: string;
  caption?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = React.useState<ModuleDependency | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    void fetchModuleDependency(slug).then((next) => {
      if (!live) return;
      setRecord(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const title = loading ? (
    <LoadingState lines={1} width={200} />
  ) : record ? (
    <DependencySentence dependent={record.dependent} provider={record.provider} small={false} />
  ) : (
    <span className="text-[13px]" style={{ color: 'var(--c-red)' }}>
      {`broken module-dependency: ${slug}`}
    </span>
  );

  // The window shell is the catalog's `Dialog` (M34 gate (a), 2.1.20): this type
  // declares no host-local component, so it draws no scrim or panel of its own
  // (ASSUMPTION:dev-2008 — the slice's Components consumed does not list `Dialog` yet).
  // `title` gives the header row and its ✕; scrim click and `Esc` close it too.
  return (
    <Dialog open onClose={onClose} title={title} width={560} ariaLabel={`module-dependency ${slug}`}>
      <div data-testid="module-dependency-overlay">
        {record ? (
          <FieldGrid>
            <FieldRow label="Needs" align="start">
              <span className="text-[13px]" style={{ color: 'var(--c-ink)' }}>
                {record.needs}
              </span>
            </FieldRow>
          </FieldGrid>
        ) : null}
        {record && caption ? (
          <div className="mt-3 text-[12px] italic" style={{ color: 'var(--c-muted)' }}>
            {caption}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
