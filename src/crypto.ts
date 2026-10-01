import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Encrypts secrets at rest (AES-256-GCM) and signs URLs (HMAC-SHA256), both derived from APP_SECRET. */
export class Secrets {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(appSecret: string) {
    this.encKey = createHash('sha256').update(`enc:${appSecret}`).digest();
    this.macKey = createHash('sha256').update(`mac:${appSecret}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  sign(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex');
  }

  verify(value: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(value));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}
