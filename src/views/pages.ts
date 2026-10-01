import type { OpenLine } from '../bitrix/connector.js';
import type { LineConfig } from '../store.js';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const CSS = `
  :root { --navy:#0b1b2b; --gold:#c9a24b; --green:#25d366; --blue:#1da1f2; --line:#e3e8ee; --muted:#5b6b7b; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--navy); background:#fff; }
  .wrap { max-width: 760px; margin: 0 auto; }
  header { text-align:center; margin-bottom: 20px; }
  header img { max-width: 360px; width: 100%; height:auto; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:24px 0 8px; }
  p.sub { color:var(--muted); margin:0 0 16px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px; margin:12px 0; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:0; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
  .ok { background:#e6f9ee; color:#0a7a3a; } .off { background:#eef1f5; color:var(--muted); } .warn { background:#fff4e0; color:#8a5a00; }
  label { display:block; font-weight:600; margin:14px 0 4px; }
  input[type=text], input[type=password], input[type=url] { width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font:inherit; }
  small { color:var(--muted); display:block; margin-top:4px; }
  code, .mono { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; background:#f3f6f9; padding:2px 6px; border-radius:6px; word-break:break-all; }
  button { background:var(--navy); color:#fff; border:0; padding:11px 22px; border-radius:8px; font:inherit; font-weight:600; cursor:pointer; margin-top:18px; }
  button:hover { background:#13304a; }
  .alert { padding:12px 14px; border-radius:8px; margin:12px 0; }
  .alert.err { background:#fdecea; color:#8a1c12; } .alert.good { background:#e6f9ee; color:#0a5a2c; }
  footer { margin-top:28px; text-align:center; color:var(--muted); font-size:12px; }
  footer b { color:var(--gold); }
`;

export function layout(title: string, body: string, scripts = ''): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style>
<script src="//api.bitrix24.com/api/v1/"></script></head>
<body><div class="wrap">
<header><img src="/assets/logo.png" alt="connect24" onerror="this.style.display='none'"></header>
${body}
<footer>connect24 · <b>WhatsApp conectado a Bitrix24</b></footer>
</div>
<script>try{BX24.init(function(){BX24.fitWindow();});}catch(e){}${scripts}</script>
</body></html>`;
}

export function errorPage(message: string): string {
  return layout('connect24 · Error', `<div class="alert err">${esc(message)}</div>`);
}

export function installDonePage(): string {
  return layout(
    'connect24 · Instalado',
    `<h1>connect24 instalado</h1>
     <p class="sub">El conector de WhatsApp ya está registrado en tus Canales Abiertos.</p>
     <div class="alert good">Siguiente paso: en <b>Contact Center</b> abre el conector <b>WhatsApp (connect24)</b>, elige o crea un canal abierto y completa las credenciales de Botika.</div>`,
    `try{BX24.init(function(){BX24.installFinish();});}catch(e){}`,
  );
}

export interface AppPageData {
  domain: string;
  connectorName: string;
  registration: 'registered' | 'already-registered';
  eventsAdded: string[];
  lines: Array<OpenLine & { configured: boolean; active: boolean }>;
  linesError?: string;
}

export function appPage(d: AppPageData): string {
  const rows = d.lines.length
    ? d.lines
        .map(
          (l) => `<div class="row"><div><b>${esc(l.name)}</b> <span class="mono">#${esc(l.id)}</span></div>
          <span class="badge ${l.active ? 'ok' : l.configured ? 'warn' : 'off'}">${l.active ? 'Activo' : l.configured ? 'Configurado, inactivo' : 'Sin configurar'}</span></div>`,
        )
        .join('')
    : `<p class="sub">${d.linesError ? esc(d.linesError) : 'Todavía no hay canales abiertos.'}</p>`;

  return layout(
    'connect24',
    `<h1>connect24</h1>
     <p class="sub">Portal <b>${esc(d.domain)}</b></p>
     <div class="card"><div class="row"><span>Conector «${esc(d.connectorName)}»</span>
       <span class="badge ok">${d.registration === 'registered' ? 'Registrado ahora' : 'Registrado'}</span></div>
       <div class="row"><span>Eventos de mensajes</span><span class="badge ok">${d.eventsAdded.length ? 'Enlazados ahora' : 'Enlazados'}</span></div></div>
     <h2>Canales abiertos</h2><div class="card">${rows}</div>
     <h2>Cómo conectar un número</h2>
     <div class="card"><ol style="margin:0;padding-left:18px">
       <li>Ve a <b>Contact Center → Canales abiertos</b> y agrega el conector <b>${esc(d.connectorName)}</b>.</li>
       <li>Elige (o crea) el canal abierto que atenderá ese número.</li>
       <li>Completa la URL de la API y el token de Botika, y guarda.</li>
       <li>Copia la URL de webhook que te muestra connect24 y pégala en Botika.</li></ol></div>`,
  );
}

export interface SettingsPageData {
  memberId: string;
  authId: string;
  lineId: string;
  webhookUrl?: string;
  line?: LineConfig;
  error?: string;
  saved?: boolean;
}

export function settingsPage(d: SettingsPageData): string {
  const alert = d.error
    ? `<div class="alert err">${esc(d.error)}</div>`
    : d.saved
      ? `<div class="alert good">Guardado y conector activado en el canal abierto #${esc(d.lineId)}.</div>`
      : '';
  const webhook = d.webhookUrl
    ? `<div class="card"><b>URL de webhook para Botika</b><small>Pégala en Botika como destino de los mensajes entrantes de este número.</small><p><code>${esc(d.webhookUrl)}</code></p></div>`
    : `<div class="card"><b>URL de webhook para Botika</b><small>Se genera al guardar por primera vez.</small></div>`;

  return layout(
    'connect24 · WhatsApp',
    `<h1>Conectar WhatsApp (Botika)</h1>
     <p class="sub">Canal abierto <span class="mono">#${esc(d.lineId)}</span></p>
     ${alert}
     <form method="post" action="/bitrix/settings/save">
       <input type="hidden" name="member_id" value="${esc(d.memberId)}">
       <input type="hidden" name="auth_id" value="${esc(d.authId)}">
       <input type="hidden" name="line" value="${esc(d.lineId)}">
       <label for="base_url">URL de la API de Botika</label>
       <input id="base_url" name="base_url" type="url" required placeholder="https://..." value="${esc(d.line?.baseUrl)}">
       <label for="phone_number_id">ID del número (phone number id)</label>
       <input id="phone_number_id" name="phone_number_id" type="text" required value="${esc(d.line?.phoneNumberId)}">
       <label for="token">Token de acceso</label>
       <input id="token" name="token" type="password" autocomplete="off" ${d.line ? '' : 'required'} placeholder="${d.line ? '•••••••• (déjalo vacío para conservarlo)' : ''}">
       <small>Se guarda cifrado. Nunca se muestra de nuevo.</small>
       <button type="submit">Guardar y activar</button>
     </form>
     ${webhook}`,
  );
}
