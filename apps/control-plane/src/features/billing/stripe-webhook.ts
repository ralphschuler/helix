import type { BillingService, HandleStripeWebhookResult } from './billing-service.js';
import type { StripeBillingAdapter } from './stripe-adapter.js';

export interface BillingWebhookHandlerInput {
  readonly rawBody: string;
  readonly signatureHeader: string | null;
}

export interface BillingWebhookHandler {
  handle(input: BillingWebhookHandlerInput): Promise<HandleStripeWebhookResult>;
}

export interface StripeBillingWebhookHandlerOptions {
  readonly adapter: StripeBillingAdapter;
  readonly service: BillingService;
}

export class StripeBillingWebhookHandler implements BillingWebhookHandler {
  private readonly adapter: StripeBillingAdapter;
  private readonly service: BillingService;

  constructor(options: StripeBillingWebhookHandlerOptions) {
    this.adapter = options.adapter;
    this.service = options.service;
  }

  async handle(input: BillingWebhookHandlerInput): Promise<HandleStripeWebhookResult> {
    const event = await this.adapter.constructWebhookEvent(input);

    return this.service.handleStripeWebhook(event);
  }
}
