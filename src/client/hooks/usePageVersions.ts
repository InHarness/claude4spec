import { useQuery } from '@tanstack/react-query';
import { pageVersionsApi } from '../lib/page-versions-api.js';

export function usePageVersions(path: string | null) {
  return useQuery({
    queryKey: path ? ['page-versions', path] : ['page-versions', 'none'],
    queryFn: () => pageVersionsApi.list(path as string),
    enabled: Boolean(path),
  });
}

export function usePageVersionDetail(path: string | null, version: number | null) {
  return useQuery({
    queryKey:
      path && version != null
        ? ['page-version-detail', path, version]
        : ['page-version-detail', 'none'],
    queryFn: () => pageVersionsApi.get(path as string, version as number),
    enabled: Boolean(path && version != null),
  });
}
