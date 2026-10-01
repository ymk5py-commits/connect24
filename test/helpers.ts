import type { BitrixCaller } from '../src/bitrix/client.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { Secrets } from '../src/crypto.js';
import type { ProviderEvent, WhatsAppProvider } from '../src/providers/types.js';
import { Bridge } from '../src/services/bridge.js';
import { Store } from '../src/store.js';

export const MEMBER = 'member123';
export const DOMAIN = 'vitriahome.bitrix24.es';

export const silentLog = { info() {}, warn() {}, error() {} };

export class FakeBitrix implements BitrixCaller {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  responses: Record<string, unknown> = {
    'imconnector.list': [],
    'event.get': [],
    'imopenlines.config.list.get': [{ ID: '1', LINE_NAME: 'Soporte' }],
  };
  failOn = new Set<string>();

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (this.failOn.has(method)) throw new Error(`boom ${method}`);
    return (this.responses[method] ?? true) as T;
  }
  of(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

export class FakeProvider implements WhatsAppProvider {
  sent: Array<{ to: string; text: string }> = [];
  events: ProviderEvent[] = [];
  fail = false;
  parseWebhook(): ProviderEvent[] {
    return this.events;
  }
  async sendText(to: string, text: string) {
    if (this.fail) throw new Error('provider down');
    this.sent.push({ to, text });
    return { messageId: `wamid.OUT${this.sent.length}` };
  }
}

export function makeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PUBLIC_URL: 'https://connect24.example.com',
    APP_SECRET: 'x'.repeat(40),
    BITRIX_CLIENT_ID: 'local.abc',
    BITRIX_CLIENT_SECRET: 'secret',
    BITRIX_ALLOWED_DOMAINS: DOMAIN,
    ...extra,
  };
}

export function makeCtx(extraEnv: Record<string, string> = {}, fetchFn: typeof fetch = fetch) {
  const config = loadConfig(makeEnv(extraEnv));
  const secrets = new Secrets(config.appSecret);
  const store = new Store(':memory:', secrets);
  const bitrix = new FakeBitrix();
  const provider = new FakeProvider();
  const bridge = new Bridge({ store, connectorId: config.connector.id, bitrix: () => bitrix, provider: () => provider, log: silentLog });
  const ctx: AppContext = { config, store, secrets, bridge, log: silentLog, fetchFn, bitrix: () => bitrix, connectorIcon: 'data:image/svg+xml;base64,AAA=' };
  return { ctx, config, secrets, store, bitrix, provider, bridge };
}

export function seedInstallation(store: Store, memberId = MEMBER, domain = DOMAIN) {
  store.saveInstallation({
    memberId,
    domain,
    clientEndpoint: `https://${domain}/rest/`,
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
}

export function seedLine(store: Store, active = true, memberId = MEMBER, lineId = '1') {
  return store.upsertLine({ memberId, lineId, baseUrl: 'https://api.botika.example', token: 'tok', phoneNumberId: '123', active });
}
