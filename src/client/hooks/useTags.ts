import { useQuery } from '@tanstack/react-query';
import { tagsApi } from '../lib/api.js';

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
  });
}
