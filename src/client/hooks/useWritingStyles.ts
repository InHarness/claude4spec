import { useQuery } from '@tanstack/react-query';
import { writingStylesApi } from '../lib/api.js';

export function useWritingStyles() {
  return useQuery({
    queryKey: ['writing-styles'],
    queryFn: () => writingStylesApi.get(),
  });
}
