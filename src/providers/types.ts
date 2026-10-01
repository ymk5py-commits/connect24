/** A message typed by the customer (or, with coexistence, sent from the WhatsApp Business App on the phone). */
export interface InboundMessage {
  kind: 'message';
  providerMessageId: string;
  /** Customer's WhatsApp id (digits, international format, no "+"). */
  from: string;
  profileName?: string;
  /** Epoch seconds. */
  timestamp: number;
  text: string;
  /**
   * customer      -> typed by the customer, forward to Bitrix.
   * business_app  -> echo of a message the business typed on the phone (coexistence); not forwarded yet.
   */
  origin: 'customer' | 'business_app';
}

export interface StatusUpdate {
  kind: 'status';
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
}

export type ProviderEvent = InboundMessage | StatusUpdate;

export interface WhatsAppProvider {
  /** Turns a raw webhook body into normalized events. Must never throw on unknown payloads. */
  parseWebhook(body: unknown): ProviderEvent[];
  /** Sends a text message; resolves with the provider's message id. */
  sendText(to: string, text: string): Promise<{ messageId: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
