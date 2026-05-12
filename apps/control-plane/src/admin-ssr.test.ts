import { describe, expect, it } from 'vitest';

import { mockBrowserSessionHeader } from './features/auth/browser-auth.js';
import { createApp } from './server/app.js';

describe('admin SSR route', () => {
  it('streams an admin HTML shell with dehydrated route data', async () => {
    const response = await createApp().request('/admin', {
      headers: {
        [mockBrowserSessionHeader]: 'dev-session',
      },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<div id="root">');
    expect(html).toContain('Helix Admin');
    expect(html).toContain('Protected-ready admin route');
    expect(html).toContain('__HELIX_DEHYDRATED_STATE__');
    expect(html).toContain('/src/entry-client.tsx');
  });
});
