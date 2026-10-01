import { ProviderError } from './types.js';
import type { InboundMessage, ProviderEvent, StatusUpdate, WhatsAppProvider } from './types.js';

/**
 * Botika adapter.
 *
 * ASSUMPTION - TO VERIFY: Botika's WhatsApp Business API docs (waofficial.botika.online/docs/api/overview)
 * could not be read while building this (host blocked by the sandbox proxy). This adapter therefore assumes
 * Botika exposes the Meta WhatsApp Cloud API shape:
 *   - send:    POST {baseUrl}/{phoneNumberId}/messages   with Bearer token
 *   - webhook: { entry: [{ changes: [{ field, value: { messages | statuses | message_echoes } }] }] }
 * If Botika's real contract differs, only this file needs to change: nothing else in the app knows the
 * wire format.
 */
export interface BotikaConfig {
  baseUrl: string;
  token: string;
  phoneNumberId: string;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export class BotikaProvider implements WhatsAppProvider {
  constructor(
    private readonly cfg: BotikaConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  parseWebhook(body: unknown): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    if (!isObj(body)) return events;

    for (const entry of arr(body.entry)) {
      if (!isObj(entry)) continue;
      for (const change of arr(entry.changes)) {
        if (!isObj(change) || !isObj(change.value)) continue;
        const value = change.value;
        const field = str(change.field);

        const names = new Map<string, string>();
        for (const contact of arr(value.contacts)) {
          if (isObj(contact) && isObj(contact.profile)) names.set(str(contact.wa_id), str(contact.profile.name));
        }

        for (const m of arr(value.messages)) {
          const parsed = this.parseMessage(m, 'customer', names);
          if (parsed) events.push(parsed);
        }
        // Coexistence: messages typed on the phone's WhatsApp Business App are echoed to the API.
        const echoes = field === 'smb_message_echoes' ? value.message_echoes : undefined;
        for (const m of arr(echoes)) {
          const parsed = this.parseMessage(m, 'business_app', names);
          if (parsed) events.push(parsed);
        }

        for (const s of arr(value.statuses)) {
          if (!isObj(s)) continue;
          const status = str(s.status);
          if (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed') continue;
          const update: StatusUpdate = {
            kind: 'status',
            providerMessageId: str(s.id),
            status,
            recipient: str(s.recipient_id),
          };
          if (update.providerMessageId) events.push(update);
        }
      }
    }
    return events;
  }

  private parseMessage(raw: unknown, origin: InboundMessage['origin'], names: Map<string, string>): InboundMessage | undefined {
    if (!isObj(raw)) return undefined;
    const id = str(raw.id);
    // For echoes the customer is the recipient ("to"); for inbound messages it is the sender ("from").
    const from = origin === 'customer' ? str(raw.from) : str(raw.to);
    if (!id || !from) return undefined;

    return {
      kind: 'message',
      providerMessageId: id,
      from,
      profileName: names.get(from) || undefined,
      timestamp: Number(raw.timestamp) || Math.floor(Date.now() / 1000),
      text: describeContent(raw),
      origin,
    };
  }

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    const res = await this.fetchFn(`${base}/${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: true, body: text },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const detail = isObj(body.error) ? str(body.error.message) : '';
      throw new ProviderError(`Botika send failed (HTTP ${res.status}) ${detail}`.trim(), res.status);
    }
    const messageId = isObj(arr(body.messages)[0]) ? str((arr(body.messages)[0] as Json).id) : '';
    if (!messageId) throw new ProviderError('Botika send succeeded but returned no message id');
    return { messageId };
  }
}

/** v0.1 forwards text only; other content types become a readable placeholder so operators see something. */
function describeContent(m: Json): string {
  const type = str(m.type);
  if (type === 'text' && isObj(m.text)) return str(m.text.body);
  if (type === 'button' && isObj(m.button)) return str(m.button.text);
  if (type === 'interactive' && isObj(m.interactive)) {
    const reply = isObj(m.interactive.button_reply) ? m.interactive.button_reply : isObj(m.interactive.list_reply) ? m.interactive.list_reply : undefined;
    if (reply) return str(reply.title);
  }

  const labels: Record<string, string> = {
    image: '📷 Imagen',
    video: '🎬 Video',
    audio: '🎤 Audio',
    voice: '🎤 Nota de voz',
    document: '📄 Documento',
    sticker: '🏷️ Sticker',
    location: '📍 Ubicación',
    contacts: '👤 Contacto',
  };
  const label = labels[type] ?? `[mensaje tipo "${type || 'desconocido'}"]`;
  const media = isObj(m[type]) ? (m[type] as Json) : undefined;
  const caption = media ? str(media.caption) : '';
  const filename = media ? str(media.filename) : '';
  return [`[${label}]`, filename, caption].filter(Boolean).join(' ');
}
