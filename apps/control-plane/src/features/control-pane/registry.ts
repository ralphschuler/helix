export type ControlPaneAudience = 'customer' | 'admin' | 'both';
export type ControlPaneRisk = 'safe' | 'moderate' | 'dangerous';
export type ControlPaneReadiness = 'ready' | 'planned' | 'blocked';
export type ControlPaneRawDataPolicy = 'hidden-by-default' | 'redacted' | 'not-applicable';

export interface ControlPaneAction {
  readonly id: string;
  readonly label: string;
  readonly audience: ControlPaneAudience;
  readonly requiredPermissions: readonly string[];
  readonly risk: ControlPaneRisk;
  readonly readiness: ControlPaneReadiness;
  readonly enabled: boolean;
  readonly blockerReason?: string;
}

export interface ControlPaneSection {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly audience: ControlPaneAudience;
  readonly summary: string;
  readonly featureDomain: string;
  readonly requiredPermissions: readonly string[];
  readonly readiness: ControlPaneReadiness;
  readonly risk: ControlPaneRisk;
  readonly rawDataPolicy: ControlPaneRawDataPolicy;
  readonly enabled: boolean;
  readonly blockerReason?: string;
  readonly actions: readonly ControlPaneAction[];
}

const adminRead = ['admin:read'] as const;
const projectRead = ['project:read'] as const;
const projectWrite = ['project:write'] as const;
const billingRead = ['billing:read'] as const;

function readAction(id: string, label: string, audience: ControlPaneAudience, permissions: readonly string[]): ControlPaneAction {
  return { id, label, audience, requiredPermissions: permissions, risk: 'safe', readiness: 'ready', enabled: true };
}

function blockedAction(
  id: string,
  label: string,
  audience: ControlPaneAudience,
  permissions: readonly string[],
  blockerReason: string,
): ControlPaneAction {
  return {
    id,
    label,
    audience,
    requiredPermissions: permissions,
    risk: 'dangerous',
    readiness: 'blocked',
    enabled: false,
    blockerReason,
  };
}

export const controlPaneSections: readonly ControlPaneSection[] = [
  {
    id: 'customer-overview',
    label: 'Overview',
    path: '/',
    audience: 'customer',
    summary: 'Customer workspace overview with tenant/project-scoped status.',
    featureDomain: 'workspace',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [readAction('view-customer-overview', 'View workspace overview', 'customer', projectRead)],
  },
  {
    id: 'jobs',
    label: 'Jobs',
    path: '/jobs',
    audience: 'both',
    summary: 'Create, inspect, and track tenant/project-scoped jobs.',
    featureDomain: 'jobs',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [
      readAction('view-jobs', 'View jobs', 'both', projectRead),
      readAction('create-job', 'Create job', 'customer', projectWrite),
    ],
  },
  {
    id: 'workflows',
    label: 'Workflows',
    path: '/workflows',
    audience: 'both',
    summary: 'Inspect workflow definitions, runs, checkpoints, and stream links.',
    featureDomain: 'workflows',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [
      readAction('view-workflows', 'View workflows', 'both', projectRead),
      blockedAction(
        'replay-workflow',
        'Replay workflow from checkpoint',
        'admin',
        adminRead,
        'Disabled until replay compatibility and side-effect policies are enforced.',
      ),
    ],
  },
  {
    id: 'processors',
    label: 'Processors',
    path: '/processors',
    audience: 'both',
    summary: 'Monitor processor health, capabilities, routing, and regions.',
    featureDomain: 'processors',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [
      readAction('view-processors', 'View processors', 'both', projectRead),
      blockedAction(
        'steer-processor',
        'Steer processor assignment',
        'admin',
        adminRead,
        'Disabled until processor steering is backed by audited routing state machines.',
      ),
    ],
  },
  {
    id: 'schedules',
    label: 'Schedules',
    path: '/schedules',
    audience: 'both',
    summary: 'Manage delayed, cron, and interval automation for this project.',
    featureDomain: 'schedules',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [readAction('view-schedules', 'View schedules', 'both', projectRead)],
  },
  {
    id: 'streams',
    label: 'Streams',
    path: '/streams',
    audience: 'both',
    summary: 'Observe workflow and job event streams with cursor resume behavior.',
    featureDomain: 'streams',
    requiredPermissions: projectRead,
    readiness: 'ready',
    risk: 'safe',
    rawDataPolicy: 'hidden-by-default',
    enabled: true,
    actions: [readAction('view-streams', 'View event streams', 'both', projectRead)],
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    path: '/api-keys',
    audience: 'customer',
    summary: 'Project API key management is planned behind permissioned controls.',
    featureDomain: 'iam',
    requiredPermissions: projectRead,
    readiness: 'planned',
    risk: 'moderate',
    rawDataPolicy: 'redacted',
    enabled: false,
    blockerReason: 'Disabled until API key create/revoke flows include scoped permissions, redaction, and audit events.',
    actions: [blockedAction('create-api-key', 'Create API key', 'customer', projectWrite, 'Disabled until token secret storage and audit flows are complete.')],
  },
  {
    id: 'billing',
    label: 'Billing',
    path: '/billing',
    audience: 'both',
    summary: 'Billing posture is visible while payment mutations stay gated.',
    featureDomain: 'billing',
    requiredPermissions: billingRead,
    readiness: 'planned',
    risk: 'moderate',
    rawDataPolicy: 'redacted',
    enabled: false,
    blockerReason: 'Disabled until billing read models and payment mutation gates are wired.',
    actions: [readAction('view-billing', 'View billing posture', 'both', billingRead)],
  },
  {
    id: 'settings',
    label: 'Project Settings',
    path: '/settings',
    audience: 'customer',
    summary: 'Project and retention settings are planned with audit-backed controls.',
    featureDomain: 'settings',
    requiredPermissions: projectRead,
    readiness: 'planned',
    risk: 'moderate',
    rawDataPolicy: 'hidden-by-default',
    enabled: false,
    blockerReason: 'Disabled until settings mutations are permissioned, validated, and audited.',
    actions: [blockedAction('update-project-settings', 'Update project settings', 'customer', projectWrite, 'Disabled until audited settings mutations are implemented.')],
  },
  ...(
    [
      ['overview', 'Overview', '/admin', 'Control-plane overview with safe read-only status placeholders.', 'workspace'],
    ['tenants', 'Tenants', '/admin/tenants', 'Tenant inventory placeholder scoped to authorized admin reads.', 'tenants'],
    ['projects', 'Projects', '/admin/projects', 'Project inventory placeholder without mutation controls.', 'projects'],
    ['users-rbac', 'Users/RBAC', '/admin/users-rbac', 'User and role map placeholder backed by permission-only IAM.', 'iam'],
    ['admin-billing', 'Billing', '/admin/billing', 'Billing status placeholder with no payment mutation controls.', 'billing'],
    ['admin-processors', 'Processors', '/admin/processors', 'Processor health placeholder; steering remains disabled until audited.', 'processors'],
    ['admin-jobs', 'Jobs', '/admin/jobs', 'Jobs overview placeholder with payload details hidden by default.', 'jobs'],
    ['admin-workflows', 'Workflows', '/admin/workflows', 'Workflow run placeholder with restart and replay controls disabled.', 'workflows'],
    ['admin-schedules', 'Schedules', '/admin/schedules', 'Schedule visibility placeholder without runtime mutation actions.', 'schedules'],
    ['admin-streams', 'Streams', '/admin/streams', 'Event stream placeholder with payload details hidden by default.', 'streams'],
    ['replay-dlq', 'Replay/DLQ', '/admin/replay-dlq', 'Replay and DLQ placeholder; redrive and mutation controls are locked.', 'runtime'],
    ['audit', 'Audit', '/admin/audit', 'Audit trail placeholder for security-sensitive admin actions.', 'audit'],
    ['admin-settings', 'Settings', '/admin/settings', 'Settings placeholder with dangerous overrides disabled.', 'settings'],
    ['storage', 'Storage', '/admin/storage', 'Storage posture placeholder with raw payload access gated.', 'storage'],
    ['quotas', 'Quotas', '/admin/quotas', 'Quota visibility placeholder with overrides disabled.', 'quotas'],
    ['health', 'Health', '/admin/health', 'Service health placeholder for operational readiness.', 'health'],
  ] as const).map(([id, label, path, summary, featureDomain]) => ({
    id,
    label,
    path,
    audience: 'admin' as const,
    summary,
    featureDomain,
    requiredPermissions: adminRead,
    readiness: 'ready' as const,
    risk: 'safe' as const,
    rawDataPolicy: 'hidden-by-default' as const,
    enabled: true,
    actions: [
      readAction(`view-${id}`, `View ${label}`, 'admin', adminRead),
      ...(id === 'replay-dlq'
        ? [blockedAction('mutate-dlq', 'Mutate DLQ entry', 'admin', adminRead, 'Disabled until DLQ mutations have confirmation, authorization, and audit flows.')]
        : []),
      ...(id === 'quotas'
        ? [blockedAction('override-quota', 'Override tenant quota', 'admin', adminRead, 'Disabled until quota override policy and audit requirements are implemented.')]
        : []),
    ],
  })),
];

export function listControlPaneSections(audience: 'customer' | 'admin'): readonly ControlPaneSection[] {
  return controlPaneSections.filter((section) => section.audience === audience || (audience === 'customer' && section.audience === 'both'));
}

export function findControlPaneSectionById(id: string): ControlPaneSection | undefined {
  return controlPaneSections.find((section) => section.id === id);
}

export function listControlPaneActions(audience: 'customer' | 'admin'): readonly ControlPaneAction[] {
  return controlPaneSections.flatMap((section) =>
    section.actions.filter((action) => action.audience === audience || action.audience === 'both'),
  );
}
