import type { BitrixCaller } from './client.js';

export interface OpenLine {
  id: string;
  name: string;
}

export interface ConnectorUser {
  /** Stable external id: the customer's WhatsApp number. */
  id: string;
  name: string;
}

export interface ConnectorMessage {
  user: ConnectorUser;
  message: { id: string; date: number; text: string };
  chat: { id: string; name?: string };
}

/** Subset of the OnImConnectorMessageAdd payload we use (form-encoded by Bitrix, parsed with qs). */
export interface OutboundMessageEvent {
  im: { chat_id: string; message_id: string };
  message: { id?: string | string[]; text?: string; files?: Array<{ name?: string; link?: string; url?: string }> };
  chat: { id: string };
}

export const EVENTS = ['ONIMCONNECTORMESSAGEADD', 'ONIMCONNECTORLINEDELETE', 'ONIMCONNECTORSTATUSDELETE'] as const;

export async function ensureConnectorRegistered(
  client: BitrixCaller,
  opts: { id: string; name: string; iconDataUri: string; placementHandler: string },
): Promise<'registered' | 'already-registered'> {
  const existing = await client.call<Record<string, unknown> | unknown[]>('imconnector.list');
  const ids = Array.isArray(existing) ? existing.map(String) : Object.keys(existing ?? {});
  if (ids.includes(opts.id)) return 'already-registered';

  await client.call('imconnector.register', {
    ID: opts.id,
    NAME: opts.name,
    ICON: { DATA_IMAGE: opts.iconDataUri, COLOR: '#25D366', SIZE: '90%', POSITION: 'center' },
    PLACEMENT_HANDLER: opts.placementHandler,
  });
  return 'registered';
}

/** Binds our events URL for every connector event that is not bound yet. */
export async function ensureEventsBound(client: BitrixCaller, handlerUrl: string): Promise<string[]> {
  const bound = await client.call<Array<{ event?: string; handler?: string }>>('event.get');
  const already = new Set(
    (Array.isArray(bound) ? bound : [])
      .filter((b) => b.handler === handlerUrl)
      .map((b) => String(b.event).toUpperCase()),
  );

  const added: string[] = [];
  for (const event of EVENTS) {
    if (already.has(event)) continue;
    await client.call('event.bind', { event, handler: handlerUrl });
    added.push(event);
  }
  return added;
}

export async function listOpenLines(client: BitrixCaller): Promise<OpenLine[]> {
  const rows = await client.call<Array<{ ID: string | number; LINE_NAME?: string }>>('imopenlines.config.list.get', {
    PARAMS: { select: ['ID', 'LINE_NAME'], order: { ID: 'ASC' } },
  });
  return (Array.isArray(rows) ? rows : []).map((r) => ({ id: String(r.ID), name: r.LINE_NAME ?? `Línea ${r.ID}` }));
}

export function setLineActive(client: BitrixCaller, connector: string, line: string, active: boolean) {
  return client.call('imconnector.activate', { CONNECTOR: connector, LINE: line, ACTIVE: active ? 1 : 0 });
}

export function setConnectorData(
  client: BitrixCaller,
  connector: string,
  line: string,
  data: { id: string; name: string; url?: string },
) {
  return client.call('imconnector.connector.data.set', {
    CONNECTOR: connector,
    LINE: line,
    DATA: { id: data.id, url: data.url ?? '', url_im: data.url ?? '', name: data.name },
  });
}

/** WhatsApp customer -> Bitrix Open Line. */
export function sendToBitrix(client: BitrixCaller, connector: string, line: string, messages: ConnectorMessage[]) {
  return client.call('imconnector.send.messages', { CONNECTOR: connector, LINE: line, MESSAGES: messages });
}

interface StatusItem {
  im: { chat_id: string; message_id: string };
  message: { id: string[] };
  chat: { id: string };
}

export function ackDelivered(client: BitrixCaller, connector: string, line: string, items: StatusItem[]) {
  return client.call('imconnector.send.status.delivery', { CONNECTOR: connector, LINE: line, MESSAGES: items });
}

export function ackRead(client: BitrixCaller, connector: string, line: string, items: StatusItem[]) {
  return client.call('imconnector.send.status.reading', { CONNECTOR: connector, LINE: line, MESSAGES: items });
}

/** Bitrix sends operator text with BB-codes; WhatsApp only understands its own light markup. */
export function bbToWhatsApp(input: string): string {
  return input
    .replace(/\[br\s*\/?\]/gi, '\n')
    .replace(/\[\/?(?:b|strong)\]/gi, '*')
    .replace(/\[\/?(?:i|em)\]/gi, '_')
    .replace(/\[\/?(?:s|strike)\]/gi, '~')
    .replace(/\[url=([^\]]+)\]([^[]*)\[\/url\]/gi, (_m, href: string, label: string) => (label && label !== href ? `${label} (${href})` : href))
    .replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
