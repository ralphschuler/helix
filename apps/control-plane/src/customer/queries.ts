import { queryOptions } from '@tanstack/react-query';

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

export const customerWorkspaceFeatures: readonly CustomerWorkspaceFeature[] = [
  {
    id: 'jobs',
    label: 'Jobs',
    path: '/jobs',
    summary: 'Create, inspect, and track tenant/project-scoped jobs.',
    status: 'ready',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    path: '/workflows',
    summary: 'Inspect workflow definitions, runs, checkpoints, and stream links.',
    status: 'ready',
  },
  {
    id: 'processors',
    label: 'Processors',
    path: '/processors',
    summary: 'Monitor processor health, capabilities, routing, and regions.',
    status: 'ready',
  },
  {
    id: 'schedules',
    label: 'Schedules',
    path: '/schedules',
    summary: 'Manage delayed, cron, and interval automation for this project.',
    status: 'ready',
  },
  {
    id: 'streams',
    label: 'Streams',
    path: '/streams',
    summary: 'Observe workflow and job event streams with cursor resume behavior.',
    status: 'ready',
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    path: '/api-keys',
    summary: 'Project API key management is planned behind permissioned controls.',
    status: 'planned',
  },
  {
    id: 'billing',
    label: 'Billing',
    path: '/billing',
    summary: 'Billing posture is visible while payment mutations stay gated.',
    status: 'planned',
  },
  {
    id: 'settings',
    label: 'Project Settings',
    path: '/settings',
    summary: 'Project and retention settings are planned with audit-backed controls.',
    status: 'planned',
  },
];

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
