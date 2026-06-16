import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentCredentialsApi } from '../lib/api.js';
import type { AgentCredentialResponse } from '../../shared/agent-credential.js';
import { PROJECT_ID } from '../lib/api-core.js';

/**
 * M05 0.1.62 — the agent's own ANTHROPIC API key (Settings → Agent). Query key
 * `["agent-credentials"]`; the response carries only `{ isSet, last4 }`.
 */
export function useAgentCredentials() {
  return useQuery({
    queryKey: ['agent-credentials'],
    queryFn: () => agentCredentialsApi.get(),
    enabled: !!PROJECT_ID,
  });
}

export function useSetAgentCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (anthropicApiKey: string) => agentCredentialsApi.set({ anthropicApiKey }),
    onSuccess: (data: AgentCredentialResponse) => {
      qc.setQueryData(['agent-credentials'], data);
    },
  });
}

export function useRemoveAgentCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => agentCredentialsApi.remove(),
    onSuccess: (data: AgentCredentialResponse) => {
      qc.setQueryData(['agent-credentials'], data);
    },
  });
}
