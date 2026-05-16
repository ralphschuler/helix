import { HydrationBoundary, QueryClientProvider } from '@tanstack/react-query';
import type { DehydratedState, QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import type { CustomerRouter } from './router.js';

export interface CustomerAppProps {
  readonly dehydratedState: DehydratedState;
  readonly queryClient: QueryClient;
  readonly router: CustomerRouter;
}

export function CustomerApp({
  dehydratedState,
  queryClient,
  router,
}: CustomerAppProps): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <RouterProvider router={router} />
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
