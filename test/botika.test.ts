import { describe, expect, it } from 'vitest';
import { BotikaProvider } from '../src/providers/botika.js';
import { ProviderError } from '../src/providers/types.js';

const cfg = { baseUrl: 'https://api.botika.example/', token: 'tok', phoneNumberId: '555' };
const wrap = (field: string, value: object) => ({ entry: [{ changes: [{ field, value }] }] });

describe('BotikaProvider.parseWebhook', () => {
  const p = new BotikaProvider(cfg);

  it('parses a customer text message with profile name', () => {
    const events = p.parseWebhook(
      wrap('messages', {
        contacts: [{ wa_id: '595981000111', profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.1', from: '595981000111', timestamp: '1700000000', type: 'text', text: { body: 'Hola' } }],
      }),
    );
    expect(events).toEqual([
      { kind: 'message', providerMessageId: 'wamid.1', from: '595981000111', profileName: 'Ana', timestamp: 1700000000, text: 'Hola', origin: 'customer' },
    ]);
  });

  it('turns media into a readable placeholder', () => {
    const [e] = p.parseWebhook(wrap('messages', { messages: [{ id: 'm', from: '1', type: 'image', image: { caption: 'mira' } }] }));
    expect(e).toMatchObject({ kind: 'message', text: '[📷 Imagen] mira' });
  });

  it('marks coexistence echoes as business_app and uses the recipient as the customer', () => {
    const [e] = p.parseWebhook(wrap('smb_message_echoes', { message_echoes: [{ id: 'e1', to: '595981000111', type: 'text', text: { body: 'desde el celular' } }] }));
    expect(e).toMatchObject({ kind: 'message', origin: 'business_app', from: '595981000111', text: 'desde el celular' });
  });

  it('parses statuses and ignores unknown ones', () => {
    const events = p.parseWebhook(wrap('messages', { statuses: [{ id: 's1', status: 'read', recipient_id: '1' }, { id: 's2', status: 'weird' }] }));
    expect(events).toEqual([{ kind: 'status', providerMessageId: 's1', status: 'read', recipient: '1' }]);
  });

  it('never throws on garbage', () => {
    for (const junk of [null, 'x', 42, [], {}, { entry: 'no' }, { entry: [null, { changes: [1] }] }]) {
      expect(p.parseWebhook(junk)).toEqual([]);
    }
  });
});

describe('BotikaProvider.sendText', () => {
  it('posts to {base}/{phoneNumberId}/messages with bearer auth', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await new BotikaProvider(cfg, fetchFn).sendText('595981000111', 'Hola');
    expect(out.messageId).toBe('wamid.X');
    expect(seen?.url).toBe('https://api.botika.example/555/messages');
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(seen?.init.body))).toMatchObject({ to: '595981000111', type: 'text', text: { body: 'Hola' } });
  });

  it('throws ProviderError with status on HTTP failure', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { message: 'window closed' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(new BotikaProvider(cfg, fetchFn).sendText('1', 'x')).rejects.toMatchObject({ name: 'ProviderError', status: 400 });
    await expect(new BotikaProvider(cfg, fetchFn).sendText('1', 'x')).rejects.toBeInstanceOf(ProviderError);
  });
});
