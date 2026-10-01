# connect24

**WhatsApp conectado a Bitrix24.** Aplicación local de Bitrix24 que conecta un número de WhatsApp
Business (modo coexistencia, vía Botika) con los **Canales Abiertos**: los mensajes del cliente entran como
chats del CRM y las respuestas de los operadores salen por WhatsApp.

```
Cliente WhatsApp ──► Botika ──webhook──► connect24 ──imconnector.send.messages──► Canal abierto (Bitrix24)
Cliente WhatsApp ◄── Botika ◄──API────── connect24 ◄──OnImConnectorMessageAdd──── Operador responde
```

## Estado

| Pieza | Estado |
|---|---|
| Instalación como app local, registro del conector, eventos | Implementado y probado con simulaciones |
| Página de ajustes del conector (por canal abierto) | Implementado |
| Texto WhatsApp → Bitrix y Bitrix → WhatsApp, deduplicación, acuses de entrega/lectura | Implementado |
| Adaptador de Botika | **Provisional**: asume el formato de la API Cloud de Meta (ver abajo) |
| Imágenes, audios, documentos | No (llegan como `[📷 Imagen]`) |
| Mensajes escritos desde el celular (eco de coexistencia) | Se reciben pero no se reflejan en el chat de Bitrix |
| Plantillas (fuera de la ventana de 24 h) | No |
| Probado contra un portal Bitrix24 real | **No** (ver abajo) |

## Lo que hay que verificar antes de producción

1. **Contrato de Botika.** No pude leer `waofficial.botika.online/docs/api/overview` (bloqueado en el entorno donde
   se construyó). `src/providers/botika.ts` supone el formato de Meta Cloud API
   (`POST {url}/{phoneNumberId}/messages`, webhooks `entry[].changes[].value`). Si Botika difiere, solo hay que
   cambiar ese archivo; nada más conoce el formato de red.
2. **Métodos REST de Bitrix24.** Se escribieron a partir de `imconnector.*` / `imopenlines.*` sin poder abrir
   `apidocs.bitrix24.com`. El primer chat de prueba real confirma o corrige detalles (p. ej. el campo del número
   en el contacto del lead).
3. **Logo.** Copia el archivo a `assets/logo.png` (se muestra en las pantallas de la app). El icono del conector en
   Contact Center debe ser cuadrado: opcionalmente `assets/connector-icon.png`.

## Puesta en marcha

### 1. Publicar connect24 en una URL HTTPS pública

Cualquier hosting con Node 22.13+ o Docker (`Dockerfile` incluido). Monta un volumen persistente en `/app/data`.

```bash
cp .env.example .env     # completa PUBLIC_URL, APP_SECRET (openssl rand -hex 32)...
npm ci && npm run build && npm start
```

### 2. Crear la aplicación local en Bitrix24

En el portal: **Recursos para desarrolladores → Otros → Aplicación local** (con tu usuario administrador):

| Campo | Valor |
|---|---|
| Tipo | Servidor |
| Ruta del controlador | `https://TU-DOMINIO/bitrix/app` |
| Ruta de instalación inicial | `https://TU-DOMINIO/bitrix/install` |
| Permisos (scopes) | `imconnector`, `imopenlines`, `im` |

Al guardar, Bitrix24 muestra **client_id** y **client_secret**: ponlos en `BITRIX_CLIENT_ID` y
`BITRIX_CLIENT_SECRET` y reinicia connect24. Deja `BITRIX_ALLOWED_DOMAINS` con el dominio del portal
(solo esos portales podrán instalar la app). Abre la app una vez desde el menú de Bitrix24: registra el conector y
enlaza los eventos.

### 3. Conectar un número

1. **Contact Center → Canales abiertos** → agrega el conector **WhatsApp (connect24)** y elige el canal abierto.
2. En la pantalla que abre, completa URL de la API de Botika, ID del número y token → *Guardar y activar*.
3. Copia la **URL de webhook** que muestra connect24 y configúrala en Botika como destino de los mensajes.

## Seguridad

- Los tokens (OAuth de Bitrix24 y de Botika) se guardan cifrados con AES-256-GCM derivado de `APP_SECRET`.
  Si cambias `APP_SECRET`, hay que reinstalar la app y volver a guardar los canales.
- Instalar/configurar exige un token **de administrador** válido del portal y, si se define, un dominio permitido;
  un `member_id` falsificado no puede sobrescribir otra instalación.
- Los eventos de Bitrix24 llegan a una URL firmada con HMAC (`?m=…&sig=…`); el webhook de Botika se identifica por
  una clave aleatoria de 192 bits en la ruta.
- Si el token de actualización de Bitrix24 (28 días) caduca por inactividad, abre la app para renovarlo.

## Desarrollo

```bash
npm run dev        # servidor con recarga
npm test           # 43 pruebas (vitest)
npm run typecheck
```

Estructura: `src/bitrix/` (cliente REST, conector de Canales Abiertos, autenticación), `src/providers/`
(adaptador de WhatsApp), `src/services/bridge.ts` (lógica en ambos sentidos), `src/routes/` (HTTP), `src/views/` (pantallas).
