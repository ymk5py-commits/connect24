import type { BitrixCaller } from '../bitrix/client.js';
import {
  ackDelivered,
  ackRead,
  bbToWhatsApp,
  sendToBitrix,
  type OutboundMessageEvent,
} from '../bitrix/connector.js';
import type { InboundMessage, ProviderEvent, StatusUpdate, WhatsAppProvider } from '../providers/types.js';
import type { LineConfig, Store } from '../store.js';

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export interface BridgeDeps {
  store: Store;
  connectorId: string;
  bitrix: (memberId: string) => BitrixCaller;
  provider: (line: LineConfig) => WhatsAppProvider;
  log: Logger;
}

export interface WebhookResult {
  /** False when the route key is unknown or the line is inactive. */
  handled: boolean;
  failed: number;
}

/** Moves messages between the WhatsApp provider and a Bitrix24 Open Line, in both directions. */
export class Bridge {
  constructor(private readonly deps: BridgeDeps) {}

  /** WhatsApp (provider webhook) -> Bitrix. */
  async handleProviderWebhook(routeKey: string, body: unknown): Promise<WebhookResult> {
    const { store, log } = this.deps;
    const line = store.getLineByRoute(routeKey);
    if (!line || !line.active) return { handled: false, failed: 0 };

    const events = this.deps.provider(line).parseWebhook(body);
    let failed = 0;
    for (const event of events) {
      try {
        await this.processProviderEvent(line, event);
      } catch (err) {
        failed++;
        log.error({ err, lineId: line.lineId, providerMessageId: event.providerMessageId }, 'provider event failed');
      }
    }
    return { handled: true, failed };
  }

  private async processProviderEvent(line: LineConfig, event: ProviderEvent): Promise<void> {
    if (event.kind === 'message') return this.inbound(line, event);
    return this.status(line, event);
  }

  private async inbound(line: LineConfig, msg: InboundMessage): Promise<void> {
    const { store, log, connectorId } = this.deps;

    if (msg.origin === 'business_app') {
      // Coexistence echo: typed on the phone, not through Bitrix. Not mirrored into the chat yet.
      log.info({ lineId: line.lineId, to: msg.from }, 'skipping business-app echo');
      return;
    }
    if (!msg.text.trim()) return;
    if (store.findMessage(line.memberId, line.lineId, msg.providerMessageId)) return; // duplicate delivery

    await sendToBitrix(this.deps.bitrix(line.memberId), connectorId, line.lineId, [
      {
        user: { id: msg.from, name: msg.profileName || `+${msg.from}`, phone: `+${msg.from}` },
        message: { id: msg.providerMessageId, date: msg.timestamp, text: msg.text },
        chat: { id: msg.from, name: msg.profileName || `+${msg.from}` },
      },
    ]);

    // Recorded only after Bitrix accepted it, so a failed attempt is retried by the provider.
    store.recordMessage({
      providerMessageId: msg.providerMessageId,
      direction: 'in',
      memberId: line.memberId,
      lineId: line.lineId,
      imChatId: null,
      imMessageId: null,
      externalChatId: msg.from,
    });
  }

  private async status(line: LineConfig, update: StatusUpdate): Promise<void> {
    const { store, log, connectorId } = this.deps;
    const stored = store.findMessage(line.memberId, line.lineId, update.providerMessageId);
    if (!stored || stored.direction !== 'out' || !stored.imChatId || !stored.imMessageId) return;

    if (update.status === 'failed') {
      log.warn({ lineId: line.lineId, providerMessageId: update.providerMessageId }, 'WhatsApp reported a failed delivery');
      return;
    }
    if (update.status !== 'read') return; // "delivered" was already acknowledged when the provider accepted the message

    await ackRead(this.deps.bitrix(line.memberId), connectorId, line.lineId, [
      {
        im: { chat_id: stored.imChatId, message_id: stored.imMessageId },
        message: { id: [update.providerMessageId] },
        chat: { id: stored.externalChatId },
      },
    ]);
  }

  /** Bitrix operator reply (OnImConnectorMessageAdd) -> WhatsApp. */
  async handleBitrixMessages(
    memberId: string,
    connector: string,
    lineId: string,
    messages: OutboundMessageEvent[],
  ): Promise<{ sent: number; failed: number }> {
    const { store, log, connectorId } = this.deps;
    if (connector !== connectorId) return { sent: 0, failed: 0 };

    const line = store.getLine(memberId, lineId);
    if (!line || !line.active) {
      log.warn({ memberId, lineId }, 'outbound message for a line that is not configured/active');
      return { sent: 0, failed: messages.length };
    }

    const provider = this.deps.provider(line);
    const bitrix = this.deps.bitrix(memberId);
    let sent = 0;
    let failed = 0;

    for (const m of messages) {
      const text = outboundText(m);
      if (!text) continue;
      try {
        const { messageId } = await provider.sendText(m.chat.id, text);
        store.recordMessage({
          providerMessageId: messageId,
          direction: 'out',
          memberId,
          lineId,
          imChatId: String(m.im.chat_id),
          imMessageId: String(m.im.message_id),
          externalChatId: m.chat.id,
        });
        await ackDelivered(bitrix, connectorId, lineId, [
          {
            im: { chat_id: String(m.im.chat_id), message_id: String(m.im.message_id) },
            message: { id: [messageId] },
            chat: { id: m.chat.id },
          },
        ]);
        sent++;
      } catch (err) {
        failed++;
        log.error({ err, memberId, lineId, to: m.chat.id }, 'could not deliver operator message to WhatsApp');
      }
    }
    return { sent, failed };
  }

  /** Open Line removed in Bitrix -> forget its WhatsApp credentials. */
  handleLineDeleted(memberId: string, connector: string, lineId: string): void {
    if (connector !== this.deps.connectorId) return;
    this.deps.store.deleteLine(memberId, lineId);
  }

  /** Connector switched off for a line -> stop processing, keep the credentials. */
  handleConnectorDisabled(memberId: string, connector: string, lineId: string): void {
    if (connector !== this.deps.connectorId) return;
    const line = this.deps.store.getLine(memberId, lineId);
    if (line) this.deps.store.upsertLine({ ...line, active: false });
  }
}

function outboundText(m: OutboundMessageEvent): string {
  const parts: string[] = [];
  if (m.message.text) parts.push(bbToWhatsApp(m.message.text));
  for (const file of m.message.files ?? []) {
    const link = file.link ?? file.url;
    if (link) parts.push(`📎 ${file.name ?? 'Archivo'}: ${link}`);
  }
  return parts.join('\n').trim();
}
