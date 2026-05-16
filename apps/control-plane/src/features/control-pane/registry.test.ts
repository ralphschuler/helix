import { describe, expect, it } from 'vitest';

import {
  controlPaneSections,
  listControlPaneActions,
  listControlPaneSections,
} from './registry.js';

const customerIds = [
  'customer-overview',
  'jobs',
  'workflows',
  'processors',
  'schedules',
  'streams',
  'api-keys',
  'billing',
  'settings',
];

const adminPaths = [
  '/admin',
  '/admin/tenants',
  '/admin/projects',
  '/admin/users-rbac',
  '/admin/billing',
  '/admin/processors',
  '/admin/jobs',
  '/admin/workflows',
  '/admin/schedules',
  '/admin/streams',
  '/admin/replay-dlq',
  '/admin/audit',
  '/admin/settings',
  '/admin/storage',
  '/admin/quotas',
  '/admin/health',
];

describe('control pane registry', () => {
  it('exposes canonical customer and admin sections', () => {
    expect(listControlPaneSections('customer').map((section) => section.id)).toEqual(customerIds);
    expect(listControlPaneSections('admin').map((section) => section.path)).toEqual(adminPaths);
  });

  it('requires stable section metadata and blockers for disabled sections', () => {
    const ids = new Set<string>();

    for (const section of controlPaneSections) {
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(section.id)).toBe(false);
      ids.add(section.id);
      expect(section.label).not.toHaveLength(0);
      expect(section.path).toMatch(/^\//);
      expect(section.summary).not.toHaveLength(0);
      expect(section.featureDomain).not.toHaveLength(0);
      expect(section.requiredPermissions.length).toBeGreaterThan(0);
      expect(section.rawDataPolicy).toBeDefined();

      if (!section.enabled) {
        expect(section.blockerReason).toEqual(expect.stringContaining('Disabled until'));
      }
    }
  });

  it('requires action permission, risk, readiness, and disabled blocker metadata', () => {
    const actions = [...listControlPaneActions('customer'), ...listControlPaneActions('admin')];

    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      expect(action.id).toMatch(/^[a-z0-9-]+$/);
      expect(action.label).not.toHaveLength(0);
      expect(action.requiredPermissions.length).toBeGreaterThan(0);
      expect(action.risk).toBeDefined();
      expect(action.readiness).toBeDefined();

      if (!action.enabled) {
        expect(action.blockerReason).toEqual(expect.stringContaining('Disabled until'));
      }
    }
  });
});
