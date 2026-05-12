import {
  Outlet,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useLoaderData,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

import {
  adminOverviewQueryOptions,
  type AdminOverview,
} from './queries.js';

interface AdminRouterContext {
  readonly queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<AdminRouterContext>()({
  component: AdminRoot,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  loader: async ({ context }): Promise<AdminOverview> =>
    context.queryClient.ensureQueryData(adminOverviewQueryOptions),
  component: AdminRoute,
});

const routeTree = rootRoute.addChildren([adminRoute]);

export function createAdminRouter(input: {
  readonly queryClient: QueryClient;
  readonly url: string;
}) {
  return createRouter({
    routeTree,
    context: {
      queryClient: input.queryClient,
    },
    history: createMemoryHistory({ initialEntries: [input.url] }),
    defaultPreload: 'intent',
  });
}

function AdminRoot(): React.ReactElement {
  return <Outlet />;
}

function AdminRoute(): React.ReactElement {
  const overview = useLoaderData({ from: adminRoute.id });

  return (
    <main data-testid="admin-shell" aria-label="Helix admin shell">
      <p>{overview.workspace}</p>
      <h1>{overview.heading}</h1>
      <p>{overview.routeStatus}</p>
    </main>
  );
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AdminRouter;
  }
}
