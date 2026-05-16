import { Buffer } from 'node:buffer';

import type { RuntimeEventRecord } from './transactional-outbox.js';

export interface RuntimeEventCursorPayload {
  readonly sequence: number;
}

export interface RuntimeEventStoreRow {
  readonly sequence: number;
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly orderingKey: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly projectedAt: Date;
  readonly retainedUntil: Date | null;
  readonly cursor: string;
}

export interface RuntimeEventStoreListInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly after?: string | null;
  readonly limit: number;
}

export interface RuntimeEventStoreListResult {
  readonly events: RuntimeEventStoreRow[];
  readonly nextCursor: string | null;
}

export interface RuntimeEventStoreProjection {
  project(event: RuntimeEventRecord): Promise<RuntimeEventStoreRow>;
  list(input: RuntimeEventStoreListInput): Promise<RuntimeEventStoreListResult>;
}

export interface InMemoryRuntimeEventStoreProjectionOptions {
  readonly now?: () => Date;
  readonly retainForDays?: number;
}

const cursorPrefix = 'hes_';
const msPerDay = 24 * 60 * 60 * 1000;

export function encodeRuntimeEventCursor(payload: RuntimeEventCursorPayload): string {
  if (!Number.isInteger(payload.sequence) || payload.sequence < 1) {
    throw new Error('Runtime event cursor sequence must be a positive integer.');
  }

  return `${cursorPrefix}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

export function decodeRuntimeEventCursor(cursor: string): RuntimeEventCursorPayload {
  try {
    if (!cursor.startsWith(cursorPrefix)) {
      throw new Error('missing prefix');
    }

    const decoded = JSON.parse(Buffer.from(cursor.slice(cursorPrefix.length), 'base64url').toString('utf8')) as unknown;

    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('not an object');
    }

    const sequence = (decoded as { readonly sequence?: unknown }).sequence;

    if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
      throw new Error('invalid sequence');
    }

    return { sequence };
  } catch {
    throw new Error('Invalid runtime event cursor.');
  }
}

export class InMemoryRuntimeEventStoreProjection implements RuntimeEventStoreProjection {
  private readonly now: () => Date;
  private readonly retainForDays: number | null;
  private readonly rows: RuntimeEventStoreRow[] = [];
  private nextSequence = 1;

  constructor(options: InMemoryRuntimeEventStoreProjectionOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.retainForDays = options.retainForDays ?? null;
  }

  async project(event: RuntimeEventRecord): Promise<RuntimeEventStoreRow> {
    const existing = this.rows.find(
      (row) => row.tenantId === event.tenantId && row.projectId === event.projectId && row.eventId === event.id,
    );

    if (existing !== undefined) {
      return cloneRow(existing);
    }

    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const row: RuntimeEventStoreRow = {
      sequence,
      tenantId: event.tenantId,
      projectId: event.projectId,
      eventId: event.id,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      orderingKey: event.orderingKey,
      payload: cloneJsonObject(event.payload),
      occurredAt: new Date(event.occurredAt),
      recordedAt: new Date(event.recordedAt),
      projectedAt: this.now(),
      retainedUntil: this.retainedUntil(event.occurredAt),
      cursor: encodeRuntimeEventCursor({ sequence }),
    };

    this.rows.push(row);
    return cloneRow(row);
  }

  async list(input: RuntimeEventStoreListInput): Promise<RuntimeEventStoreListResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error('Runtime event list limit must be a positive integer.');
    }

    const afterSequence = input.after === undefined || input.after === null
      ? 0
      : decodeRuntimeEventCursor(input.after).sequence;
    const events = this.rows
      .filter(
        (row) =>
          row.tenantId === input.tenantId &&
          row.projectId === input.projectId &&
          row.sequence > afterSequence,
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, input.limit)
      .map(cloneRow);

    const last = events.at(-1);
    const hasMore = last !== undefined && this.rows.some(
      (row) => row.tenantId === input.tenantId && row.projectId === input.projectId && row.sequence > last.sequence,
    );

    return { events, nextCursor: hasMore ? last.cursor : null };
  }

  private retainedUntil(occurredAt: Date): Date | null {
    return this.retainForDays === null ? null : new Date(occurredAt.getTime() + this.retainForDays * msPerDay);
  }
}

function cloneRow(row: RuntimeEventStoreRow): RuntimeEventStoreRow {
  return {
    ...row,
    payload: cloneJsonObject(row.payload),
    occurredAt: new Date(row.occurredAt),
    recordedAt: new Date(row.recordedAt),
    projectedAt: new Date(row.projectedAt),
    retainedUntil: row.retainedUntil === null ? null : new Date(row.retainedUntil),
  };
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
