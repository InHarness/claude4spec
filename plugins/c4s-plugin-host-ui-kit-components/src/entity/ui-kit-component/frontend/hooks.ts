import { useQuery } from '@tanstack/react-query';
import { UI_KIT_COMPONENT_TYPE } from '../../../identity.js';
import type { UiKitComponent } from '../../../types.js';
import { uiKitComponentsApi } from './api.js';

export function useUiKitComponentList() {
  return useQuery({
    queryKey: [UI_KIT_COMPONENT_TYPE, 'list'],
    queryFn: () => uiKitComponentsApi.list(),
  });
}

/** `undefined` while loading, `null` when the slug resolves to nothing (404), the record otherwise. */
export function useGetBySlug(slug: string | null) {
  return useQuery({
    queryKey: slug ? [UI_KIT_COMPONENT_TYPE, 'detail', slug] : [UI_KIT_COMPONENT_TYPE, 'detail', 'none'],
    queryFn: async (): Promise<UiKitComponent | null> => {
      try {
        return await uiKitComponentsApi.get(slug as string);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(slug),
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
  });
}
