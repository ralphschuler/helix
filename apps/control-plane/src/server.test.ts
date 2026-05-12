import { describe, expect, it } from 'vitest';

import { createApp } from './server/app.js';

describe('control-plane Hono server', () => {
  it('serves health status through the public HTTP interface', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: '@helix/control-plane',
      status: 'ok',
    });
  });
});
