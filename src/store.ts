import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Secrets } from './crypto.js';
import { randomToken } from './crypto.js';

export interface Installation {
  memberId: string;
  domain: string;
  /** REST base, e.g. https://portal.bitrix24.es/rest/ */
  clientEndpoint: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface LineConfig {
  memberId: string;
  lineId: string;
  /** Random path segment used in the public provider webhook URL. */
  routeKey: string;
  baseUrl: string;
  token: string;
  phoneNumberId: string;
  active: boolean;
}

export interface StoredMessage {
  providerMessageId: string;
  direction: 'in' | 'out';
  memberId: string;
  lineId: string;
  /** Bitrix IM ids (outbound only), needed to ack delivery/read. */
  imChatId: string | null;
  imMessageId: string | null;
  /** Our external chat id (the WhatsApp number). */
  externalChatId: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly secrets: Secrets) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS installations (
        member_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        client_endpoint TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lines (
        member_id TEXT NOT NULL,
        line_id TEXT NOT NULL,
        route_key TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL,
        token TEXT NOT NULL,
        phone_number_id TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (member_id, line_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        provider_message_id TEXT NOT NULL,
        route_scope TEXT NOT NULL,
        direction TEXT NOT NULL,
        member_id TEXT NOT NULL,
        line_id TEXT NOT NULL,
        im_chat_id TEXT,
        im_message_id TEXT,
        external_chat_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider_message_id, route_scope)
      );
    `);
  }

  // --- installations ------------------------------------------------------

  getInstallation(memberId: string): Installation | undefined {
    const row = this.db.prepare('SELECT * FROM installations WHERE member_id = ?').get(memberId);
    if (!row) return undefined;
    return {
      memberId: String(row.member_id),
      domain: String(row.domain),
      clientEndpoint: String(row.client_endpoint),
      accessToken: this.secrets.decrypt(String(row.access_token)),
      refreshToken: this.secrets.decrypt(String(row.refresh_token)),
      expiresAt: Number(row.expires_at),
    };
  }

  saveInstallation(inst: Installation): void {
    this.db
      .prepare(
        `INSERT INTO installations (member_id, domain, client_endpoint, access_token, refresh_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id) DO UPDATE SET
           domain = excluded.domain,
           client_endpoint = excluded.client_endpoint,
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at`,
      )
      .run(
        inst.memberId,
        inst.domain,
        inst.clientEndpoint,
        this.secrets.encrypt(inst.accessToken),
        this.secrets.encrypt(inst.refreshToken),
        inst.expiresAt,
      );
  }

  // --- lines --------------------------------------------------------------

  private rowToLine(row: Record<string, unknown>): LineConfig {
    return {
      memberId: String(row.member_id),
      lineId: String(row.line_id),
      routeKey: String(row.route_key),
      baseUrl: String(row.base_url),
      token: this.secrets.decrypt(String(row.token)),
      phoneNumberId: String(row.phone_number_id),
      active: Number(row.active) === 1,
    };
  }

  getLine(memberId: string, lineId: string): LineConfig | undefined {
    const row = this.db.prepare('SELECT * FROM lines WHERE member_id = ? AND line_id = ?').get(memberId, lineId);
    return row ? this.rowToLine(row) : undefined;
  }

  getLineByRoute(routeKey: string): LineConfig | undefined {
    const row = this.db.prepare('SELECT * FROM lines WHERE route_key = ?').get(routeKey);
    return row ? this.rowToLine(row) : undefined;
  }

  /** Creates or updates a line; keeps the existing routeKey so the webhook URL given to the provider stays valid. */
  upsertLine(input: Omit<LineConfig, 'routeKey'>): LineConfig {
    const existing = this.getLine(input.memberId, input.lineId);
    const routeKey = existing?.routeKey ?? randomToken();
    this.db
      .prepare(
        `INSERT INTO lines (member_id, line_id, route_key, base_url, token, phone_number_id, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id, line_id) DO UPDATE SET
           base_url = excluded.base_url,
           token = excluded.token,
           phone_number_id = excluded.phone_number_id,
           active = excluded.active`,
      )
      .run(
        input.memberId,
        input.lineId,
        routeKey,
        input.baseUrl,
        this.secrets.encrypt(input.token),
        input.phoneNumberId,
        input.active ? 1 : 0,
      );
    return { ...input, routeKey };
  }

  deleteLine(memberId: string, lineId: string): void {
    this.db.prepare('DELETE FROM lines WHERE member_id = ? AND line_id = ?').run(memberId, lineId);
  }

  // --- messages -----------------------------------------------------------

  /** Returns false when this provider message id was already recorded (duplicate webhook delivery). */
  recordMessage(msg: StoredMessage): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO messages
           (provider_message_id, route_scope, direction, member_id, line_id, im_chat_id, im_message_id, external_chat_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.providerMessageId,
        `${msg.memberId}:${msg.lineId}`,
        msg.direction,
        msg.memberId,
        msg.lineId,
        msg.imChatId,
        msg.imMessageId,
        msg.externalChatId,
        Math.floor(Date.now() / 1000),
      );
    return Number(result.changes) > 0;
  }

  findMessage(memberId: string, lineId: string, providerMessageId: string): StoredMessage | undefined {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE provider_message_id = ? AND route_scope = ?')
      .get(providerMessageId, `${memberId}:${lineId}`);
    if (!row) return undefined;
    return {
      providerMessageId: String(row.provider_message_id),
      direction: row.direction === 'out' ? 'out' : 'in',
      memberId: String(row.member_id),
      lineId: String(row.line_id),
      imChatId: row.im_chat_id === null ? null : String(row.im_chat_id),
      imMessageId: row.im_message_id === null ? null : String(row.im_message_id),
      externalChatId: String(row.external_chat_id),
    };
  }

  close(): void {
    this.db.close();
  }
}
