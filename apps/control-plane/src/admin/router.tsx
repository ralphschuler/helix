import { useState } from 'react';
import {
  Outlet,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useLoaderData,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { permissionCatalog } from '@helix/contracts';

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
      {activeSection.id === 'users-rbac' ? <CustomRoleEditor /> : null}
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

function CustomRoleEditor(): React.ReactElement {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [status, setStatus] = useState('Custom roles have not been loaded yet.');

  async function handleCreateRole(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const payload = readRoleFormPayload(event.currentTarget);

    await submitRoleMutation('/admin/api/v1/iam/custom-roles', 'POST', payload, setStatus);
  }

  async function handleUpdateRole(form: HTMLFormElement | null): Promise<void> {
    if (form === null || selectedRoleId.trim().length === 0) {
      setStatus('Select a custom role before updating it.');
      return;
    }

    const payload = readRoleFormPayload(form);

    await submitRoleMutation(
      `/admin/api/v1/iam/custom-roles/${encodeURIComponent(selectedRoleId.trim())}`,
      'PATCH',
      {
        name: payload.name,
        permissions: payload.permissions,
      },
      setStatus,
    );
  }

  async function handleDisableRole(): Promise<void> {
    if (selectedRoleId.trim().length === 0) {
      setStatus('Select a custom role before disabling it.');
      return;
    }

    await submitRoleMutation(
      `/admin/api/v1/iam/custom-roles/${encodeURIComponent(selectedRoleId.trim())}`,
      'DELETE',
      undefined,
      setStatus,
    );
  }

  async function handleRefreshRoles(): Promise<void> {
    const response = await fetch('/admin/api/v1/iam/custom-roles');

    if (!response.ok) {
      setStatus(`Custom roles failed to load: ${response.status}`);
      return;
    }

    const body = (await response.json()) as { readonly customRoles?: readonly unknown[] };
    setStatus(`Loaded ${body.customRoles?.length ?? 0} custom roles.`);
  }

  return (
    <section aria-label="Custom role editor">
      <h2>Custom role editor</h2>
      <p>
        Create tenant-scoped permission containers. Users can grant only permissions
        they already hold; role changes are audited by the admin API.
      </p>
      <form aria-label="Create or update custom role" onSubmit={(event) => void handleCreateRole(event)}>
        <label>
          Role slug
          <input name="slug" type="text" autoComplete="off" required />
        </label>
        <label>
          Role name
          <input name="name" type="text" autoComplete="off" required />
        </label>
        <fieldset>
          <legend>Permissions</legend>
          {permissionCatalog.map((permission) => (
            <label key={permission}>
              <input name="permissions" type="checkbox" value={permission} />
              {permission}
            </label>
          ))}
        </fieldset>
        <button type="submit">Create role</button>
        <label>
          Selected role ID
          <input
            name="roleId"
            type="text"
            autoComplete="off"
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          onClick={(event) => void handleUpdateRole(event.currentTarget.form)}
        >
          Update selected role
        </button>
        <button type="button" onClick={() => void handleDisableRole()}>
          Disable selected role
        </button>
        <button type="button" onClick={() => void handleRefreshRoles()}>
          Refresh roles
        </button>
      </form>
      <p role="status">{status}</p>
    </section>
  );
}

interface RoleFormPayload {
  readonly slug: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

function readRoleFormPayload(form: HTMLFormElement): RoleFormPayload {
  const formData = new FormData(form);

  return {
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    permissions: formData.getAll('permissions').map(String),
  };
}

async function submitRoleMutation(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  payload: unknown | undefined,
  setStatus: (status: string) => void,
): Promise<void> {
  const requestInit: RequestInit = {
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': readCookieValue('helix_csrf') ?? '',
    },
    method,
  };

  if (payload !== undefined) {
    requestInit.body = JSON.stringify(payload);
  }

  const response = await fetch(url, requestInit);

  if (!response.ok) {
    setStatus(`Custom role mutation failed: ${response.status}`);
    return;
  }

  setStatus('Custom role mutation saved.');
}

function readCookieValue(name: string): string | null {
  const cookieSource = typeof document === 'undefined' ? '' : document.cookie;

  for (const part of cookieSource.split(';')) {
    const [rawName, ...rawValue] = part.split('=');

    if (rawName?.trim() === name) {
      return rawValue.join('=').trim();
    }
  }

  return null;
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AdminRouter;
  }
}
