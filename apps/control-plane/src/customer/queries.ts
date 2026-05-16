import { queryOptions } from '@tanstack/react-query';

import { listControlPaneSections } from '../features/control-pane/registry.js';

export interface CustomerWorkspaceFeature {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly summary: string;
  readonly status: 'ready' | 'planned';
}

export interface CustomerWorkspaceOverview {
  readonly heading: 'Helix Control Plane';
  readonly routeStatus: 'Customer workspace ready';
  readonly workspace: '@helix/control-plane';
  readonly rawDataPolicy: 'Raw payloads and logs are hidden by default.';
  readonly features: readonly CustomerWorkspaceFeature[];
}

export const customerWorkspaceFeatures: readonly CustomerWorkspaceFeature[] = listControlPaneSections('customer')
  .filter((section) => section.id !== 'customer-overview')
  .map((section) => ({
    id: section.id,
    label: section.label,
    path: section.path,
    summary: section.summary,
    status: section.readiness === 'ready' ? 'ready' : 'planned',
  }));

export const customerWorkspaceOverviewQueryOptions = queryOptions({
  queryKey: ['customer', 'workspace', 'overview'] as const,
  queryFn: async (): Promise<CustomerWorkspaceOverview> => ({
    heading: 'Helix Control Plane',
    routeStatus: 'Customer workspace ready',
    workspace: '@helix/control-plane',
    rawDataPolicy: 'Raw payloads and logs are hidden by default.',
    features: customerWorkspaceFeatures,
  }),
});
