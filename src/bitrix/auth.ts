import type { Config } from '../config.js';
import type { Installation, Store } from '../store.js';
import { BitrixError, restCall } from './client.js';

type FetchFn = typeof fetch;
type Json = Record<string, unknown>;

export interface SessionAuth {
  accessToken: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
  memberId: string;
  domain: string;
}

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});

/** Reads the credentials Bitrix24 posts when it opens the install/app handler (AUTH_ID style or event "auth[...]" style). */
export function readAuth(body: unknown, query: unknown): SessionAuth | undefined {
  const b = obj(body);
  const q = obj(query);
  const nested = obj(b.auth);

  const accessToken = str(b.AUTH_ID) || str(nested.access_token);
  const memberId = str(b.member_id) || str(nested.member_id);
  const domain = (str(q.DOMAIN) || str(nested.domain) || str(b.DOMAIN)).toLowerCase();
  if (!accessToken || !memberId || !domain) return undefined;

  return {
    accessToken,
    refreshToken: str(b.REFRESH_ID) || str(nested.refresh_token),
    expiresIn: Number(b.AUTH_EXPIRES ?? nested.expires_in) || 3600,
    memberId,
    domain,
  };
}

/** Accepts only real-looking hostnames (no IPs, ports, paths) and, when configured, only allow-listed portals. */
export function validateDomain(domain: string, allowed: string[]): boolean {
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return false;
  return allowed.length === 0 || allowed.includes(domain);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Proves the caller holds a valid, administrator token for the portal, and (for admins) stores it.
 * Anything an attacker could forge (member_id, DOMAIN) is checked against the stored installation.
 */
export async function establishAdminSession(
  store: Store,
  cfg: Config['bitrix'],
  fetchFn: FetchFn,
  auth: SessionAuth,
  options: { allowFirstInstall: boolean },
): Promise<Installation> {
  if (!validateDomain(auth.domain, cfg.allowedDomains)) throw new AuthError('Portal no autorizado', 403);

  const existing = store.getInstallation(auth.memberId);
  if (existing && existing.domain !== auth.domain) throw new AuthError('El portal no coincide con la instalación registrada', 409);
  if (!existing && !options.allowFirstInstall) throw new AuthError('La aplicación no está instalada en este portal', 403);

  const clientEndpoint = `https://${auth.domain}/rest/`;
  let profile: { ADMIN?: boolean };
  try {
    profile = await restCall<{ ADMIN?: boolean }>(fetchFn, clientEndpoint, auth.accessToken, 'profile');
  } catch (err) {
    if (err instanceof BitrixError) throw new AuthError('Token de Bitrix24 inválido o vencido', 401);
    throw err;
  }
  if (!profile?.ADMIN) throw new AuthError('Solo un administrador de Bitrix24 puede configurar connect24', 403);

  const inst: Installation = {
    memberId: auth.memberId,
    domain: auth.domain,
    clientEndpoint,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken || existing?.refreshToken || '',
    expiresAt: Math.floor(Date.now() / 1000) + auth.expiresIn,
  };
  store.saveInstallation(inst);
  return inst;
}
