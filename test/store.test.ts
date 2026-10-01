import { describe, expect, it } from 'vitest';
import { Secrets } from '../src/crypto.js';
import { loadConfig } from '../src/config.js';
import { makeEnv } from './helpers.js';

describe('Secrets', () => {
  const s = new Secrets('y'.repeat(40));
  it('round-trips and uses a fresh IV each time', () => {
    const a = s.encrypt('token');
    expect(s.decrypt(a)).toBe('token');
    expect(a).not.toBe(s.encrypt('token'));
  });
  it('fails to decrypt with another key or tampered data', () => {
    const a = s.encrypt('token');
    expect(() => new Secrets('z'.repeat(40)).decrypt(a)).toThrow();
    const raw = Buffer.from(a, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => s.decrypt(raw.toString('base64'))).toThrow();
  });
  it('signs and verifies', () => {
    expect(s.verify('m1', s.sign('m1'))).toBe(true);
    expect(s.verify('m2', s.sign('m1'))).toBe(false);
    expect(s.verify('m1', 'short')).toBe(false);
  });
});

describe('loadConfig', () => {
  it('lists every missing variable', () => {
    expect(() => loadConfig({})).toThrow(/PUBLIC_URL.*APP_SECRET.*BITRIX_CLIENT_ID.*BITRIX_CLIENT_SECRET/);
  });
  it('requires https and a long secret, and trims the trailing slash', () => {
    expect(() => loadConfig(makeEnv({ PUBLIC_URL: 'http://example.com' }))).toThrow(/https/);
    expect(() => loadConfig(makeEnv({ APP_SECRET: 'short' }))).toThrow(/32/);
    expect(loadConfig(makeEnv({ PUBLIC_URL: 'https://a.example/' })).publicUrl).toBe('https://a.example');
  });
});
