import { describe, expect, it } from 'vitest';
import { bbToWhatsApp } from '../src/bitrix/connector.js';

describe('bbToWhatsApp', () => {
  it('converts basic BB-codes to WhatsApp markup', () => {
    expect(bbToWhatsApp('Hola [b]Juan[/b], [i]gracias[/i][br]Saludos')).toBe('Hola *Juan*, _gracias_\nSaludos');
  });
  it('keeps link target when label differs and strips unknown tags', () => {
    expect(bbToWhatsApp('[url=https://a.com/x]Ver[/url] [size=14]texto[/size]')).toBe('Ver (https://a.com/x) texto');
  });
  it('collapses excess blank lines', () => {
    expect(bbToWhatsApp('a[br][br][br][br]b')).toBe('a\n\nb');
  });
});
