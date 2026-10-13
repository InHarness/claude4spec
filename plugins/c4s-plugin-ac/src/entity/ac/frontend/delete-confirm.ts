import { confirmDestructive, toast } from '@c4s/plugin-runtime';
import { apiFetch, handle } from '../../../frontend-kit/api-core.js';
import { AC_TYPE } from '../../../identity.js';

/**
 * 2.1.16 — the ONE place an `ac` deletion is confirmed (`ac-delete`).
 *
 * Two surfaces delete a criterion: Delete on the detail route's toolbar and
 * Remove in the `ac-edit` popover. Both ask through the host's confirmation
 * window with the same sentence, so they cannot tell the user different things
 * about the same irreversible act.
 *
 * The reference sentence disappears entirely at `N = 0`.
 */
export function deleteAcBody(slug: string, refCount: number): string {
  const base = `Delete AC \`${slug}\`? This cannot be undone.`;
  const refs =
    refCount > 0 ? ` ${refCount} page(s) reference this AC and will become broken.` : '';
  return `${base}${refs} Consider marking it as \`deprecated\` instead — this preserves history and references.`;
}

/** Pages citing this AC, counted at the moment of asking; a failed count is 0. */
async function countReferences(slug: string): Promise<number> {
  try {
    const res = await apiFetch(
      `/api/references?type=${AC_TYPE}&slug=${encodeURIComponent(slug)}&limit=1`,
    );
    // `handle`, not `unwrap`: `/api/references` answers flat, with no `data` key.
    const body = await handle<{ references?: unknown[]; total?: number }>(res);
    return body.total ?? body.references?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Ask, then delete. Answers whether the criterion is gone. `remove` is the
 * caller's delete mutation, so the shared query cache is invalidated.
 */
export async function confirmAndDeleteAc(
  slug: string,
  remove: (slug: string) => Promise<unknown>,
): Promise<boolean> {
  const refCount = await countReferences(slug);
  const ok = await confirmDestructive('ac-delete', {
    title: 'Delete AC?',
    body: deleteAcBody(slug, refCount),
    confirmLabel: 'Delete',
  });
  if (!ok) return false;
  try {
    await remove(slug);
    toast.success('AC deleted');
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}
