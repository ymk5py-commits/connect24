import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Botika -> connect24. The unguessable routeKey (24 random bytes) identifies and authenticates the line.
  app.post<{ Params: { routeKey: string } }>('/webhooks/botika/:routeKey', async (req, reply) => {
    const result = await ctx.bridge.handleProviderWebhook(req.params.routeKey, req.body);
    if (!result.handled) return reply.code(404).send({ error: 'unknown or inactive line' });
    // A non-2xx makes the provider redeliver; already-forwarded messages are de-duplicated.
    if (result.failed > 0) return reply.code(500).send({ error: 'some events failed', failed: result.failed });
    return { ok: true };
  });
}
