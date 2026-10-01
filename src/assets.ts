import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#25D366"/><path d="M32 14a18 18 0 0 0-15.6 27L14 50l9.3-2.4A18 18 0 1 0 32 14z" fill="#fff"/><path d="M26 24c-1 1-2 3-1 5 2 4 6 8 10 9 2 .8 4-.3 5-1.5l-1-2.5-3-1-1.5 1.5c-2-1-4-3-5-5l1.3-1.6-1-3z" fill="#25D366"/></svg>`;

/**
 * Icon shown for the connector inside Bitrix24 (Contact Center). It must be square, so it is a separate file
 * from the wide logo: drop a square image at assets/connector-icon.png (or .svg) to override the default.
 */
export function connectorIconDataUri(assetsDir: string): string {
  for (const [file, mime] of [
    ['connector-icon.png', 'image/png'],
    ['connector-icon.svg', 'image/svg+xml'],
  ] as const) {
    const path = join(assetsDir, file);
    if (existsSync(path)) return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  }
  return `data:image/svg+xml;base64,${Buffer.from(DEFAULT_ICON_SVG).toString('base64')}`;
}
