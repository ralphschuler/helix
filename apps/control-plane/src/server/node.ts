import { serve } from '@hono/node-server';

import { createApp } from './app.js';

export function startServer(input: { readonly port?: number } = {}) {
  const port = input.port ?? Number.parseInt(process.env.PORT ?? '3000', 10);

  return serve({
    fetch: createApp().fetch,
    port,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
