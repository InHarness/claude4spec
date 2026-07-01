import { useQuery } from '@tanstack/react-query';
import { pageVersionsApi } from '../lib/page-versions-api.js';

export function usePageVersions(rootId: string, path: string | null) {
  return useQuery({
    queryKey: path ? ['page-versions', rootId, path] : ['page-versions', 'none'],
    queryFn: () => pageVersionsApi.list(rootId, path as string),
    enabled: Boolean(path),
  });
}

export function usePageVersionDetail(rootId: string, path: string | null, version: number | null) {
  return useQuery({
    queryKey:
      path && version != null
        ? ['page-version-detail', rootId, path, version]
        : ['page-version-detail', 'none'],
    queryFn: () => pageVersionsApi.get(rootId, path as string, version as number),
    enabled: Boolean(path && version != null),
  });
}
