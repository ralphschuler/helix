import type { AuthPrincipal } from '@helix/contracts';

export interface SecurityAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly actor: AuthPrincipal;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface SecurityAuditSink {
  record(event: SecurityAuditEvent): Promise<void>;
}
