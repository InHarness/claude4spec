import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi, type ConfigPatch } from '../lib/api.js';

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
    onSuccess: (data) => {
      qc.setQueryData(['config'], data);
      qc.invalidateQueries({ queryKey: ['writing-styles'] });
    },
  });
}
