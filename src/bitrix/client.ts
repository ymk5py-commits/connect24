import type { Config } from '../config.js';
import type { Installation, Store } from '../store.js';

export class BitrixError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${code}: ${message}`);
    this.name = 'BitrixError';
  }
}

type FetchFn = typeof fetch;

/** Waits (ms) before each retry when Bitrix answers QUERY_LIMIT_EXCEEDED. Bitrix did not process the call, so retrying is safe. */
export const RATE_LIMIT_WAITS_MS = [700, 1500, 3000];

export function isRateLimit(err: unknown): boolean {
  return err instanceof BitrixError && /QUERY_LIMIT_EXCEEDED|too many requests/i.test(`${err.code} ${err.message}`);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The only thing the rest of the app needs from a Bitrix client (easy to fake in tests). */
export interface BitrixCaller {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  client_endpoint?: string;
  domain?: string;
  member_id?: string;
  error?: string;
  error_description?: string;
}

/** Bitrix24 REST client for one installed portal. Refreshes the OAuth token transparently. */
export class BitrixClient implements BitrixCaller {
  private static readonly refreshing = new Map<string, Promise<Installation>>();

  constructor(
    private readonly store: Store,
    private readonly memberId: string,
    private readonly cfg: Config['bitrix'],
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce<T>(method, params);
      } catch (err) {
        const wait = RATE_LIMIT_WAITS_MS[attempt];
        if (!isRateLimit(err) || wait === undefined) throw err;
        await this.sleep(Math.round(wait * (1 + Math.random() * 0.25))); // jitter so colliding callers do not retry together
      }
    }
  }

  private async callOnce<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let inst = this.store.getInstallation(this.memberId);
    if (!inst) throw new BitrixError('NOT_INSTALLED', `No installation for member ${this.memberId}`);

    if (inst.expiresAt - 60 <= Math.floor(Date.now() / 1000)) inst = await this.refresh(inst);

    try {
      return await this.rawCall<T>(inst, method, params);
    } catch (err) {
      if (err instanceof BitrixError && err.code === 'expired_token') {
        inst = await this.refresh(inst);
        return this.rawCall<T>(inst, method, params);
      }
      throw err;
    }
  }

  private async rawCall<T>(inst: Installation, method: string, params: Record<string, unknown>): Promise<T> {
    return restCall<T>(this.fetchFn, inst.clientEndpoint, inst.accessToken, method, params);
  }

  private refresh(inst: Installation): Promise<Installation> {
    // Refresh tokens are single-use: share one in-flight refresh per portal.
    const pending = BitrixClient.refreshing.get(inst.memberId);
    if (pending) return pending;

    const run = (async () => {
      if (!this.cfg.clientId || !this.cfg.clientSecret) {
        throw new BitrixError('NO_CLIENT_CREDENTIALS', 'Set BITRIX_CLIENT_ID and BITRIX_CLIENT_SECRET to refresh the Bitrix token');
      }
      const url = new URL(`${this.cfg.oauthServer}/oauth/token/`);
      url.searchParams.set('grant_type', 'refresh_token');
      url.searchParams.set('client_id', this.cfg.clientId);
      url.searchParams.set('client_secret', this.cfg.clientSecret);
      url.searchParams.set('refresh_token', inst.refreshToken);

      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => ({}))) as OAuthTokenResponse;
      if (!res.ok || !body.access_token) {
        throw new BitrixError(body.error ?? 'REFRESH_FAILED', body.error_description ?? `HTTP ${res.status}`, res.status);
      }

      const updated: Installation = {
        ...inst,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in),
        clientEndpoint: body.client_endpoint ?? inst.clientEndpoint,
      };
      this.store.saveInstallation(updated);
      return updated;
    })().finally(() => BitrixClient.refreshing.delete(inst.memberId));

    BitrixClient.refreshing.set(inst.memberId, run);
    return run;
  }
}

/** Single REST call with an explicit token (also used during install, before anything is stored). */
export async function restCall<T>(
  fetchFn: FetchFn,
  clientEndpoint: string,
  accessToken: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetchFn(`${clientEndpoint}${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, auth: accessToken }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string; error_description?: string };
  if (body.error) throw new BitrixError(body.error, body.error_description ?? method, res.status);
  if (!res.ok) throw new BitrixError('HTTP_ERROR', `${method} -> HTTP ${res.status}`, res.status);
  return body.result as T;
}
