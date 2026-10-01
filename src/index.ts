import { connectorIconDataUri } from './assets.js';
import { BitrixClient } from './bitrix/client.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { Secrets } from './crypto.js';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud.js';
import { buildServer } from './server.js';
import { Bridge } from './services/bridge.js';
import { Store } from './store.js';

const config = loadConfig();
const secrets = new Secrets(config.appSecret);
const store = new Store(config.dbPath, secrets);

// Filled in right after the server (and its logger) exists.
const ctx = { config, store, secrets, fetchFn: fetch, connectorIcon: connectorIconDataUri(config.assetsDir) } as AppContext;
ctx.bitrix = (memberId) => new BitrixClient(store, memberId, config.bitrix);

const app = await buildServer(ctx, { logger: true });
ctx.log = app.log;
if (!config.bitrix.clientId || !config.bitrix.clientSecret) {
  app.log.warn('BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET are not set: installation works, but Bitrix tokens cannot be refreshed (they expire after ~1 hour)');
}
ctx.bridge = new Bridge({
  store,
  connectorId: config.connector.id,
  bitrix: ctx.bitrix,
  provider: (line) => new WhatsAppCloudProvider({ baseUrl: line.baseUrl, token: line.token, phoneNumberId: line.phoneNumberId }),
  log: app.log,
});

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
