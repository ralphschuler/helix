import { PassThrough, Readable } from 'node:stream';

import { QueryClient, dehydrate } from '@tanstack/react-query';
import type { DehydratedState } from '@tanstack/react-query';
import { renderToPipeableStream } from 'react-dom/server';

import { AdminApp } from './admin/App.js';
import { serializeDehydratedState } from './admin/dehydration.js';
import { createAdminRouter, type AdminRouter } from './admin/router.js';

const shellAbortAfterMs = 5_000;

export async function renderAdminDocumentStream(
  url: string,
): Promise<ReadableStream<Uint8Array>> {
  const queryClient = createAdminQueryClient();
  const router = createAdminRouter({ queryClient, url });

  await router.load();

  const dehydratedState = dehydrate(queryClient);

  return renderReactDocumentToWebStream(
    <AdminDocument
      dehydratedState={dehydratedState}
      queryClient={queryClient}
      router={router}
      serializedDehydratedState={serializeDehydratedState(dehydratedState)}
    />,
  );
}

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });
}

function AdminDocument({
  dehydratedState,
  queryClient,
  router,
  serializedDehydratedState,
}: {
  readonly dehydratedState: DehydratedState;
  readonly queryClient: QueryClient;
  readonly router: AdminRouter;
  readonly serializedDehydratedState: string;
}): React.ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Helix Admin</title>
      </head>
      <body>
        <div id="root">
          <AdminApp
            dehydratedState={dehydratedState}
            queryClient={queryClient}
            router={router}
          />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__HELIX_DEHYDRATED_STATE__=${serializedDehydratedState};`,
          }}
        />
        <script type="module" src="/src/entry-client.tsx" />
      </body>
    </html>
  );
}

function renderReactDocumentToWebStream(
  element: React.ReactElement,
): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const timeoutRef: { current?: NodeJS.Timeout } = {};
    let shellReady = false;

    const { abort, pipe } = renderToPipeableStream(element, {
      onShellReady() {
        shellReady = true;
        if (timeoutRef.current !== undefined) {
          clearTimeout(timeoutRef.current);
        }
        stream.write('<!doctype html>');
        pipe(stream);
        resolve(Readable.toWeb(stream) as ReadableStream<Uint8Array>);
      },
      onShellError(error) {
        reject(error);
      },
      onError(error) {
        if (!shellReady) {
          reject(error);
        }
      },
    });

    timeoutRef.current = setTimeout(() => {
      abort();
      reject(new Error('Admin SSR shell render timed out.'));
    }, shellAbortAfterMs);
    timeoutRef.current.unref();
  });
}
