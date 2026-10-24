import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { ShadowDiffResponse } from '../../../shared/entities.js';
import { Badge } from '../../host-ui-kit/actions/Badge.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';

/**
 * 2.1.46 (M17 m17ui002) — what the diff cards need to render a SHADOW
 * comparison instead of a release one. There is no release snapshot here: the
 * full `from` state of a deleted entity comes from the shadow-diff response
 * itself (`before`, read off the left side of the delta).
 */
export interface ShadowCompare {
  before: ShadowDiffResponse['before'];
}

/** The hint on every link from a shadow card to the master (m17ui002). */
export const MASTER_VERSION_HINT = 'Opens the master version';

/** The label of an `added` card in a shadow comparison — the element exists only in the shadow. */
export function ShadowOnlyLabel() {
  return (
    <span className="inline-flex" data-shadow-only>
      <Badge label="shadow only" small />
    </span>
  );
}

const LINK_CLASS = 'inline-flex items-center gap-1 text-[11px] hover:underline';
const LINK_STYLE = { color: 'var(--c-accent)' } as const;

/**
 * The link of a `modified` / `deleted` entity card to the master's version — the
 * entity's own route. An address the master no longer knows is handled by that
 * screen (m17ui002); a type without a mounted route gets no link.
 */
export function MasterEntityLink({ type, slug }: { type: string; slug: string }) {
  const mod = clientPluginHost.getEntity(type);
  if (!mod) return null;
  return (
    <Link
      to={`${mod.pathPrefix}/$slug` as never}
      params={{ slug } as never}
      title={MASTER_VERSION_HINT}
      className={LINK_CLASS}
      style={LINK_STYLE}
      data-master-link
    >
      <ExternalLink size={11} aria-hidden />
      master
    </Link>
  );
}

/** The link of a `modified` / `deleted` page card to the master's version of the page. */
export function MasterPageLink({ rootId, path }: { rootId: string; path: string }) {
  return (
    <Link
      to={'/space/$rootId/$' as never}
      params={{ rootId, _splat: path } as never}
      title={MASTER_VERSION_HINT}
      className={LINK_CLASS}
      style={LINK_STYLE}
      data-master-link
    >
      <ExternalLink size={11} aria-hidden />
      master
    </Link>
  );
}
