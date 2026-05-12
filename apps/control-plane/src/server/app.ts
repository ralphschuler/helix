import { Hono } from 'hono';

import { renderAdminDocumentStream } from '../entry-server.js';

export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (context) =>
    context.json({
      service: '@helix/control-plane',
      status: 'ok',
    }),
  );

  app.get('/admin', async (context) => {
    const stream = await renderAdminDocumentStream(
      new URL(context.req.url).pathname,
    );

    return new Response(stream, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  });

  return app;
}
