import { QueryClient } from '@tanstack/react-query';
import type { DehydratedState } from '@tanstack/react-query';
import { hydrateRoot, type Root } from 'react-dom/client';

import { AdminApp } from './admin/App.js';
import { createAdminRouter } from './admin/router.js';
import { CustomerApp } from './customer/App.js';
import { createCustomerRouter } from './customer/router.js';

declare global {
  interface Window {
    __HELIX_DEHYDRATED_STATE__?: DehydratedState;
  }
}

export async function hydrateBrowserShell(): Promise<Root> {
  return window.location.pathname.startsWith('/admin')
    ? hydrateAdminShell()
    : hydrateCustomerShell();
}

export async function hydrateAdminShell(): Promise<Root> {
  const rootElement = getRootElement('admin');
  const queryClient = createBrowserQueryClient();
  const router = createAdminRouter({
    queryClient,
    url: window.location.pathname,
  });

  await router.load();

  return hydrateRoot(
    rootElement,
    <AdminApp
      dehydratedState={window.__HELIX_DEHYDRATED_STATE__ ?? { mutations: [], queries: [] }}
      queryClient={queryClient}
      router={router}
    />,
  );
}

export async function hydrateCustomerShell(): Promise<Root> {
  const rootElement = getRootElement('customer');
  const queryClient = createBrowserQueryClient();
  const router = createCustomerRouter({
    queryClient,
    url: window.location.pathname,
  });

  await router.load();

  return hydrateRoot(
    rootElement,
    <CustomerApp
      dehydratedState={window.__HELIX_DEHYDRATED_STATE__ ?? { mutations: [], queries: [] }}
      queryClient={queryClient}
      router={router}
    />,
  );
}

function createBrowserQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });
}

function getRootElement(shell: 'admin' | 'customer'): HTMLElement {
  const rootElement = document.getElementById('root');

  if (rootElement === null) {
    throw new Error(`Cannot hydrate ${shell} shell: #root was not found.`);
  }

  return rootElement;
}

if (typeof window !== 'undefined') {
  void hydrateBrowserShell();
}
