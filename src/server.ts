import { resolve } from 'node:path';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import qs from 'qs';
import type { AppContext } from './context.js';
import { registerBitrixRoutes } from './routes/bitrix.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

export async function buildServer(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ? { level: ctx.config.logLevel } : false, trustProxy: true });

  // Bitrix posts nested form fields like data[MESSAGES][0][im][chat_id]; qs rebuilds the object tree.
  await app.register(formbody, { parser: (body: string) => qs.parse(body, { arrayLimit: 100 }) });
  await app.register(fastifyStatic, { root: resolve(ctx.config.assetsDir), prefix: '/assets/', decorateReply: false });

  // Bitrix loads our pages inside an iframe on the portal's domain: only allow the configured portals to frame us.
  const { allowedDomains } = ctx.config.bitrix;
  if (allowedDomains.length > 0) {
    const policy = `frame-ancestors ${allowedDomains.map((d) => `https://${d}`).join(' ')}`;
    app.addHook('onSend', async (_req, reply) => {
      reply.header('Content-Security-Policy', policy);
    });
  }

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/', async (_req, reply) =>
    reply.type('text/plain').send('connect24 — WhatsApp conectado a Bitrix24'),
  );

  registerBitrixRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
  return app;
}
