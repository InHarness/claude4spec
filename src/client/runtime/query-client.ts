/**
 * The single process-wide TanStack QueryClient. Created here (not in main.tsx)
 * so that both the host's `<QueryClientProvider>` and the `@c4s/plugin-runtime`
 * facade hand plugins the SAME cache instance — a plugin's `useQuery` shares the
 * host's query cache rather than spinning up a second one.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
