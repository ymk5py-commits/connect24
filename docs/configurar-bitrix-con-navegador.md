# Configurar connect24 en Bitrix24 con el navegador (para una sesión con la extensión de Chrome)

La extensión de Chrome solo funciona en Claude Code que corre **en tu computadora** (`claude --chrome`), no en una
sesión en la nube. Clona el repo, entra a la rama `claude/nifty-ride-b020oq`, abre `claude --chrome` y pega:

---

Configura la app **connect24** en el portal `https://vitriahome.bitrix24.es` usando el navegador (debo estar ya
logueado como administrador; si no, avísame y espera). Datos: `PUBLIC_URL` = `<<URL pública donde está desplegado connect24>>`.
Los nombres de menú pueden variar un poco: guíate por lo que ves en pantalla.

**Reglas:** no modifiques ni borres nada existente (canales de Facebook/Instagram, leads, usuarios, otras apps). Antes
de pulsar cualquier botón de guardar, dime qué vas a guardar. No me muestres ni copies en el chat `client_secret` ni
tokens: guárdalos directamente en `.env` del repo.

1. Verifica que `PUBLIC_URL/healthz` responde `{"ok":true}`. Si no, para y avísame.
2. Menú **Recursos para desarrolladores → Otros → Aplicación local** → crear.
   - Nombre: `connect24` · Tipo: Servidor (no «solo API»)
   - Ruta del controlador: `PUBLIC_URL/bitrix/app`
   - Ruta de instalación inicial: `PUBLIC_URL/bitrix/install`
   - Permisos: `imconnector`, `imopenlines`, `im`
   - Texto del menú: `connect24`
3. Al guardar, Bitrix muestra `client_id` y `client_secret`: escríbelos en `.env` como `BITRIX_CLIENT_ID` y
   `BITRIX_CLIENT_SECRET` y dime que el servidor debe reiniciarse con ellos.
4. Abre la app `connect24` desde el menú de Bitrix24. Debe mostrar «Registrado» y «Eventos enlazados». Si muestra un
   error, cópialo tal cual y detente.
5. **Centro de contacto** (Contact Center) → Canales abiertos → conector **WhatsApp** → crea o elige el canal abierto
   «WhatsApp Vitria Home». En la pantalla de ajustes **no completes ID del número ni token**: te los doy yo.
6. Devuélveme: la URL de webhook que muestra connect24 y una captura del canal activo.
