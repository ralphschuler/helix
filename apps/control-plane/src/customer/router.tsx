import {
  Outlet,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useSuspenseQuery, type QueryClient } from '@tanstack/react-query';

import {
  customerWorkspaceOverviewQueryOptions,
  type CustomerWorkspaceOverview,
} from './queries.js';

interface CustomerRouterContext {
  readonly queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<CustomerRouterContext>()({
  component: CustomerRoute,
});

const customerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context }): Promise<CustomerWorkspaceOverview> =>
    context.queryClient.ensureQueryData(customerWorkspaceOverviewQueryOptions),
  component: CustomerWorkspaceRoute,
});

const routeTree = rootRoute.addChildren([customerRoute]);

export function createCustomerRouter(input: {
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

function CustomerRoute(): React.ReactElement {
  return <Outlet />;
}

function CustomerWorkspaceRoute(): React.ReactElement {
  const { data: overview } = useSuspenseQuery(customerWorkspaceOverviewQueryOptions);

  return <CustomerShell overview={overview} />;
}

function CustomerShell({
  overview,
}: {
  readonly overview: CustomerWorkspaceOverview;
}): React.ReactElement {
  return (
    <main data-testid="customer-shell" aria-label="Helix customer workspace">
      <p>{overview.workspace}</p>
      <h1>{overview.heading}</h1>
      <p>{overview.routeStatus}</p>
      <section aria-labelledby="customer-feature-map">
        <h2 id="customer-feature-map">Customer workspace</h2>
        <p>Tenant/project scoped controls for customer-owned resources.</p>
        <ul>
          {overview.features.map((feature) => (
            <li key={feature.id}>
              <a href={feature.path}>{feature.label}</a>
              <p>{feature.summary}</p>
              <p>Status: {feature.status}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="customer-data-safety">
        <h2 id="customer-data-safety">Data safety</h2>
        <p>{overview.rawDataPolicy}</p>
        <p>Admin/operator controls remain behind /admin.</p>
      </section>
    </main>
  );
}

export type CustomerRouter = ReturnType<typeof createCustomerRouter>;
