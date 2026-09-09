import { uiViewsApi } from './api.js';
import { confirmDestructive, toast } from '../../../frontend-kit/host-events.js';
import { apiFetch, handle } from '../../../frontend-kit/api-core.js';

/**
 * 0.2.78 — the ONE place a `ui-view` deletion is confirmed.
 *
 * The detail panel had this inline, which was fine while it was the only
 * surface that could delete. The chip and the card can now too, and three copies
 * of a warning sentence is how three surfaces start telling the user different
 * things about the same irreversible act. The wording is contractual, not
 * decorative — it is what a reader is given to decide with.
 *
 * ## The sentence
 *
 *   Delete UI view {title}? This cannot be undone. {N} page(s) reference this
 *   view and will become broken.
 *
 * The second sentence is ALWAYS present; the third disappears entirely at
 * `N = 0` rather than degrading to "0 pages reference this view", which reads as
 * a warning about nothing and trains the reader to skip the line that matters
 * when it is not zero.
 */
export function deleteUiViewBody(title: string, refCount: number): string {
  const base = `Delete UI view "${title}"? This cannot be undone.`;
  if (refCount <= 0) return base;
  // The verb agrees with the count too — "1 page reference this view" reads as
  // a string built by a machine, in the one sentence that has to be believed.
  const subject = refCount === 1 ? '1 page references' : `${refCount} pages reference`;
  return `${base} ${subject} this view and will become broken.`;
}

/**
 * How many pages cite this view.
 *
 * Counted at the moment of asking rather than read from a cache the chip may not
 * have: the number is the whole reason the modal is worth reading, and a stale
 * zero is worse than no number at all. A failure to count is NOT a failure to
 * delete — the confirmation degrades to the sentence without the count, because
 * refusing to let someone delete a view because a reference sweep timed out
 * would be the reference index holding the entity hostage.
 */
async function countReferences(slug: string): Promise<number> {
  try {
    const res = await apiFetch(
      `/api/references?type=ui-view&slug=${encodeURIComponent(slug)}&limit=1`,
    );
    /**
     * `handle`, NOT `unwrap`. `/api/references` is not one of the generated
     * `/api/{type}s` routes, so it answers `{ references, total, hasMore }` flat
     * — with no `data` key for `unwrap` to reach through. Unwrapping it yields
     * `undefined`, and the `catch` below then turns a TypeError into a count of
     * zero: the warning would never appear, and nothing would say why.
     */
    const body = await handle<{ references?: unknown[]; total?: number }>(res);
    return body.total ?? body.references?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Ask, then delete. Answers whether the view is gone.
 *
 * `false` covers both "the user said no" and "the delete failed" on purpose: the
 * only thing every caller needs to branch on is whether the entity it was
 * rendering still exists. The failure is reported to the user here so no caller
 * has to remember to.
 */
export async function confirmAndDeleteUiView(slug: string, title: string): Promise<boolean> {
  const refCount = await countReferences(slug);
  const ok = await confirmDestructive({
    title: 'Delete UI view?',
    body: deleteUiViewBody(title, refCount),
    confirmLabel: 'Delete',
  });
  if (!ok) return false;
  try {
    await uiViewsApi.remove(slug);
    toast.success(`View ${title} deleted`);
    return true;
  } catch (err) {
    toast.error((err as Error).message);
    return false;
  }
}
