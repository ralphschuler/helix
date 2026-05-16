import { queryOptions } from '@tanstack/react-query';

import { listControlPaneActions, listControlPaneSections } from '../features/control-pane/registry.js';

export interface AdminSection {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly heading: string;
  readonly summary: string;
}

export interface AdminDisabledControl {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

export interface AdminOverview {
  readonly heading: 'Helix Admin';
  readonly routeStatus: 'Protected-ready admin route';
  readonly workspace: '@helix/control-plane';
  readonly sections: readonly AdminSection[];
  readonly disabledControls: readonly AdminDisabledControl[];
  readonly rawDataPolicy: 'Raw payloads and logs are hidden by default.';
}

export const adminSections: readonly AdminSection[] = listControlPaneSections('admin').map((section) => ({
  id: section.id,
  path: section.path,
  label: section.label,
  heading: section.label === 'Overview' ? 'Helix Admin' : section.label,
  summary: section.summary,
}));

export const adminDisabledControls: readonly AdminDisabledControl[] = listControlPaneActions('admin')
  .filter((action) => !action.enabled)
  .map((action) => ({
    id: action.id,
    label: action.label,
    reason: action.blockerReason ?? 'Disabled until backend support is complete.',
  }));

export function findAdminSectionById(id: string): AdminSection | undefined {
  return adminSections.find((section) => section.id === id);
}

export const adminOverviewQueryOptions = queryOptions({
  queryKey: ['admin', 'overview'] as const,
  queryFn: async (): Promise<AdminOverview> => ({
    heading: 'Helix Admin',
    routeStatus: 'Protected-ready admin route',
    workspace: '@helix/control-plane',
    sections: adminSections,
    disabledControls: adminDisabledControls,
    rawDataPolicy: 'Raw payloads and logs are hidden by default.',
  }),
});
