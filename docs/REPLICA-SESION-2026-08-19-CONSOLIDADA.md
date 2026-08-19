# RÉPLICA CONSOLIDADA sesiones 2026-08-15 → 2026-08-19 — guía para implementar en la repo gemela

> **Cómo usar esto:** copiá TODO este documento como prompt inicial en una sesión
> del asistente parada en la OTRA repo (que ya aplicó completas las guías
> `REPLICA-SESION-2026-08-10.md` y `REPLICA-SESION-2026-08-14.md`). Es la
> especificación FINAL consolidada de TODO lo implementado en giroxNARDOnuevoo
> entre el 2026-08-15 y el 2026-08-19 (entradas 175-193 del WORKLOG + un commit
> de front que quedó fuera del WORKLOG). Las features acá ya están CONSOLIDADAS:
> donde hubo iteraciones (ej. el chat del casino pasó por 4 versiones), se
> especifica SOLO el estado final — implementá directo ese estado final, no las
> versiones intermedias.

---

## INSTRUCCIONES PARA EL ASISTENTE QUE IMPLEMENTA

1. **NO copies líneas a ciegas.** Verificá con grep cada nombre de
   función/archivo citado antes de tocar; las repos pueden haber divergido.
2. Un commit por bloque (o por feature dentro del bloque si es grande), con
   `node --check` en cada archivo JS tocado (no hay node_modules local: solo
   syntax check).
3. **Convenciones del proyecto** (ver CLAUDE.md local): montos en PESOS;
   idempotencia por `reference`; bump del SW en cada cambio de front (PWA:
   `public/firebase-messaging-sw.js`; panel: `public/admin-sw.js`) — con TODO
   este doc alcanza UN bump del SW de la PWA y UN bump del admin-sw al final;
   actualizar WORKLOG.md; commit+push a main.
4. **Orden de implementación:** los bloques están ordenados por dependencia
   (A → B → C → D → E → F). El bloque A (giroxService) es la base de B y C.
5. Verificá cada bloque con su "PROBAR".
6. Al final hay una **tabla de env vars nuevas** y las **acciones del owner**
   (config de SSM propia de cada entorno — NO valen los valores del original).

---

## BLOQUE A — giroxService: rate limit POR KEY, pools de keys y caches de lectura

**Contexto de todo el bloque:** el límite de la Partner API de 1girox es
**60 req/min POR API KEY** (confirmado por su soporte; a pedido lo suben a 180
en keys puntuales). El lag nocturno que sufría la plataforma (agentes viendo
chats/cargas lentísimos en los picos) tenía DOS causas encadenadas: (1) todas
las keys compartían UNA sola ventana de rate limit local; (2) la PWA polleaba
el saldo de cada usuario online cada 30s, y los jugadores de un publicista
comparten la única key de ese publicista → con ~15 usuarios online de un
publicista su carril (30/min local) se saturaba y TODO lo de esos usuarios
(saldo, bonos, cargas, SSO) quedaba en cola hasta 30s. Este bloque es el fix
estructural completo. Todo vive en `src/services/giroxService.js` salvo donde
se indica.

### A.1 Limitador local POR KEY (no más ventana única)

- Reemplazar la ventana única del limitador local por un
  `const _laneTimestamps = new Map()` (`apiKey → timestamps de la ventana`).
- `_acquireSlot(laneKey)`: espera lugar en la ventana DE ESA KEY (60s de
  ventana, `MAX_QUEUE_WAIT_MS = 30000` se mantiene). El techo por key lo da
  `_laneLimit(laneKey)`:
  - key de consultas → su sufijo `:rpm` (ver A.2), o `GIROX_MAX_RPM` sin sufijo;
  - master (o sin key) → `GIROX_MAX_RPM`;
  - key de publicista con override → su rpm de `GIROX_PUBLISHER_KEY_RPM` (A.3);
  - resto de publicistas → `PUBLISHER_MAX_RPM` (A.3).
- En `_request`, el slot se pide con `_acquireSlot(keyOverride || getApiKey())`.
  El warn de saturación debe decir el techo real del carril y si era una key de
  consultas: `rate limit local saturado (X/min, key consultas), abortando` →
  error `{ code: 'rate_limited_local', error: 'La plataforma está saturada...' }`.

### A.2 Pool de keys SOLO-CONSULTAS (`GIROX_API_KEY_CONSULTAS`)

- Env opcional `GIROX_API_KEY_CONSULTAS`: UNA o VARIAS keys separadas por coma,
  cada una con sufijo opcional `:rpm` (techo POR INSTANCIA de esa key; sin
  sufijo → `GIROX_MAX_RPM`). Ej. 2 instancias, una key de 180 y una de 60:
  `pk_aaa:90,pk_bbb:30`. Parseo en `_readsKeyConfigs()` →
  `[{key, rpm}]` (sufijo inválido cae al default; se parsea con `lastIndexOf(':')`).
- ⚠️ Las keys DEBEN ser del MISMO agente que la master (una key de otro agente
  NO VE a los jugadores).
- `_request` gana un flag **`readOnly`**: si la request es lectura pura y NO
  tiene keyOverride (iría por la master), firma con `_pickReadsKey()` — la key
  de consultas con MÁS LUGAR LIBRE (`rpm − usado` en su ventana). Nunca
  reemplaza la key de un publicista (es la única que ve a SUS jugadores).
- Marcan `readOnly: true`: `getPlayerStats` y `getPlayersStatsBatch` (netwin →
  reembolsos, VIP, referidos, datos). Sin la env → todo por la master como
  siempre (deploy seguro antes de crear las keys).

### A.3 Techos de las keys de PUBLICISTA

- `const PUBLISHER_MAX_RPM = Number(process.env.GIROX_PUBLISHER_MAX_RPM || 30)`
  — las keys de publicista NO heredan `GIROX_MAX_RPM` (que acompaña a la
  master): en la plataforma siguen en 60/min → 60÷2 instancias = 30.
- Env opcional `GIROX_PUBLISHER_KEY_RPM` = `pk_x:90,pk_y:90` — override POR key
  de publicista puntual (para cuando 1girox le sube el límite a UN publicista
  grande). Parseo `_publisherKeyConfigs()` (mismo formato `:rpm`; entrada sin
  sufijo se descarta).

### A.4 POOL de keys del MISMO publicista (soluciona el mega-publicista)

- **Contexto:** un publicista gigante (miles de usuarios) satura su única key.
  El owner no puede pedir que se la suban, PERO controla el panel de cada
  publicista y puede generarle MÁS keys. Comprobado con curl: una 2ª key del
  mismo publicista VE a los jugadores creados con la 1ª (comparten scope bajo
  el agente) → repartir entre N keys = N×60/min de cupo.
- El resolver de server.js (ver B.1) ahora puede devolver un **ARRAY** de keys.
  En `_request`, tras resolver: si `keyOverride` es array →
  `keyOverride = _pickPublisherKey(keyOverride)` — elige la key del pool con
  más lugar libre en su ventana (usa `_laneLimit` por key). ⚠️ Se elige **UNA
  vez por operación, ANTES del loop de reintentos** (igual que el resolver):
  cambiar de key entre reintentos del mismo pago no rompe la idempotencia por
  reference (la reference es la misma), pero elegir una vez es lo correcto y
  más simple de razonar.
- Función nueva exportada **`readPlayerWithKey(apiKey, username)`**: lee un
  jugador con una key EXPLÍCITA, sin cache, sin resolver, `retryable:false`.
  Devuelve `{ found:bool, username?, balance?, error?, code? }`. La usa el
  panel para validar que una key extra ve a los jugadores (bloque B).

### A.5 Cache corto + coalescing de la lectura de jugador (LA causa raíz del lag)

`getUserInfoByName` (y `getUserBalance`, que la usa) es el punto más consultado
del cliente: poll de saldo de la PWA, guards de bono, status de reembolso, etc.
Estructura:

- `PLAYER_CACHE_TTL_MS = Number(process.env.GIROX_PLAYER_CACHE_MS || 8000)`.
- Tres Maps: `_playerCache` (usernameLower → {data, ts}), `_playerInflight`
  (coalescing: N pedidos simultáneos comparten UNA request en vuelo),
  `_playerInvalidatedAt` (usernameLower → ts de la última invalidación).
- **Solo se cachean lecturas EXITOSAS** (nunca null/errores).
- `_invalidatePlayer(username)`: borra el cache del usuario Y registra el ts de
  invalidación. Se llama tras CADA operación de plata del usuario: en
  `depositToUser`, `withdrawFromUser`, `creditUserBalance` (bono) y
  `claimPendingBonus` (cuando la operación fue OK).
- `_maybeCachePlayer(key, data, startTs)`: cachea SOLO si
  `_playerInvalidatedAt[key] < startTs` — evita la race de una lectura que
  estaba en vuelo cuando se acreditó/retiró y escribiría el saldo
  pre-operación DESPUÉS de la invalidación. (🔴 Este guard y el `fresh` de
  abajo salieron de una revisión adversarial: sin ellos hay bugs de plata.)
- Prune periódico cada 60s con `.unref()`: borra entradas vencidas de
  `_playerCache` y `_statsCache`; los ts de invalidación se conservan 300s
  (más que la peor lectura en vuelo: timeout + reintentos ~80s).
- **Opción `{fresh:true}`** en `getUserInfoByName(username, opts)`: saltea
  cache Y coalescing (lectura garantizada fresca contra girox) pero igual
  refresca el cache para las lecturas de display siguientes. `getUserBalance`
  y `getUserBalanceWithRetry` propagan `{fresh}`.
- **Call sites que DEBEN pasar `fresh:true`** (decisiones de plata — buscalos
  en server.js con grep, los nombres pueden variar en la gemela):
  1. La verificación anti-fantasma del retiro (el "saldo antes" y el "saldo
     después" que se comparan al confirmar el descuento de fichas). Sin esto,
     el "antes" sale del cache viejo → puede marcar un retiro real como
     fallido o cancelar uno válido por "saldo insuficiente".
  2. Los guards bono-sobre-bono (el de `/api/admin/bonus`, el del welcome code
     cash y el del regalo por lote/notif-batch): leen
     `bonusLocked`/`claimableTotal` y deciden plata.
  - Las lecturas de DISPLAY (poll de saldo, status de reembolso) NO pasan
    fresh — son justamente lo que se quiere cachear.

### A.6 Cache del netwin (`getPlayerStats`)

- `STATS_CACHE_TTL_MS = Number(process.env.GIROX_STATS_CACHE_MS || 90000)`,
  Map `_statsCache` con clave `usernameLower|from|to`.
- `getPlayerStats(username, from, to, label, opts)` acepta `opts.fresh` que
  saltea el cache. Solo se cachea el éxito. Es seguro: el rango del status de
  reembolso es un período CERRADO → netwin estable.
- **La RECLAMACIÓN de reembolso (paga plata) pasa `{fresh:true}`** — en
  server.js, las dos llamadas con labels tipo `refund-weekly` y
  `refund-monthly` dentro del claim. El STATUS (consulta) va cacheado.

### A.7 Visibilidad: logs a stdout + radiografía de boot

- En producción el winston de `src/utils/logger.js` escribe SOLO a archivos
  locales que NO entran en los logs de EB → los warns del limitador y los 429
  eran invisibles. Fix: en giroxService, envolver el logger para que `warn` y
  `error` se ESPEJEN a `console.warn/error` (con timestamp), además del
  archivo.
- Exports de diagnóstico: `getReadsKeysCount()`, `getReadsKeysSummary()`
  (ej. `"2 (techos 90, 30/min)"`), `getPublisherKeyOverridesCount()`.
- En el bootstrap de server.js (después de `loadSecretsFromSSM`), radiografía:
  ```
  [girox] config: key master OK · keys consultas cargadas: N (techos …) ·
  GIROX_MAX_RPM=X · publicistas=Y/min (+Z overrides) · cache jugador=8000ms
  ```
- En `smsService` (envío por AWS SNS), tras el publish OK:
  `console.log('[smsService] OK → SNS MessageId=' + resp.MessageId)` — SIN el
  teléfono. Separa "no se envió" de "no se entregó" (la entrega la come el
  límite de gasto de SMS de SNS, ver acciones del owner).

**PROBAR (A):** `node --check` giroxService.js + server.js + smsService.js.
Post-deploy, el boot loguea la línea `[girox] config:` con los valores
esperados. Con la PWA abierta, el saldo se ve igual que siempre; tras una
carga, el saldo del cliente se refresca al valor nuevo al instante (la
invalidación). Un retiro normal descuenta y confirma bien.

---

## BLOQUE B — Pool de keys por publicista: resolver + panel admin

Todo esto asume A.4 hecho. Objetivo: que una campaña/publicista pueda tener
VARIAS keys de 1girox y el sistema reparta lecturas Y cargas entre ellas.

### B.1 Modelo y resolver

- `Campaign` (src/models/Campaign.js): campo nuevo
  `giroxApiKeysExtra: { type: [String], default: [], select: false }` — pool
  de keys ADICIONALES del mismo publicista. `giroxApiKey` sigue siendo la
  "principal". `hasGiroxKey` (espejo booleano sin select:false) se mantiene en
  sincronía en todos los caminos de escritura.
- El resolver `username → key` de server.js (el que se inyecta con
  `girox.setKeyResolver`): al leer la campaña selecciona
  `+giroxApiKey +giroxApiKeysExtra`; si hay extras devuelve el **ARRAY**
  `[primary, ...extras]`, si no el string de siempre. El cache del resolver
  (60s por username, Map `_giroxKeyCache` con backstop `size > 5000 → clear()`)
  se **limpia entero** (`_giroxKeyCache.clear()`) cuando el panel guarda o
  modifica las keys de una campaña → el pool nuevo pega al instante.

### B.2 Guardado de keys en el panel (SUMAR, validar, saltear malas)

- Helper en server.js **`_parsePublisherKeys(rawKey, campaignCode)`** (async):
  parte por coma, y para cada key: (1) si no empieza con `pk_` → va a
  `skipped` con razón `'no empieza con "pk_"'`; (2) si la campaña ya tiene
  jugadores (`User.findOne({ giroxOwnerCampaign: code, role:'user' })` como
  muestra), prueba `girox.readPlayerWithKey(key, sample.username)` — si no lo
  ve → `skipped` con `'no ve a los jugadores del publicista'`. Devuelve
  `{ valid: [...dedup], skipped: [{key: enmascarada 8 chars + '…', reason}] }`.
  **Tolerante:** una key mala NO tira error ni rechaza las demás — se saltea y
  se informa.
- `POST /api/admin/campaigns` (alta): si viene key (campo `giroxApiKey` o el
  legacy `jugayganaPassword`), solo rol `admin` puede setearla; se parsea →
  `giroxApiKey = valid[0]`, `giroxApiKeysExtra = valid.slice(1)`. La respuesta
  incluye `skipped` y NUNCA devuelve las keys (borrarlas del toObject()).
- `PUT /api/admin/campaigns/:code` (edición): **las keys pegadas se SUMAN al
  pool existente** (se lee el pool previo con `select('+giroxApiKey
  +giroxApiKeysExtra')`, se concatena con dedup, `primary = combined[0]`,
  `extras = combined.slice(1)`) — NO reemplazan, así no se pierde la key ya
  guardada (que puede ser la única copia: el owner borra su copia local por
  seguridad). `clearJugayganaCreds:true` limpia key + extras + hasGiroxKey.
  Respuesta incluye `skipped`. Tras cualquier cambio de keys: limpiar
  `_giroxKeyCache` + `giroxPublisherKeys.invalidateSession(code)`.

### B.3 Endpoints de gestión del pool

- **`GET /api/admin/campaigns/:code/pool-status`** (authMiddleware +
  adminMiddleware + check `role === 'admin'`): arma
  `keys = [primary, ...extras]`; sin keys →
  `{ total: 0, results: [], note: 'Sin key propia (usa la cuenta master).' }`.
  Con keys: prueba CADA una contra un jugador real de la campaña
  (`readPlayerWithKey`) y devuelve
  `{ total, sampleUser, results: [{ n (1-based), key (10 chars + '…'), role:
  'principal'|'extra', sees: bool|null }] }` (`sees:null` si la campaña aún no
  tiene jugadores para probar).
- **`POST /api/admin/campaigns/:code/pool-remove`** body `{ index }` (1-based,
  como lo muestra pool-status): quita ESA key del pool y re-deriva
  primary+extras (si se quita la última, la campaña queda sin key propia →
  vuelve a la master). Limpia `_giroxKeyCache` + invalidateSession. Devuelve
  `{ ok:true, total }`.

### B.4 Panel (public/adminprivado2026/admin.js + admin.html)

- El campo "API key de 1girox" del modal de campaña acepta VARIAS keys
  separadas por coma (`maxlength` subido a 600). El texto de ayuda del panel
  explica el pool: que las keys pegadas SE SUMAN al pool existente (no
  reemplazan), que todas deben ser del mismo publicista, y que N keys = N×60/min.
- Botón **"🔍 Estado del pool"** en el modal de la campaña: llama pool-status y
  muestra "N keys en el pool · cuáles ven a los jugadores"; cada fila tiene un
  🗑 "quitar" que llama pool-remove con su índice (confirmar antes).
- Al guardar, si la respuesta trae `skipped` no vacío, avisar cuáles keys no
  se agregaron y por qué (las demás sí se guardaron).
- **Bump de admin-sw** al terminar el bloque.

⚠️ **ORDEN de deploy:** primero deployar el código del pool, DESPUÉS cargar
las keys separadas por coma. Si se pegan varias keys en el back viejo,
guardaría todo el string como UNA key inválida y rompe al publicista.

**PROBAR (B):** crear/editar una campaña con 2+ keys separadas por coma (una
buena y una con typo) → guarda las buenas, avisa la salteada; "🔍 Estado del
pool" muestra N keys y ✓ en las que ven al jugador; 🗑 quita una y el total
baja; las operaciones de los jugadores de esa campaña siguen funcionando.

---

## BLOQUE C — Alta por LANDING externa (solo-nombre, sin SMS) + landing de conversión

### C.1 Endpoint `POST /api/landing/signup` (server.js)

Público, sin auth. Flujo: una landing en un dominio puente pide SOLO un nombre
→ se crea el usuario en 1girox atribuido a la pauta, se vincula a la app local
y se devuelve un link de acceso de un solo uso + las credenciales.

- **Anti-abuso:** rate limit por IP (`landingIpLimiter`, ventana 1h, máx
  `LANDING_SIGNUP_MAX_PER_IP_HOUR` default 8, mismo helper que el limiter de
  SMS/registro). Kill-switch `LANDING_SIGNUP_DISABLED=true` → 410. El SMS NO
  se pide al crear: el candado ya vive en el retiro
  (`/api/withdrawal/request` exige `phoneVerified`) — y no se le avisa al
  cliente al principio.
- **Body:** `{ name, campaignCode, utm?, fbc?, fbp?, landingUrl? }`. Valida
  nombre 2-60 chars y que la campaña exista y esté activa
  (`Campaign.findOne({ code: normalizado a MAYÚSCULAS, isActive: true })`).
- **Username:** `_sanitizeUsernameBase(name)` (NFD sin acentos, minúsculas,
  solo `[a-z0-9]`, máx 12 chars para dejar lugar al sufijo, prefijo `gx` si
  queda < 3) + `_deriveUniqueUsername`: hasta 12 intentos de
  `base + crypto.randomInt(100, 999999)` recortado a 18, validando con
  `girox.validateUsername` y colisión local case-insensitive. ⚠️ El cliente de
  la plataforma en server.js se llama `girox` — usar el nombre de import REAL
  de la gemela (acá hubo un bug: se escribió `giroxService.validateUsername` y
  reventaba con ReferenceError en runtime, que `node --check` no agarra).
- **Password:** PIN de 6 dígitos `String(crypto.randomInt(100000, 1000000))` —
  cumple el mínimo ≥6 de 1girox y se DEVUELVE en la respuesta para mostrársela
  al cliente (puede volver a entrar desde cualquier dispositivo).
- **Orden de creación:** 1girox PRIMERO (si falla, NO queda cuenta local
  huérfana): si `Campaign.hasGiroxApiKey(code)` → alta con la key del
  publicista (`giroxPublisherKeys.createUserAsPublisher`) y
  `giroxOwnerCampaign = code`; si no → `girox.syncUserToPlatform` (master).
  Después `User.create` con: `phoneVerified:false`,
  `phoneVerificationPending:true`, `acquisitionCampaign`, 
  **`acquisitionSource:'landing'`**, `acquisitionUtm` (5 campos truncados a
  100), `metaFbc/metaFbp` (del body o de las cookies de la request),
  `landingUrl` (≤2000), IP y User-Agent de registro, referralCode generado.
- ⚠️ **`'landing'` debe estar en el enum de `acquisitionSource` del schema
  User** (src/models/User.js) — acá faltaba y el endpoint tiraba 500 por
  ValidationError de Mongoose.
- **Conversión:** `metaCapi.track('CompleteRegistration', …, { content_name:
  'signup_landing', campaign_code, publisher }, { req })` + webhook fb-ads.
- **Acceso:** `issueAccessLinkFor(newUser.id)` (link de un solo uso) y se le
  agrega **`&ir=casino`** → la PWA abre el casino directo al loguear (ver D).
- **Respuesta 201:** `{ success:true, accessUrl, username, password }`.
- **Errores a stdout:** el catch del endpoint espeja `error.stack` con
  `console.error` (el winston va solo a archivo y los 500 eran invisibles en
  EB).

### C.2 CORS abierto SOLO para ese endpoint

Middleware ANTES del `cors()` global: si `req.path === '/api/landing/signup'`
→ `Access-Control-Allow-Origin: <origin reflejado>` (no `*`), `Vary: Origin`,
`Allow-Methods: POST, OPTIONS`, `Allow-Headers: Content-Type`, SIN
Allow-Credentials (no usa cookies), y responde 204 al preflight OPTIONS. El
resto de rutas sigue con el CORS estricto de `ALLOWED_ORIGINS`. Motivo: las
landings puente rotan de dominio (Vercel/Cloudflare/dominio final) y no se
puede redeployar por cada host. Seguro: endpoint público, sin credenciales,
protegido por código de campaña + límite por IP.

### C.3 El access-link NO fuerza cambio de clave para cuentas de landing

En el canje del link (`/api/auth/access-link` en server.js): el select del
usuario suma `acquisitionSource`, y `mustChangePassword` solo se fuerza si
`user.acquisitionSource !== 'landing'` — las cuentas de landing YA recibieron
usuario+clave en pantalla; las creadas por agente (clave temporal) siguen
forzando el cambio como antes. El single-use del link sigue siendo atómico.

### C.4 Landing puente (`landing/index.html`, archivo suelto — NO va en public/)

Landing de conversión estática (marca de la gemela) que se sube al dominio
puente (Vercel, etc.):

- Constantes arriba del script: `API_BASE_DEFAULT` (el backend de producción),
  `CAMPAIGN_CODE` (fijo, o vacío = tomar de `?p=` / `?campaign=` / path),
  `BONUS_BIG` / `BONUS_SUB` (texto del banner de bono — ⚠️ deben ser la oferta
  REAL: mostrarle a Meta algo distinto de lo que ve el usuario es cloaking →
  baneo de dominio+pixel+cuenta).
- **Override para pruebas:** `?api=https://otro-backend` en la URL pisa
  `API_BASE` sin editar el archivo (se limpia la barra final).
- Contenido: banner de bono, pitch, form de nombre, sellos de confianza
  (acreditación al instante / retiros rápidos / soporte 24/7), legal +18.
- Al crear: pantalla de **credenciales** (usuario + clave grandes + "guardalos")
  con botón "ENTRAR A MI CUENTA" → `accessUrl` (cae logueado y con `ir=casino`
  abre el casino directo). **Popup de enganche** ("tu bono te espera") al
  intento de salida o a los 12s, una sola vez.
- Postea `{ name, campaignCode, landingUrl, fbc, fbp }` a
  `API_BASE + '/api/landing/signup'`.
- (Opcional, existe en el original: `landing/demo.html`, una landing SIMULADA
  sin backend para mostrarle el flujo a un partner. Replicar solo si hace
  falta.)

**PROBAR (C):** `node --check` server.js + User.js. Abrir la landing con
`?p=CODIGO` (y `?api=` si es entorno de prueba) → poner un nombre → muestra
usuario + PIN de 6 dígitos → "ENTRAR A MI CUENTA" → cae logueado, SIN pedir
cambio de clave, directo al casino. Pedir un retiro → exige SMS. Si la campaña
es de publicista, el jugador aparece bajo el sub-agente correcto en la
plataforma. El preflight OPTIONS desde un dominio cualquiera responde 204.

---

## BLOQUE D — Front PWA: casino a pantalla completa + widget flotante de soporte + poll 90s

**ESTADO FINAL (consolida 4 iteraciones — implementar directo esto):** el
casino embebido se ve TAL CUAL el sitio del casino (pantalla completa, sin
barra propia), con una burbuja de soporte que abre un widget flotante estilo
"chat de soporte" en la esquina. Todo en `public/js/ui.js`
(`VIP.ui._showCasinoFrame` y funciones asociadas), estilos inline.

### D.1 Overlay del casino

- `#casinoOverlay`: `position:fixed;inset:0;z-index:99999;background:#0d0d1a;
  display:flex;flex-direction:column;` + `padding-top/bottom:
  env(safe-area-inset-top/bottom, 0px)` (iPhone PWA instalada: notch y home
  indicator).
- Adentro SOLO: (1) `#casinoFrameStatus` ("🎰 Entrando al casino…", también
  muestra errores con Reintentar/Volver); (2) `#casinoFrame` iframe
  `flex:1;width:100%;border:0` con `allow="autoplay; fullscreen; payment"`;
  (3) la burbuja y el widget (abajo). **SIN barra superior** — el chrome vive
  en el widget.
- Al `load` del iframe (con src ya seteado): ocultar el status, mostrar el
  frame y **cancelar el watchdog** (`clearTimeout(VIP.ui._casinoWatchdog)`) —
  el aviso "¿el casino no termina de cargar?" aparecía ENCIMA del casino ya
  funcionando.
- Cerrar (`closeCasinoFrame`): SIEMPRE des-montar el chat primero (D.3),
  vaciar `frame.src` (que no siga sonando de fondo), restaurar
  `document.body.style.overflow`, y refrescar el saldo (`syncBalance`). El
  botón "atrás" del celu (popstate) cierra el overlay en vez de salir.

### D.2 Burbuja de soporte + widget flotante

- **Burbuja** `#casinoSupportBubble`: botón redondo 60px fijo abajo a la
  derecha (`right:16px; bottom:calc(18px + env(safe-area-inset-bottom,0px))`),
  gradiente verde, ícono 🎧, sombra. Onclick `VIP.ui.toggleCasinoChat()`.
  Lleva el badge rojo de no leídos `#casinoChatBadge` (esquina superior).
- **Widget** `#casinoChatDrawer` (display:none hasta abrir): panel flotante
  ANCLADO a la esquina (NO parte la pantalla, el juego sigue visible):
  `position:absolute; right:16px; bottom:calc(88px + safe-area);
  width:min(380px, 100vw−24px); height:min(600px, 72vh);
  flex-direction:column; background:#0d0d1a; borde dorado suave;
  border-radius:16px; overflow:hidden; sombra grande`. Estructura:
  1. **Header verde** (gradiente): avatar 🎧, título "Soporte <MARCA>",
     subtítulo "● EN LÍNEA" (puntito verde con glow), botón ✕ que cierra
     (mismo toggle).
  2. **Acciones principales** (fila de 2 botones grandes):
     "💰 Quiero Depositar" (verde, despliega la sub-fila de montos) y
     "💸 Solicitar Retiro" (dorado).
  3. **Sub-fila de montos** `#casinoAmountRow` (oculta hasta tocar Depositar):
     chips $2.000 / $5.000 / $10.000 / $20.000.
  4. **Fila chica de chips** (scroll horizontal): "📋 Pedir CBU" ·
     "✅ Ya transferí" · "💬 Hablar".
  5. **Escapes discretos** (barrita de links subrayados chiquitos):
     "↗ Casino aparte" (`openCasinoInTab`) · "🚪 Salir del casino"
     (`closeCasinoFrame`).
  6. `#casinoChatDrawerBody` (`flex:1; min-height:0`) — acá se MUDA el chat
     real.

### D.3 El chat real se MUDA al widget (no se copia)

- `toggleCasinoChat()` → si está cerrado `_casinoChatMount()`, si no
  `_casinoChatUnmount()`.
- **Mount:** insertar dos placeholders invisibles donde están
  `.chat-container` y `.chat-input-container` en la página, y hacer
  `appendChild` de los nodos REALES adentro de `#casinoChatDrawerBody`
  (conserva ids, listeners y socket → es EL MISMO chat; el agente lo ve por su
  bandeja de siempre, cero cambios de backend/panel). Compactación: ocultar la
  cabecera del chat (`.chat-topbar` — el widget ya tiene título propio) y
  pisar `min-height` de `.chat-container` a `0` (guardando el valor previo);
  badge a cero; scroll al fondo tras `requestAnimationFrame`.
- **Unmount:** restaurar topbar y min-height, devolver ambos nodos a sus
  placeholders exactos, ocultar el widget. `closeCasinoFrame` SIEMPRE llama
  unmount antes de cerrar (si no, la pantalla principal queda sin chat).
- **Badge de no leídos:** un `MutationObserver` (creado una sola vez) sobre
  `#chatMessages` cuenta nodos agregados mientras el casino está abierto Y el
  widget cerrado → pinta 1..9+ en `#casinoChatBadge`; se resetea al abrir.

### D.4 Acciones rápidas (`VIP.ui.casinoQuickAction(action, arg)`)

Todo termina en el chat del cajero (los botones solo ahorran tipeo; el cajero
sigue confirmando todo — no es un bot). Helper
`VIP.ui._casinoSendQuick(text)`: pone el texto en `#messageInput` y llama
`VIP.chat.sendMessage()`.

- `'cargar-toggle'` → muestra/oculta `#casinoAmountRow`.
- `'cargar', monto` → manda "🎰 Quiero cargar $X" (toLocaleString es-AR).
- `'cbu'` → `VIP.ui.loadAndShowCBU()`.
- `'comprobante'` → click en `#attachBtn` (abre cámara/archivo).
- `'retirar'` → manda "💸 Quiero retirar mi premio". (El SMS se exige recién al
  procesar el retiro real — sin cambios acá.)
- `'escribir'` → focus en `#messageInput`.
- (`'cargar-otro'` y `'saldo'` existen como acciones extra: prellenar
  "🎰 Quiero cargar $" con focus, y syncBalance + "👛 ¿Me confirmás mi saldo?".)

### D.5 Entrada por landing → casino directo (public/js/auth.js)

En `tryAccessLink` (ANTES de limpiar la URL) leer si la URL trae `ir=casino`;
tras `showChatScreen()` en `verifyToken`, si estaba → `VIP.ui.enterCasino()`
(el cliente cae directo al juego; el chat queda en el widget).

### D.6 Poll de saldo 30s → 90s

`setInterval(syncBalance, 90000)` (era 30000). El saldo igual se refresca al
instante por socket (`balance_updated`) en cargas/retiros/bonos y al cerrar el
casino; el poll solo cubre cambios por juego mientras el cliente mira la PWA
sin jugar. Es la mitad-front del fix del lag (bloque A.5).

**Bump del SW de la PWA al terminar el bloque.**

**PROBAR (D):** entrar por la landing → casino a pantalla completa (sin barra
arriba), burbuja 🎧 abajo a la derecha → tocar: se abre el widget en la
esquina con el juego visible atrás → "💰 Quiero Depositar" → $5.000 → llega
"🎰 Quiero cargar $5.000" a la bandeja del panel admin → "📋 Pedir CBU"
muestra el CBU → "✅ Ya transferí" abre la cámara → mensaje entrante con el
widget cerrado → badge rojo en la burbuja → "🚪 Salir del casino" vuelve a la
app con el chat intacto en su lugar. En iPhone instalado: nada bajo el
notch/home indicator.

---

## BLOQUE E — `SSM_SKIP_KEYS`: entorno CLON con su propia DB/URL

En `src/config/loadSecrets.js` (o donde viva el loader de SSM de la gemela):
`loadSecretsFromSSM` respeta la env `SSM_SKIP_KEYS` (lista coma-separada de
NOMBRES de claves): esas claves NO se sobreescriben desde SSM → un entorno
CLON que comparte el `SSM_PATH` de producción puede setearlas como propiedades
de entorno propias (ej. `SSM_SKIP_KEYS=MONGODB_URI,PUBLIC_BASE_URL` + su
`MONGODB_URI` de test + su `PUBLIC_BASE_URL`). El log final dice cuántas cargó
y cuáles NO sobrescribió. Producción no define la env → comportamiento
idéntico (cero riesgo). ⚠️ Las keys de la plataforma siguen compartidas → las
cargas/retiros del clon pegan a la plataforma REAL: aislar la DB evita
ensuciar usuarios reales; para la plata, montos mínimos.

**PROBAR (E):** `node --check`. En un entorno con `SSM_SKIP_KEYS` definida, el
boot loguea "(N NO sobrescritos por SSM_SKIP_KEYS: …)" y usa la DB propia.

---

## BLOQUE F — Meta CAPI: 2º PIXEL opcional (partner de tracking)

En `src/services/metaCapiService.js`. Contexto: el partner de la pauta pidió
recibir los MISMOS eventos server-side en SU pixel (CompleteRegistration,
Purchase, WithdrawRequest, Lead, InitiateCheckout, RefundClaim, Login — todo
el embudo ya existente).

- Helper `_capiDestinations()`: arma la lista de destinos EN CADA envío (las
  env de SSM cargan post-require): siempre el propio
  (`META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` + `META_TEST_EVENT_CODE`
  opcional) y, si existen `META_PIXEL_ID_2` + `META_CAPI_ACCESS_TOKEN_2`, el
  del partner (con `META_TEST_EVENT_CODE_2` opcional). `isConfigured()` =
  hay ≥1 destino.
- `sendEvent`: arma UN solo objeto evento con **el MISMO `event_id` para
  todos los destinos** (cada pixel deduplica por su lado contra su pixel de
  navegador) y lo dispara a cada destino EN PARALELO (`Promise.all`); un fallo
  en uno no afecta al otro; cada destino usa su propio `test_event_code`.
  Devuelve `{ sent: alguno OK, eventId, results: [{dest, sent, …}] }`.
- Sin las env `_2` → un solo destino, comportamiento idéntico al de antes
  (deploy seguro antes de tener los datos del partner).
- Boot de server.js loguea:
  `[MetaCAPI] pixels: propio=OK · partner(2º)=OK 123456… | no configurado`.

**PROBAR (F):** `node --check`. Sin env `_2`: todo igual que antes. Con env
`_2` de prueba: el boot dice `partner(2º)=OK …` y el partner ve los eventos en
su Events Manager → Probar eventos (con su test code).

---

## ENV VARS NUEVAS (todas opcionales — sin ellas, comportamiento previo)

| Env | Default | Qué hace |
|---|---|---|
| `GIROX_API_KEY_CONSULTAS` | — | Pool de keys solo-lectura, coma-separadas, sufijo `:rpm` opcional por key |
| `GIROX_PUBLISHER_MAX_RPM` | 30 | Techo local por instancia de las keys de publicista |
| `GIROX_PUBLISHER_KEY_RPM` | — | Overrides `pk_x:rpm` por key de publicista puntual |
| `GIROX_PLAYER_CACHE_MS` | 8000 | TTL del cache de lectura de jugador/saldo |
| `GIROX_STATS_CACHE_MS` | 90000 | TTL del cache de netwin (status de reembolso) |
| `LANDING_SIGNUP_MAX_PER_IP_HOUR` | 8 | Límite de altas por landing por IP/hora |
| `LANDING_SIGNUP_DISABLED` | — | `true` = apaga el alta por landing (410) |
| `SSM_SKIP_KEYS` | — | Claves que SSM no pisa (solo entornos clon) |
| `META_PIXEL_ID_2` / `META_CAPI_ACCESS_TOKEN_2` / `META_TEST_EVENT_CODE_2` | — | 2º pixel CAPI (partner) |

Recordatorio del criterio de techos locales: **techo local = límite de la key
en la plataforma ÷ N instancias**. Config del original como referencia (2
instancias, master subida a 180): `GIROX_MAX_RPM=90`, consultas `pk_a:90` o
`pk_b:30` según cada key, publicistas default 30. La gemela debe usar SUS
propios valores según sus keys y su cantidad de instancias.

## ⚠️ ACCIONES DEL OWNER de la gemela (después del deploy)

1. Crear 1-2 keys extra de CONSULTAS en el panel de la plataforma (MISMO
   agente que la master) y cargarlas en su SSM (`GIROX_API_KEY_CONSULTAS`).
2. Para el/los publicistas gigantes: generar keys extra desde el panel del
   publicista y pegarlas coma-separadas en el campo del panel (DESPUÉS de
   deployar el bloque B) — o pedir a la plataforma subirles el límite y setear
   `GIROX_PUBLISHER_KEY_RPM`.
3. Subir `landing/index.html` al dominio puente con su `API_BASE` y agregar la
   oferta REAL en `BONUS_BIG/SUB`.
4. Si los SMS "no llegan" pero el log dice `[smsService] OK → SNS MessageId=…`:
   revisar en AWS SNS el **límite de gasto mensual de SMS** (descarta en
   silencio al superarlo) y subirlo.
5. Cuando el partner de tracking mande Pixel ID + Access Token: cargar las env
   `_2` en SSM y redeployar; verificar `partner(2º)=OK` en el boot.

## NO REPLICAR (contexto, no código)

- Los diagnósticos puros del WORKLOG original (#175, #179, #191): la evidencia
  del lag es de ESA infraestructura. Acá va solo el código resultante.
- El commit `test auth` (commit vacío para probar credenciales de git).
- Un commit temporal de debug que exponía el error 500 del signup al cliente
  (se agregó y se REVIRTIÓ — no dejar nada que exponga stack traces).
- `vercel.json` existe en el original para poder importar el repo en Vercel;
  solo replicar si la gemela usa el mismo truco (y ojo: JSON sin coma final).

## CIERRE

Al terminar: WORKLOG.md con una entrada por bloque (qué/por qué/cómo probar),
UN bump del SW de la PWA + UN bump del admin-sw, `node --check` de todo,
commit por bloque y push. Después del deploy, correr los "PROBAR" y mirar en
el boot las líneas `[girox] config:` y `[MetaCAPI] pixels:`.
