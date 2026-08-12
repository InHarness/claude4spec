/**
 * The host's `EntityNotFound`, vendored.
 *
 * The `ui-view` and `design-system` detail routes both declared it as their
 * `notFoundComponent` before the move, and dropping it would have been a silent
 * UX regression rather than a refactor: the route would fall through to the
 * router's generic not-found instead of offering the "Back to <Entities>" way
 * out. The api-contracts envelope's routes never had one, so there was nothing
 * to copy from there.
 *
 * `clientPluginHost.getAvailable` is ALWAYS a method call — see the note in
 * `EntityBreadcrumbBar`; pulling it into a local unbinds the receiver.
 */

import type { FC } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { clientPluginHost } from '@c4s/plugin-runtime';
import { Pane } from './route-shell.js';
import { toList, type Navigate } from './navigation.js';

export const EntityNotFound: FC<{ type: string }> = ({ type }) => {
  const navigate = useNavigate() as Navigate;
  const mod = clientPluginHost.getAvailable(type);
  const label = mod?.label ?? 'Entity';
  const listLabel = mod?.labelPlural ?? 'Entities';
  const prefix = mod?.pathPrefix ?? '';

  return (
    <Pane>
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="max-w-md text-center" style={{ color: 'var(--c-muted)' }}>
          <div className="text-[15px] font-semibold mb-2" style={{ color: 'var(--c-ink)' }}>
            {label} not found
          </div>
          <div className="text-[12.5px] mb-4" style={{ color: 'var(--c-subtle)' }}>
            The {type} slug in the URL does not match any entity in the database.
          </div>
          <button
            onClick={() => toList(navigate, prefix)}
            className="rounded-md px-3 py-1.5 text-[12.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Back to {listLabel}
          </button>
        </div>
      </div>
    </Pane>
  );
};
