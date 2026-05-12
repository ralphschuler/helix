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
  findAdminSectionById,
  type AdminOverview,
  type AdminSection,
} from './queries.js';

interface AdminRouterContext {
  readonly queryClient: QueryClient;
}

interface AdminSectionRouteData {
  readonly overview: AdminOverview;
  readonly section: AdminSection;
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

const adminSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/$sectionId',
  loader: async ({ context, params }): Promise<AdminSectionRouteData> => {
    const overview = await context.queryClient.ensureQueryData(
      adminOverviewQueryOptions,
    );
    const section = findAdminSectionById(params.sectionId);

    if (section === undefined) {
      throw new Error(`Unknown admin section: ${params.sectionId}`);
    }

    return { overview, section };
  },
  component: AdminSectionRoute,
});

const routeTree = rootRoute.addChildren([adminRoute, adminSectionRoute]);

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

  return <AdminShell overview={overview} section={overview.sections[0]} />;
}

function AdminSectionRoute(): React.ReactElement {
  const { overview, section } = useLoaderData({ from: adminSectionRoute.id });

  return <AdminShell overview={overview} section={section} />;
}

function AdminShell({
  overview,
  section,
}: {
  readonly overview: AdminOverview;
  readonly section: AdminSection | undefined;
}): React.ReactElement {
  const activeSection = section ?? overview.sections[0];

  if (activeSection === undefined) {
    throw new Error('Admin shell requires at least one section.');
  }

  return (
    <main data-testid="admin-shell" aria-label="Helix admin shell">
      <p>{overview.workspace}</p>
      <h1>{activeSection.heading}</h1>
      <p>{overview.routeStatus}</p>
      <nav aria-label="Admin sections">
        <ul>
          {overview.sections.map((navigationSection) => (
            <li key={navigationSection.id}>
              <a
                href={navigationSection.path}
                aria-current={
                  navigationSection.id === activeSection.id ? 'page' : undefined
                }
              >
                {navigationSection.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="admin-section-summary">
        <h2 id="admin-section-summary">{activeSection.label}</h2>
        <p>{activeSection.summary}</p>
        <p>{overview.rawDataPolicy}</p>
      </section>
      <section aria-labelledby="admin-disabled-controls">
        <h2 id="admin-disabled-controls">Disabled steering controls</h2>
        <p>
          Dangerous broker, replay, DLQ, and quota actions are visible for map
          completeness but cannot be submitted from this scaffold.
        </p>
        <ul>
          {overview.disabledControls.map((control) => {
            const reasonId = `${control.id}-reason`;

            return (
              <li key={control.id}>
                <button
                  type="button"
                  data-testid="admin-disabled-control"
                  disabled
                  aria-describedby={reasonId}
                >
                  {control.label}
                </button>
                <p id={reasonId}>{control.reason}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AdminRouter;
  }
}
