import { queryOptions } from '@tanstack/react-query';

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

export const adminSections: readonly AdminSection[] = [
  {
    id: 'overview',
    path: '/admin',
    label: 'Overview',
    heading: 'Helix Admin',
    summary: 'Control-plane overview with safe read-only status placeholders.',
  },
  {
    id: 'tenants',
    path: '/admin/tenants',
    label: 'Tenants',
    heading: 'Tenants',
    summary: 'Tenant inventory placeholder scoped to authorized admin reads.',
  },
  {
    id: 'projects',
    path: '/admin/projects',
    label: 'Projects',
    heading: 'Projects',
    summary: 'Project inventory placeholder without mutation controls.',
  },
  {
    id: 'users-rbac',
    path: '/admin/users-rbac',
    label: 'Users/RBAC',
    heading: 'Users/RBAC',
    summary: 'User and role map placeholder backed by permission-only IAM.',
  },
  {
    id: 'billing',
    path: '/admin/billing',
    label: 'Billing',
    heading: 'Billing',
    summary: 'Billing status placeholder with no payment mutation controls.',
  },
  {
    id: 'processors',
    path: '/admin/processors',
    label: 'Processors',
    heading: 'Processors',
    summary: 'Processor health placeholder; steering remains disabled until audited.',
  },
  {
    id: 'jobs',
    path: '/admin/jobs',
    label: 'Jobs',
    heading: 'Jobs',
    summary: 'Jobs overview placeholder with payload details hidden by default.',
  },
  {
    id: 'workflows',
    path: '/admin/workflows',
    label: 'Workflows',
    heading: 'Workflows',
    summary: 'Workflow run placeholder with restart and replay controls disabled.',
  },
  {
    id: 'schedules',
    path: '/admin/schedules',
    label: 'Schedules',
    heading: 'Schedules',
    summary: 'Schedule visibility placeholder without runtime mutation actions.',
  },
  {
    id: 'replay-dlq',
    path: '/admin/replay-dlq',
    label: 'Replay/DLQ',
    heading: 'Replay/DLQ',
    summary: 'Replay and DLQ placeholder; redrive and mutation controls are locked.',
  },
  {
    id: 'audit',
    path: '/admin/audit',
    label: 'Audit',
    heading: 'Audit',
    summary: 'Audit trail placeholder for security-sensitive admin actions.',
  },
  {
    id: 'settings',
    path: '/admin/settings',
    label: 'Settings',
    heading: 'Settings',
    summary: 'Settings placeholder with dangerous overrides disabled.',
  },
];

export const adminDisabledControls: readonly AdminDisabledControl[] = [
  {
    id: 'replay-workflow',
    label: 'Replay workflow from checkpoint',
    reason: 'Disabled until replay compatibility and side-effect policies are enforced.',
  },
  {
    id: 'mutate-dlq',
    label: 'Mutate DLQ entry',
    reason: 'Disabled until DLQ mutations have confirmation, authorization, and audit flows.',
  },
  {
    id: 'steer-processor',
    label: 'Steer processor assignment',
    reason: 'Disabled until processor steering is backed by audited routing state machines.',
  },
  {
    id: 'override-quota',
    label: 'Override tenant quota',
    reason: 'Disabled until quota override policy and audit requirements are implemented.',
  },
];

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
