import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bodyOf } from '../lib/artifact-frontmatter.js';
import { patchesApi, toPatchArtifactView, type PatchDetailResponse } from '../lib/patches-api.js';
import { beginOwnWrite } from '../lib/own-writes.js';
import { artifactThreadsKey } from './useArtifactThreads.js';

const keys = {
  list: (brief?: string, applied?: boolean) =>
    ['patches', 'list', brief ?? null, applied ?? null] as const,
  detail: (path: string) => ['patches', 'detail', path] as const,
};

export function usePatches(opts: { brief?: string; applied?: boolean } = {}) {
  return useQuery({
    queryKey: keys.list(opts.brief, opts.applied),
    queryFn: () => patchesApi.list(opts),
  });
}

export function usePatch(patchPath: string | null) {
  return useQuery({
    enabled: !!patchPath,
    queryKey: keys.detail(patchPath ?? ''),
    queryFn: () => patchesApi.get(patchPath as string),
  });
}

export function useUpdatePatchContent(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; expectedHash: string }) =>
      patchesApi.updateContent(patchPath, input),
    // No own-write token (`lib/own-writes.ts`): the editor saves the body under
    // the frontmatter block unchanged byte for byte, and the service refuses any
    // change to the immutable keys and `applied`, so a content save broadcasts
    // no `patches:changed` (nor `file:changed`) — there is no echo to absorb. A
    // `patches:changed` arriving during the save is another writer's (an
    // agent's `mark_patch_applied`, an applied flip in another tab) and must
    // refetch the open detail.
    onSuccess: (written, input) => {
      // 2.1.48: the detail read is the WHOLE patch file (the route's default
      // projection), so refetching it after every debounced autosave would
      // re-download the entire patch just to learn the new hash — and a second
      // autosave fired during that long refetch would send the stale hash and
      // hit a spurious 409. The client holds the content it just sent and the
      // PUT answers hash + frontmatter: write the detail cache directly (the
      // title is re-derived, it follows the body's first heading).
      qc.setQueryData<PatchDetailResponse>(keys.detail(patchPath), (prev) =>
        prev
          ? toPatchArtifactView({
              ...prev,
              content: input.content,
              body: bodyOf(input.content),
              hash: written.hash,
              frontmatter: written.frontmatter,
            })
          : prev,
      );
      // Not a duplicate of the watcher: a body-only save broadcasts nothing, and
      // the list's "modified …" follows the file's `updatedAt`.
      qc.invalidateQueries({ queryKey: ['patches', 'list'] });
    },
  });
}

/**
 * The user's door to the patch's `applied` flag — two-way. 2.1.4: setting it
 * `true` usually comes from the patch thread's agent (`mark_patch_applied`,
 * one-way); reverting to `false` is user-only, and this hook is how. An agent
 * write reaches open views through `patches:changed` (useFileWatcher).
 */
export function useSetPatchApplied(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applied: boolean) => patchesApi.updateFrontmatter(patchPath, { applied }),
    // The flip's `patches:changed` echo is absorbed: the one detail refetch
    // below already follows the write (`lib/own-writes.ts`).
    onMutate: () => beginOwnWrite('patches', patchPath, { lateEcho: false }),
    onError: (_err, _applied, own) => {
      if (own?.failed()) qc.invalidateQueries({ queryKey: keys.detail(patchPath) });
    },
    onSuccess: (_written, _applied, own) => {
      own?.succeeded();
      qc.invalidateQueries({ queryKey: keys.detail(patchPath) });
      qc.invalidateQueries({ queryKey: ['patches', 'list'] });
    },
  });
}

export function useCreatePatchThread(patchPath: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => patchesApi.createThread(patchPath, name),
    onSuccess: () => {
      // 2.1.48: only the threads list changed. The detail read is the WHOLE
      // patch file (the route's default projection) and the list items carry
      // no threads — refetching either re-downloaded data a new thread does not touch.
      qc.invalidateQueries({ queryKey: artifactThreadsKey('patch', patchPath) });
    },
  });
}
