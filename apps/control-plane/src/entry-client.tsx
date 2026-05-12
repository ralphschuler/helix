import { QueryClient } from '@tanstack/react-query';
import type { DehydratedState } from '@tanstack/react-query';
import { hydrateRoot, type Root } from 'react-dom/client';

import { AdminApp } from './admin/App.js';
import { createAdminRouter } from './admin/router.js';

declare global {
  interface Window {
    __HELIX_DEHYDRATED_STATE__?: DehydratedState;
  }
}

export async function hydrateAdminShell(): Promise<Root> {
  const rootElement = document.getElementById('root');

  if (rootElement === null) {
    throw new Error('Cannot hydrate admin shell: #root was not found.');
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });

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

if (typeof window !== 'undefined') {
  void hydrateAdminShell();
}
