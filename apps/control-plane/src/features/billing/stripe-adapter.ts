import { createHmac, timingSafeEqual } from 'node:crypto';

import type { BillingStatus } from '@helix/contracts';

export interface StripeWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly customerId: string;
  readonly subscriptionId: string | null;
  readonly subscriptionStatus: BillingStatus | null;
  readonly createdAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface StripeBillingAdapter {
  constructWebhookEvent(input: {
    readonly rawBody: string;
    readonly signatureHeader: string | null;
  }): Promise<StripeWebhookEvent>;
}

export interface LocalStripeBillingAdapterOptions {
  readonly endpointSecret: string;
  readonly now?: () => Date;
  readonly toleranceSeconds?: number;
}

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super('Invalid Stripe webhook signature.');
    this.name = 'StripeWebhookSignatureError';
  }
}

export class StripeWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookPayloadError';
  }
}

export class LocalStripeBillingAdapter implements StripeBillingAdapter {
  private readonly endpointSecret: string;
  private readonly now: () => Date;
  private readonly toleranceSeconds: number;

  constructor(options: LocalStripeBillingAdapterOptions) {
    this.endpointSecret = options.endpointSecret;
    this.now = options.now ?? (() => new Date());
    this.toleranceSeconds = options.toleranceSeconds ?? 300;
  }

  async constructWebhookEvent(input: {
    readonly rawBody: string;
    readonly signatureHeader: string | null;
  }): Promise<StripeWebhookEvent> {
    if (
      !verifyStripeWebhookSignature({
        endpointSecret: this.endpointSecret,
        now: this.now(),
        rawBody: input.rawBody,
        signatureHeader: input.signatureHeader,
        toleranceSeconds: this.toleranceSeconds,
      })
    ) {
      throw new StripeWebhookSignatureError();
    }

    return parseStripeWebhookEventPayload(input.rawBody, this.now());
  }
}

export function createStripeWebhookSignatureHeader(input: {
  readonly endpointSecret: string;
  readonly rawBody: string;
  readonly timestamp: number;
}): string {
  const signature = createHmac('sha256', input.endpointSecret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest('hex');

  return `t=${input.timestamp},v1=${signature}`;
}

export function verifyStripeWebhookSignature(input: {
  readonly endpointSecret: string;
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  readonly now: Date;
  readonly toleranceSeconds: number;
}): boolean {
  if (input.signatureHeader === null || input.endpointSecret.trim().length === 0) {
    return false;
  }

  const parsed = parseStripeSignatureHeader(input.signatureHeader);

  if (parsed === null) {
    return false;
  }

  const nowSeconds = Math.floor(input.now.getTime() / 1000);

  if (Math.abs(nowSeconds - parsed.timestamp) > input.toleranceSeconds) {
    return false;
  }

  const expectedHeader = createStripeWebhookSignatureHeader({
    endpointSecret: input.endpointSecret,
    rawBody: input.rawBody,
    timestamp: parsed.timestamp,
  });
  const expected = parseStripeSignatureHeader(expectedHeader)?.v1Signatures[0];

  if (expected === undefined) {
    return false;
  }

  return parsed.v1Signatures.some((signature) => timingSafeEqualHex(signature, expected));
}

function parseStripeSignatureHeader(
  signatureHeader: string,
): { readonly timestamp: number; readonly v1Signatures: readonly string[] } | null {
  const parts = signatureHeader.split(',');
  let timestamp: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=', 2);

    if (key === undefined || value === undefined) {
      continue;
    }

    if (key === 't') {
      const parsedTimestamp = Number.parseInt(value, 10);
      timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
    }

    if (key === 'v1') {
      v1Signatures.push(value);
    }
  }

  if (timestamp === null || v1Signatures.length === 0) {
    return null;
  }

  return { timestamp, v1Signatures };
}

function timingSafeEqualHex(leftHex: string, rightHex: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(leftHex) || !/^[a-f0-9]{64}$/u.test(rightHex)) {
    return false;
  }

  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');

  return left.length === right.length && timingSafeEqual(left, right);
}

function parseStripeWebhookEventPayload(
  rawBody: string,
  fallbackNow: Date,
): StripeWebhookEvent {
  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(rawBody) as unknown;
  } catch {
    throw new StripeWebhookPayloadError('Stripe webhook payload must be valid JSON.');
  }

  if (!isRecord(parsedPayload)) {
    throw new StripeWebhookPayloadError('Stripe webhook payload must be an object.');
  }

  const eventId = readNonBlankString(parsedPayload.id, 'Stripe event id');
  const eventType = readNonBlankString(parsedPayload.type, 'Stripe event type');
  const data = isRecord(parsedPayload.data) ? parsedPayload.data : null;
  const stripeObject = data !== null && isRecord(data.object) ? data.object : null;

  if (stripeObject === null) {
    throw new StripeWebhookPayloadError('Stripe webhook data.object must be an object.');
  }

  const customerId = readStripeCustomerId(stripeObject.customer);

  if (customerId === null) {
    throw new StripeWebhookPayloadError('Stripe webhook data.object.customer is required.');
  }

  return {
    id: eventId,
    type: eventType,
    customerId,
    subscriptionId: readSubscriptionId(eventType, stripeObject),
    subscriptionStatus: readSubscriptionStatus(stripeObject.status),
    createdAt: readCreatedAt(parsedPayload.created, fallbackNow),
    payload: parsedPayload,
  };
}

function readNonBlankString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StripeWebhookPayloadError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readStripeCustomerId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (isRecord(value) && typeof value.id === 'string' && value.id.trim().length > 0) {
    return value.id;
  }

  return null;
}

function readSubscriptionId(
  eventType: string,
  stripeObject: Readonly<Record<string, unknown>>,
): string | null {
  if (
    eventType.startsWith('customer.subscription.') &&
    typeof stripeObject.id === 'string' &&
    stripeObject.id.trim().length > 0
  ) {
    return stripeObject.id;
  }

  if (typeof stripeObject.subscription === 'string' && stripeObject.subscription.trim().length > 0) {
    return stripeObject.subscription;
  }

  return null;
}

function readSubscriptionStatus(value: unknown): BillingStatus | null {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete';
    default:
      return null;
  }
}

function readCreatedAt(value: unknown, fallbackNow: Date): Date {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000);
  }

  return fallbackNow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
