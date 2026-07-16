import { usePersistedState, projectKey } from '../state/persisted.js';
import type { LastPage } from '../lib/landing.js';

/** M02: the remembered `{ rootId, path }` last-opened page, shared by the read side
 *  (IndexRoute's landing chain) and the write side (PageRoute's persist-on-open). */
export function useLastPage() {
  return usePersistedState<LastPage | null>(projectKey('c4s:m02:last-page'), null, 1);
}
