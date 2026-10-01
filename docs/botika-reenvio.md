# Reenviar los mensajes de WhatsApp desde Botika a connect24

Un número solo puede apuntar a **un** webhook por app de Meta. Si el número de coexistencia ya está conectado a
Botika (Embedded Signup), los mensajes llegan a `api/meta-webhook.js`. Para que connect24 también los reciba,
Botika debe reenviar el cuerpo **sin cambios** (formato de Meta). El envío de respuestas no necesita a Botika:
connect24 llama directo a la Graph API con el token del número.

## 1. En connect24
En la pantalla del canal abierto, guarda ID del número y token. connect24 muestra la **URL de webhook**
(`https://TU-DOMINIO/webhooks/whatsapp/<clave>`).

## 2. En Botika (`api/meta-webhook.js`, función `handleWhatsAppCloud`)
Justo después de la verificación de firma, antes del `for (const entry …)`:

```js
// connect24: reenviar el payload crudo de los números que atiende connect24.
// CONNECT24_FORWARD = {"<phone_number_id>":"https://TU-DOMINIO/webhooks/whatsapp/<clave>"}
const forward = (() => { try { return JSON.parse(process.env.CONNECT24_FORWARD || '{}'); } catch { return {}; } })();
const targets = new Set();
for (const entry of payload.entry || []) {
  for (const change of entry.changes || []) {
    const url = forward[change?.value?.metadata?.phone_number_id];
    if (url) targets.add(url);
  }
}
await Promise.all([...targets].map((url) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw, signal: AbortSignal.timeout(8000) })
    .then((r) => { if (!r.ok) console.warn(`[connect24] reenvío ${r.status}`); })
    .catch((e) => console.warn('[connect24] reenvío falló', e.message))));
```

Notas:
- connect24 descarta lo que no sea de su número (`metadata.phone_number_id`), así que puedes reenviar varios números a la vez.
- Los números que no son clientes de Botika hoy terminan en «no enabled tenant» y se ignoran: no hay que registrar a Vitria Home como tenant.
- Si prefieres que Meta reintente cuando falle el reenvío, devuelve 500 en ese caso (connect24 deduplica por id de mensaje).
