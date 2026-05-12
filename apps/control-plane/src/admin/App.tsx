import { HydrationBoundary, QueryClientProvider } from '@tanstack/react-query';
import type { DehydratedState, QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import type { AdminRouter } from './router.js';

export interface AdminAppProps {
  readonly dehydratedState: DehydratedState;
  readonly queryClient: QueryClient;
  readonly router: AdminRouter;
}

export function AdminApp({
  dehydratedState,
  queryClient,
  router,
}: AdminAppProps): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <RouterProvider router={router} />
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
