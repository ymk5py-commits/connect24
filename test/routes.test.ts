import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { DOMAIN, makeCtx, MEMBER, seedInstallation, seedLine } from './helpers.js';

/** Fake Bitrix REST for `profile` calls made with explicit tokens (install / settings). */
function profileFetch(admin: boolean, valid = true) {
  return vi.fn(async () =>
    valid
      ? new Response(JSON.stringify({ result: { ID: '1', ADMIN: admin } }), { status: 200 })
      : new Response(JSON.stringify({ error: 'invalid_token', error_description: 'bad' }), { status: 401 }),
  ) as unknown as typeof fetch;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('POST /bitrix/install', () => {
  const body = form({ AUTH_ID: 'tok', REFRESH_ID: 'ref', AUTH_EXPIRES: '3600', member_id: MEMBER });

  it('stores the installation, registers the connector and binds the 3 events', async () => {
    const t = makeCtx({}, profileFetch(true));
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: `/bitrix/install?DOMAIN=${DOMAIN}`, headers: FORM, payload: body });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('installFinish');
    expect(t.store.getInstallation(MEMBER)).toMatchObject({ domain: DOMAIN, accessToken: 'tok', refreshToken: 'ref' });

    expect(t.bitrix.of('imconnector.register')[0]?.params).toMatchObject({
      ID: 'connect24_whatsapp',
      PLACEMENT_HANDLER: 'https://connect24.example.com/bitrix/settings',
    });
    const bound = t.bitrix.of('event.bind').map((c) => c.params.event);
    expect(bound).toEqual(['ONIMCONNECTORMESSAGEADD', 'ONIMCONNECTORLINEDELETE', 'ONIMCONNECTORSTATUSDELETE']);
    expect(String(t.bitrix.of('event.bind')[0]?.params.handler)).toMatch(/^https:\/\/connect24\.example\.com\/bitrix\/events\?m=member123&sig=[0-9a-f]{64}$/);
  });

  it('is idempotent: does not re-register or re-bind', async () => {
    const t = makeCtx({}, profileFetch(true));
    t.bitrix.responses['imconnector.list'] = ['connect24_whatsapp'];
    const app = await buildServer(t.ctx);
    // pretend the events are already bound with the exact handler URL
    const handler = `https://connect24.example.com/bitrix/events?m=${MEMBER}&sig=${t.secrets.sign(MEMBER)}`;
    t.bitrix.responses['event.get'] = ['ONIMCONNECTORMESSAGEADD', 'ONIMCONNECTORLINEDELETE', 'ONIMCONNECTORSTATUSDELETE'].map((event) => ({ event, handler }));

    await app.inject({ method: 'POST', url: `/bitrix/install?DOMAIN=${DOMAIN}`, headers: FORM, payload: body });
    expect(t.bitrix.of('imconnector.register')).toHaveLength(0);
    expect(t.bitrix.of('event.bind')).toHaveLength(0);
  });

  it('rejects a portal that is not on the allow-list (and never calls it)', async () => {
    const fetchFn = profileFetch(true);
    const t = makeCtx({}, fetchFn);
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: '/bitrix/install?DOMAIN=evil.example.com', headers: FORM, payload: body });
    expect(res.statusCode).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(t.store.getInstallation(MEMBER)).toBeUndefined();
  });

  it('rejects non-admin users and invalid tokens, storing nothing', async () => {
    for (const fetchFn of [profileFetch(false), profileFetch(true, false)]) {
      const t = makeCtx({}, fetchFn);
      const app = await buildServer(t.ctx);
      const res = await app.inject({ method: 'POST', url: `/bitrix/install?DOMAIN=${DOMAIN}`, headers: FORM, payload: body });
      expect([401, 403]).toContain(res.statusCode);
      expect(t.store.getInstallation(MEMBER)).toBeUndefined();
    }
  });

  it('refuses to overwrite an installation with a different domain (member_id spoofing)', async () => {
    const t = makeCtx({ BITRIX_ALLOWED_DOMAINS: `${DOMAIN},other.bitrix24.com` }, profileFetch(true));
    seedInstallation(t.store);
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: '/bitrix/install?DOMAIN=other.bitrix24.com', headers: FORM, payload: body });
    expect(res.statusCode).toBe(409);
    expect(t.store.getInstallation(MEMBER)?.domain).toBe(DOMAIN);
  });

  it('400 when Bitrix credentials are missing', async () => {
    const app = await buildServer(makeCtx().ctx);
    expect((await app.inject({ method: 'POST', url: '/bitrix/install', headers: FORM, payload: '' })).statusCode).toBe(400);
  });
});

describe('POST /bitrix/events', () => {
  const eventBody = form({
    event: 'ONIMCONNECTORMESSAGEADD',
    'data[CONNECTOR]': 'connect24_whatsapp',
    'data[LINE]': '1',
    'data[MESSAGES][0][im][chat_id]': '77',
    'data[MESSAGES][0][im][message_id]': '900',
    'data[MESSAGES][0][message][id][0]': 'b-1',
    'data[MESSAGES][0][message][text]': 'Hola [b]Ana[/b]',
    'data[MESSAGES][0][chat][id]': '595981000111',
  });

  it('rejects a bad or missing signature', async () => {
    const t = makeCtx();
    const app = await buildServer(t.ctx);
    for (const url of ['/bitrix/events', `/bitrix/events?m=${MEMBER}`, `/bitrix/events?m=${MEMBER}&sig=${'0'.repeat(64)}`, `/bitrix/events?m=other&sig=${t.secrets.sign(MEMBER)}`]) {
      expect((await app.inject({ method: 'POST', url, headers: FORM, payload: eventBody })).statusCode).toBe(403);
    }
    expect(t.provider.sent).toHaveLength(0);
  });

  it('delivers an operator reply (nested form fields) to WhatsApp', async () => {
    const t = makeCtx();
    seedLine(t.store);
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: `/bitrix/events?m=${MEMBER}&sig=${t.secrets.sign(MEMBER)}`, headers: FORM, payload: eventBody });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(t.provider.sent).toEqual([{ to: '595981000111', text: 'Hola *Ana*' }]));
  });

  it('removes the line config on line-delete events', async () => {
    const t = makeCtx();
    seedLine(t.store);
    const app = await buildServer(t.ctx);
    const payload = form({ event: 'ONIMCONNECTORLINEDELETE', 'data[CONNECTOR]': 'connect24_whatsapp', 'data[LINE]': '1' });
    await app.inject({ method: 'POST', url: `/bitrix/events?m=${MEMBER}&sig=${t.secrets.sign(MEMBER)}`, headers: FORM, payload });
    await vi.waitFor(() => expect(t.store.getLine(MEMBER, '1')).toBeUndefined());
  });
});

describe('POST /webhooks/botika/:routeKey', () => {
  it('404 for unknown key, 200 for a known active line, 500 when forwarding fails', async () => {
    const t = makeCtx();
    const line = seedLine(t.store);
    const app = await buildServer(t.ctx);
    const post = (key: string) => app.inject({ method: 'POST', url: `/webhooks/botika/${key}`, payload: { any: 'thing' } });

    expect((await post('nope')).statusCode).toBe(404);
    expect((await post(line.routeKey)).statusCode).toBe(200);

    t.provider.events = [{ kind: 'message', providerMessageId: 'w1', from: '1', timestamp: 1, text: 'x', origin: 'customer' }];
    t.bitrix.failOn.add('imconnector.send.messages');
    expect((await post(line.routeKey)).statusCode).toBe(500);
  });
});

describe('connector settings', () => {
  const settingsBody = (line = '1') => form({ AUTH_ID: 'AUTHX', member_id: MEMBER, PLACEMENT_OPTIONS: JSON.stringify({ LINE: line, ACTIVE_STATUS: '0' }) });

  it('renders the form for an admin and shows the webhook URL once the line exists', async () => {
    const t = makeCtx({}, profileFetch(true));
    seedInstallation(t.store);
    const app = await buildServer(t.ctx);

    let res = await app.inject({ method: 'POST', url: `/bitrix/settings?DOMAIN=${DOMAIN}`, headers: FORM, payload: settingsBody() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Conectar WhatsApp');
    expect(res.body).toContain('Se genera al guardar');

    const line = seedLine(t.store);
    res = await app.inject({ method: 'POST', url: `/bitrix/settings?DOMAIN=${DOMAIN}`, headers: FORM, payload: settingsBody() });
    expect(res.body).toContain(`/webhooks/botika/${line.routeKey}`);
    expect(res.body).not.toContain('value="tok"'); // the provider token (seeded as "tok") is never echoed back
  });

  it('refuses when the app is not installed for that portal', async () => {
    const t = makeCtx({}, profileFetch(true));
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: `/bitrix/settings?DOMAIN=${DOMAIN}`, headers: FORM, payload: settingsBody() });
    expect(res.statusCode).toBe(403);
  });

  it('saves credentials, activates the connector and keeps the token when left blank', async () => {
    const t = makeCtx({}, profileFetch(true));
    seedInstallation(t.store);
    const app = await buildServer(t.ctx);
    const save = (extra: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/bitrix/settings/save',
        headers: FORM,
        payload: form({ member_id: MEMBER, auth_id: 'tok', line: '1', base_url: 'https://api.botika.example/', phone_number_id: '555', token: '', ...extra }),
      });

    expect((await save({})).statusCode).toBe(400); // no token yet

    const res = await save({ token: 'SECRET' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Guardado y conector activado');
    expect(res.body).not.toContain('SECRET');
    expect(t.store.getLine(MEMBER, '1')).toMatchObject({ baseUrl: 'https://api.botika.example', token: 'SECRET', phoneNumberId: '555', active: true });
    expect(t.bitrix.of('imconnector.activate')[0]?.params).toMatchObject({ CONNECTOR: 'connect24_whatsapp', LINE: '1', ACTIVE: 1 });
    expect(t.bitrix.of('imconnector.connector.data.set')).toHaveLength(1);

    const routeKey = t.store.getLine(MEMBER, '1')!.routeKey;
    await save({ phone_number_id: '999' }); // blank token keeps the old one, webhook URL stays stable
    expect(t.store.getLine(MEMBER, '1')).toMatchObject({ token: 'SECRET', phoneNumberId: '999', routeKey });
  });

  it('rejects non-https API URLs', async () => {
    const t = makeCtx({}, profileFetch(true));
    seedInstallation(t.store);
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: '/bitrix/settings/save', headers: FORM, payload: form({ member_id: MEMBER, auth_id: 'tok', line: '1', base_url: 'http://insecure.example', phone_number_id: '1', token: 't' }) });
    expect(res.statusCode).toBe(400);
    expect(t.store.getLine(MEMBER, '1')).toBeUndefined();
  });

  it('refuses to save when the token is not an admin token', async () => {
    const t = makeCtx({}, profileFetch(false));
    seedInstallation(t.store);
    const app = await buildServer(t.ctx);
    const res = await app.inject({ method: 'POST', url: '/bitrix/settings/save', headers: FORM, payload: form({ member_id: MEMBER, auth_id: 'tok', line: '1', base_url: 'https://a.example', phone_number_id: '1', token: 't' }) });
    expect(res.statusCode).toBe(403);
    expect(t.store.getLine(MEMBER, '1')).toBeUndefined();
  });
});
