import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  configApi,
  patchTouchesRestartRequired,
  type ConfigPatch,
} from '../lib/api.js';

/**
 * M26 §2 — write the "last restart patch at" envelope when a restart-required
 * config field is mutated. Bumped on every such PATCH; the banner clears
 * automatically once `config.serverStartedAt > lastRestartPatchAt`. Custom
 * event lets `RestartRequiredBanner` react without polling localStorage.
 */
const RESTART_MARKER_KEY = 'c4s:settings:last-restart-patch-at';
const RESTART_MARKER_EVENT = 'c4s:restart-marker-changed';

function writeRestartMarker(): void {
  try {
    const env = { v: 1, data: new Date().toISOString() };
    window.localStorage.setItem(RESTART_MARKER_KEY, JSON.stringify(env));
    window.dispatchEvent(new CustomEvent(RESTART_MARKER_EVENT));
  } catch {
    /* localStorage quota / SSR — ignore */
  }
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
  });
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
      if (patchTouchesRestartRequired(variables)) {
        writeRestartMarker();
      }
    },
  });
}
