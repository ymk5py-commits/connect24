# Despliegue de connect24 separado de BOT SRPY

connect24 es un servicio **propio**: no comparte URL, proceso, base de datos ni credenciales de Bitrix con Botika.
Botika ya corre en el servidor SRPY con Coolify (`botsrpy.santarosa.lat`, DNS en Cloudflare, túnel al servidor);
connect24 se agrega ahí como **otra aplicación** de Coolify.

## Qué queda separado

| | BOT SRPY (Botika) | connect24 (Vitria Home) |
|---|---|---|
| URL | `botsrpy.santarosa.lat` | `connect24.santarosa.lat` (propuesta) |
| Portal Bitrix24 | el de Santa Rosa | `vitriahome.bitrix24.es` |
| Aplicación local de Bitrix | su `client_id`/`client_secret` | **otra** app, con sus propias credenciales |
| Base de datos | Supabase | SQLite propio (`/app/data`) |
| Conector en Bitrix | `botika_wa` «WhatsApp (BOT SRPY)» | `connect24_whatsapp` «WhatsApp» |
| `APP_SECRET` | — | uno nuevo, distinto a cualquier otro |

El único punto de contacto es **opcional**: el reenvío de los mensajes de *un* número desde `api/meta-webhook.js`
(ver [botika-reenvio.md](botika-reenvio.md)), activado solo para ese `phone_number_id` con `CONNECT24_FORWARD`.

## Aplicación en Coolify
Los nombres de pantalla pueden variar; lo que importa son los valores.

- Origen: repositorio `croman-coder/connect24` (rama `claude/nifty-ride-b020oq`, o `main` cuando la fusiones)
- Build Pack: **Dockerfile** · Puerto: **3000** · Health check: `/healthz`
- Almacenamiento persistente: volumen montado en **`/app/data`** (sin él, instalación y canales se pierden en cada deploy)
- Dominio: `https://connect24.santarosa.lat` (mismo patrón DNS/túnel que `botsrpy`)
- Variables de entorno:

```
PUBLIC_URL=https://connect24.santarosa.lat
APP_SECRET=<openssl rand -hex 32>        # nuevo y único
BITRIX_ALLOWED_DOMAINS=vitriahome.bitrix24.es
CONNECTOR_NAME=WhatsApp
# BITRIX_CLIENT_ID / BITRIX_CLIENT_SECRET: se agregan después de crear la app en Bitrix24
```

Luego, con esa URL, se crea la aplicación local en Bitrix24 (ver README, paso 2).
