# connect24

**WhatsApp conectado a Bitrix24.** Aplicación local de Bitrix24 (pensada para `vitriahome.bitrix24.es`) que
conecta un número de WhatsApp Business en **coexistencia** con los **Canales Abiertos**: los mensajes del cliente
entran como chats del CRM y las respuestas de los operadores salen por WhatsApp.

```
Cliente ─► WhatsApp (Meta) ─webhook─► connect24 ─imconnector.send.messages─► Canal abierto (Bitrix24)
                          └─(o reenviado por Botika, ver docs/botika-reenvio.md)
Cliente ◄─ WhatsApp (Graph API) ◄─ connect24 ◄─OnImConnectorMessageAdd─ Operador responde
```

Sigue el mismo esquema que el puente de BOT SRPY en Botika (app local OAuth + `imconnector`), pero es una app
independiente y multi-portal: no toca el puente de producción de Botika.

## Estado

| Pieza | Estado |
|---|---|
| Instalación como app local, registro del conector, eventos, ajustes por canal | Implementado, probado con simulaciones |
| Texto WhatsApp → Bitrix y Bitrix → WhatsApp, dedupe, acuse de entrega y lectura | Implementado |
| Reintento ante `QUERY_LIMIT_EXCEEDED` de Bitrix, `event.bind` tolerante | Implementado (patrones tomados de Botika) |
| Imágenes, audios, documentos | **No**: llegan como `[📷 Imagen]`; los adjuntos del operador salen como enlace |
| Mensajes escritos desde el celular (eco de coexistencia) | Se reciben y se ignoran |
| Plantillas (fuera de la ventana de 24 h) | No: WhatsApp rechaza el texto libre y se registra el error |
| Probado contra el portal real | **No** (ver abajo) |

## Pendiente de confirmar en el primer chat real

- Los métodos de Bitrix24 (`imconnector.*`, `imopenlines.*`) se escribieron sin poder abrir su documentación; los
  detalles que Botika ya usa en producción (`user.phone`, `PLACEMENT_HANDLER`, reintentos) están incorporados.
  El primer mensaje real confirma el resto (p. ej. cómo queda el nombre del lead).
- **Logo:** copia el archivo a `assets/logo.png`. El icono del conector en Centro de contacto debe ser cuadrado:
  opcionalmente `assets/connector-icon.png`.

## Puesta en marcha

### 1. Publicar connect24 en una URL HTTPS pública
Necesita un proceso Node 22.13+ siempre encendido y un disco persistente (SQLite en `/app/data`): no sirve para
funciones serverless. `Dockerfile` incluido.

```bash
cp .env.example .env     # PUBLIC_URL y APP_SECRET (openssl rand -hex 32); BITRIX_CLIENT_* se agregan en el paso 3
npm ci && npm run build && npm start
```

### 2. Crear la aplicación local en Bitrix24
Con el usuario administrador de `vitriahome.bitrix24.es`: **Recursos para desarrolladores → Otros → Aplicación local**.

| Campo | Valor |
|---|---|
| Nombre | `connect24` |
| Tipo | Servidor |
| Ruta del controlador | `https://TU-DOMINIO/bitrix/app` |
| Ruta de instalación inicial | `https://TU-DOMINIO/bitrix/install` |
| Permisos | `imconnector`, `imopenlines`, `im` |

*Para que lo haga una sesión de Claude con acceso al navegador, usa [docs/configurar-bitrix-con-navegador.md](docs/configurar-bitrix-con-navegador.md).*

### 3. Credenciales
Bitrix24 muestra `client_id` y `client_secret` al guardar. Ponlos en `BITRIX_CLIENT_ID` / `BITRIX_CLIENT_SECRET` y
reinicia (sin ellos el servidor arranca, pero los tokens de Bitrix —1 hora— no se pueden renovar). Abre la app una
vez desde el menú de Bitrix24: registra el conector y enlaza los eventos.

### 4. Conectar el número
1. **Centro de contacto → Canales abiertos** → conector **WhatsApp** → elige o crea el canal abierto.
2. Completa ID del número y token de acceso de Meta → *Guardar y activar*.
3. Configura la **URL de webhook** que muestra connect24: en Meta si llama directo (el «token de verificación» es el
   valor que se muestra), o en Botika para que reenvíe ([docs/botika-reenvio.md](docs/botika-reenvio.md)).

> El conector se llama «WhatsApp» (`CONNECTOR_NAME`): Bitrix lo usa como origen del lead, `WhatsApp - {nombre del canal}`.

## Seguridad
- Tokens (OAuth de Bitrix24 y de Meta) cifrados en reposo con AES-256-GCM derivado de `APP_SECRET`
  (si lo cambias, hay que reinstalar y volver a guardar los canales).
- Instalar o configurar exige un token **de administrador** válido y un dominio de `BITRIX_ALLOWED_DOMAINS`; un
  `member_id` falsificado no sobrescribe otra instalación.
- Eventos de Bitrix24 en una URL firmada con HMAC; el webhook de WhatsApp se identifica por una clave aleatoria de
  192 bits en la ruta.

## Desarrollo
```bash
npm run dev && npm test && npm run typecheck     # 52 pruebas (vitest)
```
`src/bitrix/` (cliente REST, conector, autenticación) · `src/providers/whatsapp-cloud.ts` (formato de Meta, el único
archivo que conoce el protocolo de WhatsApp) · `src/services/bridge.ts` (lógica en ambos sentidos) · `src/routes/` ·
`src/views/`.
