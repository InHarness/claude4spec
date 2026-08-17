import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi, type ConfigPatch } from '../lib/api.js';
import { PROJECT_ID } from '../lib/api-core.js';
import type { Root } from '../../shared/types.js';

/**
 * M31: fields that rebuild the project context server-side (the PATCH handler
 * invalidates the cached ProjectContext; the next request gets a fresh one).
 * Every cached query may be stale after such a rebuild — blanket invalidate.
 * "Restart required" (M26) is gone: nothing needs a process restart anymore.
 */
const CONTEXT_DEFINING_FIELDS = [
  'roots',
  'briefsDir',
  'patchesDir',
  'plansDir',
  'entitiesDir',
  // Must mirror CONTEXT_DEFINING_FIELDS in src/server/routes/config.ts. Missing
  // here, a `releasesDir`-only write rebuilt the context server-side while the
  // client kept serving every cached query against the old one.
  'releasesDir',
  'entities',
] as const satisfies readonly (keyof ConfigPatch)[];

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
    // Decision #11: `/welcome` runs project-less (PROJECT_ID=''), where there is
    // no project-scoped `/api/config` to read — skip the doomed request.
    enabled: !!PROJECT_ID,
  });
}

/**
 * 0.1.96 multiroot: selector for the configured page roots. Empty until the
 * config query resolves (or project-less `/welcome`, where there is no config).
 */
export function useRoots(): Root[] {
  const { data } = useConfig();
  return data?.roots ?? [];
}

export function usePatchConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigPatch) => configApi.patch(input),
    onSuccess: (data, variables) => {
      qc.setQueryData(['config'], data);
      if ('writingStyle' in variables) {
        qc.invalidateQueries({ queryKey: ['writing-styles'] });
      }
      if ('remoteProjectId' in variables) {
        qc.invalidateQueries({ queryKey: ['remote-project'] });
      }
      // M33 phase 3: a `plugins` write always refreshes the config cache (above,
      // via setQueryData). An `executive` field additionally rebuilds the
      // context server-side (`pluginsPatchIsExecutive` in routes/config.ts); the
      // result surfaces on the next request, so a blanket invalidate keeps the
      // client coherent. Only the server can tell executive from `hot-reload`,
      // so every `plugins` write invalidates — over-invalidating a hot-reload
      // write costs a refetch, under-invalidating an executive one leaves every
      // cached query answering against a context that no longer exists.
      if (CONTEXT_DEFINING_FIELDS.some((k) => k in variables) || 'plugins' in variables) {
        qc.invalidateQueries();
      }
    },
  });
}
