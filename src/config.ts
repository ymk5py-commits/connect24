export interface Config {
  port: number;
  host: string;
  /** Public HTTPS base URL, no trailing slash. */
  publicUrl: string;
  appSecret: string;
  bitrix: {
    clientId: string;
    clientSecret: string;
    oauthServer: string;
    /** Empty = any portal may install (not recommended). */
    allowedDomains: string[];
  };
  connector: { id: string; name: string };
  dbPath: string;
  assetsDir: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const need = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) missing.push(key);
    return value ?? '';
  };

  const publicUrl = need('PUBLIC_URL').replace(/\/+$/, '');
  const appSecret = need('APP_SECRET');
  // Bitrix only shows client_id/client_secret AFTER the local app is created, and creating it needs this server
  // reachable. So they are optional at boot: installation works with the AUTH_ID Bitrix posts; they are needed
  // later to refresh tokens (see BitrixClient.refresh).
  const clientId = env.BITRIX_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.BITRIX_CLIENT_SECRET?.trim() ?? '';

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!/^https:\/\//.test(publicUrl) && !/^http:\/\/localhost(:\d+)?$/.test(publicUrl)) {
    throw new Error('PUBLIC_URL must be an https:// URL (Bitrix24 only calls HTTPS handlers)');
  }
  if (appSecret.length < 32) {
    throw new Error('APP_SECRET must be at least 32 characters (try: openssl rand -hex 32)');
  }

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    publicUrl,
    appSecret,
    bitrix: {
      clientId,
      clientSecret,
      oauthServer: (env.BITRIX_OAUTH_SERVER ?? 'https://oauth.bitrix.info').replace(/\/+$/, ''),
      allowedDomains: (env.BITRIX_ALLOWED_DOMAINS ?? '')
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    },
    connector: {
      id: env.CONNECTOR_ID ?? 'connect24_whatsapp',
      name: env.CONNECTOR_NAME ?? 'WhatsApp',
    },
    dbPath: env.DB_PATH ?? './data/connect24.db',
    assetsDir: env.ASSETS_DIR ?? './assets',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
