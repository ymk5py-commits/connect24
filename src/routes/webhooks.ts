import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Meta's webhook verification handshake (only needed when Meta calls connect24 directly).
  // The line's routeKey doubles as the verify token you type in Meta's webhook settings.
  app.get<{ Params: { routeKey: string }; Querystring: Record<string, string> }>('/webhooks/whatsapp/:routeKey', async (req, reply) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    const line = ctx.store.getLineByRoute(req.params.routeKey);
    if (!line || mode !== 'subscribe' || token !== line.routeKey || !challenge) return reply.code(403).send('forbidden');
    return reply.type('text/plain').send(challenge);
  });

  // WhatsApp events -> connect24, straight from Meta or forwarded by Botika. The unguessable routeKey
  // (24 random bytes) identifies and authenticates the line.
  app.post<{ Params: { routeKey: string } }>('/webhooks/whatsapp/:routeKey', async (req, reply) => {
    const result = await ctx.bridge.handleProviderWebhook(req.params.routeKey, req.body);
    if (!result.handled) return reply.code(404).send({ error: 'unknown or inactive line' });
    // A non-2xx makes the sender redeliver; already-forwarded messages are de-duplicated.
    if (result.failed > 0) return reply.code(500).send({ error: 'some events failed', failed: result.failed });
    return { ok: true };
  });
}
