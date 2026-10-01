import { describe, expect, it } from 'vitest';
import type { OutboundMessageEvent } from '../src/bitrix/connector.js';
import { makeCtx, MEMBER, seedInstallation, seedLine } from './helpers.js';

const inbound = (over: Record<string, unknown> = {}) => ({
  kind: 'message' as const,
  providerMessageId: 'wamid.IN1',
  from: '595981000111',
  profileName: 'Ana',
  timestamp: 1700000000,
  text: 'Hola',
  origin: 'customer' as const,
  ...over,
});

const outbound = (text = 'Buenas'): OutboundMessageEvent => ({
  im: { chat_id: '77', message_id: '900' },
  message: { id: ['b-1'], text },
  chat: { id: '595981000111' },
});

describe('WhatsApp -> Bitrix', () => {
  it('forwards a customer message to the open line', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    seedInstallation(store);
    const line = seedLine(store);
    provider.events = [inbound()];

    const res = await bridge.handleProviderWebhook(line.routeKey, {});
    expect(res).toEqual({ handled: true, failed: 0 });

    const [call] = bitrix.of('imconnector.send.messages');
    expect(call?.params).toMatchObject({
      CONNECTOR: 'connect24_whatsapp',
      LINE: '1',
      MESSAGES: [{ user: { id: '595981000111', name: 'Ana' }, message: { id: 'wamid.IN1', text: 'Hola' }, chat: { id: '595981000111' } }],
    });
  });

  it('falls back to +number when there is no profile name', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    const line = seedLine(store);
    provider.events = [inbound({ profileName: undefined })];
    await bridge.handleProviderWebhook(line.routeKey, {});
    expect(bitrix.of('imconnector.send.messages')[0]?.params).toMatchObject({ MESSAGES: [{ user: { name: '+595981000111' } }] });
  });

  it('de-duplicates redelivered webhooks', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    const line = seedLine(store);
    provider.events = [inbound()];
    await bridge.handleProviderWebhook(line.routeKey, {});
    await bridge.handleProviderWebhook(line.routeKey, {});
    expect(bitrix.of('imconnector.send.messages')).toHaveLength(1);
  });

  it('does not record a message when Bitrix rejects it, so the provider retry is processed', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    const line = seedLine(store);
    provider.events = [inbound()];
    bitrix.failOn.add('imconnector.send.messages');
    expect(await bridge.handleProviderWebhook(line.routeKey, {})).toEqual({ handled: true, failed: 1 });

    bitrix.failOn.clear();
    expect(await bridge.handleProviderWebhook(line.routeKey, {})).toEqual({ handled: true, failed: 0 });
    expect(bitrix.of('imconnector.send.messages')).toHaveLength(2);
  });

  it('ignores coexistence echoes and empty messages', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    const line = seedLine(store);
    provider.events = [inbound({ origin: 'business_app' }), inbound({ providerMessageId: 'w2', text: '  ' })];
    await bridge.handleProviderWebhook(line.routeKey, {});
    expect(bitrix.of('imconnector.send.messages')).toHaveLength(0);
  });

  it('is not handled for unknown or inactive lines', async () => {
    const { bridge, store } = makeCtx();
    expect((await bridge.handleProviderWebhook('nope', {})).handled).toBe(false);
    const line = seedLine(store, false);
    expect((await bridge.handleProviderWebhook(line.routeKey, {})).handled).toBe(false);
  });
});

describe('Bitrix -> WhatsApp', () => {
  it('sends the operator reply, converts BB-codes and acknowledges delivery', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    seedLine(store);

    const res = await bridge.handleBitrixMessages(MEMBER, 'connect24_whatsapp', '1', [outbound('Hola [b]Ana[/b]')]);
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(provider.sent).toEqual([{ to: '595981000111', text: 'Hola *Ana*' }]);
    expect(bitrix.of('imconnector.send.status.delivery')[0]?.params).toMatchObject({
      LINE: '1',
      MESSAGES: [{ im: { chat_id: '77', message_id: '900' }, message: { id: ['wamid.OUT1'] }, chat: { id: '595981000111' } }],
    });
  });

  it('appends attachment links to the text', async () => {
    const { bridge, store, provider } = makeCtx();
    seedLine(store);
    const m = outbound('mira');
    m.message.files = [{ name: 'cat.pdf', link: 'https://x/cat.pdf' }];
    await bridge.handleBitrixMessages(MEMBER, 'connect24_whatsapp', '1', [m]);
    expect(provider.sent[0]?.text).toBe('mira\n📎 cat.pdf: https://x/cat.pdf');
  });

  it('does not acknowledge delivery when WhatsApp refuses the message', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    seedLine(store);
    provider.fail = true;
    expect(await bridge.handleBitrixMessages(MEMBER, 'connect24_whatsapp', '1', [outbound()])).toEqual({ sent: 0, failed: 1 });
    expect(bitrix.of('imconnector.send.status.delivery')).toHaveLength(0);
  });

  it('ignores other connectors and inactive lines', async () => {
    const { bridge, store, provider } = makeCtx();
    seedLine(store, false);
    await bridge.handleBitrixMessages(MEMBER, 'other_connector', '1', [outbound()]);
    expect(await bridge.handleBitrixMessages(MEMBER, 'connect24_whatsapp', '1', [outbound()])).toEqual({ sent: 0, failed: 1 });
    expect(provider.sent).toHaveLength(0);
  });

  it('marks the message as read in Bitrix when WhatsApp reports a read receipt', async () => {
    const { bridge, store, bitrix, provider } = makeCtx();
    const line = seedLine(store);
    await bridge.handleBitrixMessages(MEMBER, 'connect24_whatsapp', '1', [outbound()]);

    provider.events = [{ kind: 'status', providerMessageId: 'wamid.OUT1', status: 'read', recipient: '595981000111' }];
    await bridge.handleProviderWebhook(line.routeKey, {});
    expect(bitrix.of('imconnector.send.status.reading')[0]?.params).toMatchObject({
      MESSAGES: [{ im: { chat_id: '77', message_id: '900' }, message: { id: ['wamid.OUT1'] } }],
    });
  });
});

describe('line lifecycle', () => {
  it('deletes credentials when the open line is removed in Bitrix', () => {
    const { bridge, store } = makeCtx();
    seedLine(store);
    bridge.handleLineDeleted(MEMBER, 'connect24_whatsapp', '1');
    expect(store.getLine(MEMBER, '1')).toBeUndefined();
  });

  it('keeps credentials but deactivates when the connector is disabled', () => {
    const { bridge, store } = makeCtx();
    seedLine(store);
    bridge.handleConnectorDisabled(MEMBER, 'connect24_whatsapp', '1');
    expect(store.getLine(MEMBER, '1')).toMatchObject({ active: false, token: 'tok' });
  });
});
