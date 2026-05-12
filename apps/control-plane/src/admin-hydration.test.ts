import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hydrateAdminShell } from './entry-client.js';
import { mockBrowserSessionHeader } from './features/auth/browser-auth.js';
import { createApp } from './server/app.js';

describe('admin client hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates the SSR admin shell without a React mismatch warning', async () => {
    const response = await createApp().request('/admin', {
      headers: {
        [mockBrowserSessionHeader]: 'dev-session',
      },
    });
    const html = await response.text();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost/admin',
    });
    const hydrationErrors: unknown[][] = [];
    const originalError = globalThis.console.error;
    let root: Root | undefined;

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Text', dom.window.Text);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('self', dom.window);
    globalThis.console.error = (...args: unknown[]) => {
      hydrationErrors.push(args);
    };

    try {
      root = await hydrateAdminShell();
      await waitForClientWork(dom);

      expect(hydrationErrors.filter(isHydrationMismatch)).toEqual([]);
      expect(
        dom.window.document.querySelector('[data-testid="admin-shell"]')
          ?.textContent,
      ).toContain('Protected-ready admin route');
    } finally {
      root?.unmount();
      await waitForClientWork(dom);
      globalThis.console.error = originalError;
      dom.window.close();
    }
  });
});

async function waitForClientWork(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => {
    dom.window.setTimeout(resolve, 0);
  });
}

function isHydrationMismatch(args: unknown[]): boolean {
  return args.some(
    (argument) =>
      argument instanceof Error &&
      argument.message.includes('Hydration failed because the server rendered HTML'),
  );
}
