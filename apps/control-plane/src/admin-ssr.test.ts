import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { mockBrowserSessionHeader } from './features/auth/browser-auth.js';
import { createApp } from './server/app.js';

const requiredAdminSections = [
  { path: '/admin', label: 'Overview', heading: 'Helix Admin' },
  { path: '/admin/tenants', label: 'Tenants', heading: 'Tenants' },
  { path: '/admin/projects', label: 'Projects', heading: 'Projects' },
  { path: '/admin/users-rbac', label: 'Users/RBAC', heading: 'Users/RBAC' },
  { path: '/admin/billing', label: 'Billing', heading: 'Billing' },
  { path: '/admin/processors', label: 'Processors', heading: 'Processors' },
  { path: '/admin/jobs', label: 'Jobs', heading: 'Jobs' },
  { path: '/admin/workflows', label: 'Workflows', heading: 'Workflows' },
  { path: '/admin/schedules', label: 'Schedules', heading: 'Schedules' },
  { path: '/admin/replay-dlq', label: 'Replay/DLQ', heading: 'Replay/DLQ' },
  { path: '/admin/audit', label: 'Audit', heading: 'Audit' },
  { path: '/admin/settings', label: 'Settings', heading: 'Settings' },
] as const;

const dangerousControlLabels = [
  'Replay workflow from checkpoint',
  'Mutate DLQ entry',
  'Steer processor assignment',
  'Override tenant quota',
] as const;

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

  it('renders the full admin navigation map with safe disabled steering controls', async () => {
    const response = await createApp().request('/admin', {
      headers: {
        [mockBrowserSessionHeader]: 'dev-session',
      },
    });
    const html = await response.text();
    const dom = new JSDOM(html);

    try {
      const document = dom.window.document;

      for (const section of requiredAdminSections) {
        expect(document.querySelector(`a[href="${section.path}"]`)?.textContent).toContain(
          section.label,
        );
      }

      const disabledControlButtons = [
        ...document.querySelectorAll('button[data-testid="admin-disabled-control"]'),
      ];

      expect(disabledControlButtons).toHaveLength(dangerousControlLabels.length);
      for (const label of dangerousControlLabels) {
        const button = disabledControlButtons.find((candidate) =>
          candidate.textContent?.includes(label),
        );

        expect(button).toBeDefined();
        expect(button?.hasAttribute('disabled')).toBe(true);
      }
      expect(document.body.textContent).toContain('Raw payloads and logs are hidden by default.');
    } finally {
      dom.window.close();
    }
  });

  it.each(requiredAdminSections)(
    'serves the $label admin section for an authorized mock user',
    async (section) => {
      const response = await createApp().request(section.path, {
        headers: {
          [mockBrowserSessionHeader]: 'dev-session',
        },
      });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain(section.heading);
    },
  );
});
