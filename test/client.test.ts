import { describe, expect, it, vi } from 'vitest';
import { BitrixClient, BitrixError } from '../src/bitrix/client.js';
import { makeCtx, MEMBER, seedInstallation } from './helpers.js';

const limit = () => new Response(JSON.stringify({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' }), { status: 503 });
const okRes = (result: unknown = true) => new Response(JSON.stringify({ result }), { status: 200 });

function setup(responses: Array<() => Response>) {
  const t = makeCtx();
  seedInstallation(t.store);
  const queue = [...responses];
  const fetchFn = vi.fn(async () => (queue.shift() ?? okRes)()) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const client = new BitrixClient(t.store, MEMBER, t.config.bitrix, fetchFn, async (ms) => void sleeps.push(ms));
  return { client, fetchFn, sleeps };
}

describe('BitrixClient token refresh', () => {
  it('fails with a clear error when client credentials are missing and the token is expired', async () => {
    const t = makeCtx({ BITRIX_CLIENT_ID: '', BITRIX_CLIENT_SECRET: '' });
    t.store.saveInstallation({ memberId: MEMBER, domain: 'vitriahome.bitrix24.es', clientEndpoint: 'https://vitriahome.bitrix24.es/rest/', accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    const client = new BitrixClient(t.store, MEMBER, t.config.bitrix, vi.fn() as unknown as typeof fetch);
    await expect(client.call('x')).rejects.toMatchObject({ code: 'NO_CLIENT_CREDENTIALS' });
  });
});

describe('BitrixClient rate limit', () => {
  it('retries QUERY_LIMIT_EXCEEDED with growing waits and then succeeds', async () => {
    const { client, fetchFn, sleeps } = setup([limit, limit, () => okRes('done')]);
    await expect(client.call('imconnector.send.messages')).resolves.toBe('done');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]!).toBeGreaterThanOrEqual(700);
    expect(sleeps[1]!).toBeGreaterThanOrEqual(1500);
  });

  it('gives up after the last wait and surfaces the Bitrix error', async () => {
    const { client, fetchFn } = setup([limit, limit, limit, limit]);
    await expect(client.call('x')).rejects.toMatchObject({ name: 'BitrixError', code: 'QUERY_LIMIT_EXCEEDED' });
    expect(fetchFn).toHaveBeenCalledTimes(4); // 1 try + 3 retries
  });

  it('does not retry other errors', async () => {
    const { client, fetchFn, sleeps } = setup([() => new Response(JSON.stringify({ error: 'ACCESS_DENIED', error_description: 'no' }), { status: 403 })]);
    await expect(client.call('x')).rejects.toBeInstanceOf(BitrixError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
  });
});
