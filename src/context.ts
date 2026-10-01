import type { BitrixCaller } from './bitrix/client.js';
import type { Config } from './config.js';
import type { Secrets } from './crypto.js';
import type { Bridge, Logger } from './services/bridge.js';
import type { Store } from './store.js';

export interface AppContext {
  config: Config;
  store: Store;
  secrets: Secrets;
  bridge: Bridge;
  log: Logger;
  fetchFn: typeof fetch;
  bitrix: (memberId: string) => BitrixCaller;
  connectorIcon: string;
}
