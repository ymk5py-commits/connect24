import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthError, establishAdminSession, readAuth } from '../bitrix/auth.js';
import {
  ensureConnectorRegistered,
  ensureEventsBound,
  listOpenLines,
  setConnectorData,
  setLineActive,
  type OutboundMessageEvent,
} from '../bitrix/connector.js';
import type { AppContext } from '../context.js';
import { appPage, errorPage, installDonePage, settingsPage } from '../views/pages.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const html = (reply: FastifyReply, status: number, body: string) => reply.code(status).type('text/html; charset=utf-8').send(body);

export function registerBitrixRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, store, secrets, bridge, log } = ctx;
  const eventsUrl = (memberId: string) =>
    `${config.publicUrl}/bitrix/events?m=${encodeURIComponent(memberId)}&sig=${secrets.sign(memberId)}`;

  /** Registers the connector and binds events. Idempotent, so opening the app also repairs a broken install. */
  async function ensureSetup(memberId: string) {
    const client = ctx.bitrix(memberId);
    const registration = await ensureConnectorRegistered(client, {
      id: config.connector.id,
      name: config.connector.name,
      iconDataUri: ctx.connectorIcon,
      placementHandler: `${config.publicUrl}/bitrix/settings`,
    });
    const eventsAdded = await ensureEventsBound(client, eventsUrl(memberId));
    return { client, registration, eventsAdded };
  }

  async function handleAuthError(reply: FastifyReply, err: unknown) {
    if (err instanceof AuthError) return html(reply, err.status, errorPage(err.message));
    log.error({ err }, 'bitrix handler failed');
    return html(reply, 500, errorPage('Error inesperado. Revisa los logs de connect24.'));
  }

  // Installation handler: Bitrix opens it once, as an administrator, when the local app is saved.
  app.post('/bitrix/install', async (req, reply) => {
    const auth = readAuth(req.body, req.query);
    if (!auth) return html(reply, 400, errorPage('Faltan credenciales de Bitrix24 (AUTH_ID, member_id, DOMAIN).'));
    try {
      await establishAdminSession(store, config.bitrix, ctx.fetchFn, auth, { allowFirstInstall: true });
      await ensureSetup(auth.memberId);
      return html(reply, 200, installDonePage());
    } catch (err) {
      return handleAuthError(reply, err);
    }
  });

  // Application handler: the screen shown when someone opens connect24 inside Bitrix24.
  app.route({
    method: ['GET', 'POST'],
    url: '/bitrix/app',
    handler: async (req, reply) => {
      const auth = readAuth(req.body, req.query);
      if (!auth) return html(reply, 200, errorPage('Abre connect24 desde dentro de Bitrix24 (menú Aplicaciones).'));
      try {
        const inst = await establishAdminSession(store, config.bitrix, ctx.fetchFn, auth, { allowFirstInstall: true });
        const { client, registration, eventsAdded } = await ensureSetup(auth.memberId);

        let linesError: string | undefined;
        const lines = await listOpenLines(client).catch((err: unknown) => {
          linesError = 'No se pudieron leer los canales abiertos (revisa los permisos imopenlines de la app).';
          log.warn({ err }, 'listOpenLines failed');
          return [];
        });

        return html(
          reply,
          200,
          appPage({
            domain: inst.domain,
            connectorName: config.connector.name,
            registration,
            eventsAdded,
            linesError,
            lines: lines.map((l) => {
              const cfg = store.getLine(auth.memberId, l.id);
              return { ...l, configured: Boolean(cfg), active: Boolean(cfg?.active) };
            }),
          }),
        );
      } catch (err) {
        return handleAuthError(reply, err);
      }
    },
  });

  // Connector settings page (PLACEMENT_HANDLER): opened by Bitrix when an operator picks the connector for a line.
  app.post('/bitrix/settings', async (req, reply) => {
    const auth = readAuth(req.body, req.query);
    if (!auth) return html(reply, 400, errorPage('Faltan credenciales de Bitrix24.'));

    let options: Json = {};
    try {
      options = obj(JSON.parse(str(obj(req.body).PLACEMENT_OPTIONS) || '{}'));
    } catch {
      /* fall through: no line id */
    }
    const lineId = str(options.LINE) || str(options.line) || str(options.LINE_ID);
    if (!lineId) return html(reply, 400, errorPage('Bitrix24 no indicó el canal abierto. Vuelve a abrir el conector desde Contact Center.'));

    try {
      await establishAdminSession(store, config.bitrix, ctx.fetchFn, auth, { allowFirstInstall: false });
      const line = store.getLine(auth.memberId, lineId);
      return html(
        reply,
        200,
        settingsPage({
          memberId: auth.memberId,
          authId: auth.accessToken,
          lineId,
          line,
          webhookUrl: line ? `${config.publicUrl}/webhooks/botika/${line.routeKey}` : undefined,
        }),
      );
    } catch (err) {
      return handleAuthError(reply, err);
    }
  });

  app.post('/bitrix/settings/save', async (req, reply) => {
    const body = obj(req.body);
    const memberId = str(body.member_id);
    const lineId = str(body.line);
    const authId = str(body.auth_id);
    const inst = store.getInstallation(memberId);
    if (!inst || !lineId || !authId) return html(reply, 400, errorPage('Solicitud incompleta.'));

    const existing = store.getLine(memberId, lineId);
    const form = {
      baseUrl: str(body.base_url).trim(),
      phoneNumberId: str(body.phone_number_id).trim(),
      token: str(body.token).trim() || existing?.token || '',
    };
    const render = (status: number, extra: { error?: string; saved?: boolean }) => {
      const line = store.getLine(memberId, lineId);
      return html(
        reply,
        status,
        settingsPage({
          memberId,
          authId,
          lineId,
          line,
          webhookUrl: line ? `${config.publicUrl}/webhooks/botika/${line.routeKey}` : undefined,
          ...extra,
        }),
      );
    };

    try {
      await establishAdminSession(
        store,
        config.bitrix,
        ctx.fetchFn,
        { accessToken: authId, refreshToken: '', expiresIn: 3600, memberId, domain: inst.domain },
        { allowFirstInstall: false },
      );
    } catch (err) {
      return handleAuthError(reply, err);
    }

    let parsed: URL | undefined;
    try {
      parsed = new URL(form.baseUrl);
    } catch {
      /* handled below */
    }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return render(400, { error: 'La URL de la API debe ser https:// y no incluir usuario ni contraseña.' });
    }
    if (!form.phoneNumberId || !form.token) return render(400, { error: 'Completa el ID del número y el token.' });

    const line = store.upsertLine({
      memberId,
      lineId,
      baseUrl: form.baseUrl.replace(/\/+$/, ''),
      token: form.token,
      phoneNumberId: form.phoneNumberId,
      active: true,
    });

    try {
      const client = ctx.bitrix(memberId);
      await setLineActive(client, config.connector.id, lineId, true);
      await setConnectorData(client, config.connector.id, lineId, { id: `wa_${form.phoneNumberId}`, name: `WhatsApp ${form.phoneNumberId}` });
    } catch (err) {
      log.error({ err, lineId }, 'could not activate connector in Bitrix');
      store.upsertLine({ ...line, active: false });
      return render(502, { error: 'Guardado, pero Bitrix24 rechazó la activación del conector. Revisa los logs.' });
    }
    return render(200, { saved: true });
  });

  // Bitrix events (operator replies, line deleted, ...). Authenticated by the HMAC we put in the handler URL.
  app.post('/bitrix/events', async (req, reply) => {
    const q = obj(req.query);
    const memberId = str(q.m);
    if (!memberId || !secrets.verify(memberId, str(q.sig))) return reply.code(403).send({ error: 'forbidden' });

    const body = obj(req.body);
    const data = obj(body.data);
    const event = str(body.event).toUpperCase();
    const connector = str(data.CONNECTOR) || str(data.connector);
    const lineId = str(data.LINE) || str(data.line);

    const work = (async () => {
      if (event === 'ONIMCONNECTORMESSAGEADD') {
        const raw = data.MESSAGES;
        const messages = (Array.isArray(raw) ? raw : Object.values(obj(raw))) as OutboundMessageEvent[];
        await bridge.handleBitrixMessages(memberId, connector, lineId, messages);
      } else if (event === 'ONIMCONNECTORLINEDELETE') {
        bridge.handleLineDeleted(memberId, connector, lineId);
      } else if (event === 'ONIMCONNECTORSTATUSDELETE') {
        bridge.handleConnectorDisabled(memberId, connector, lineId);
      }
    })();
    // Answer Bitrix immediately; delivery problems are logged, they cannot be retried through Bitrix anyway.
    work.catch((err: unknown) => log.error({ err, event }, 'bitrix event failed'));
    return { ok: true };
  });
}
