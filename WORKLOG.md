# WORKLOG — Estado vivo del proyecto

> Se actualiza tras cada cambio significativo (ver regla en `CLAUDE.md`). El detalle
> commit por commit está en `git log --oneline`. Esto captura decisiones, umbrales de
> negocio y pendientes que NO se ven leyendo el código.
>
> **Última actualización: 2026-08-19**

## Sesión 2026-08-19

### 195. Partner API v1.11 PROBADA en vivo: `agent_id` es "crear y ENTREGAR" — NO reemplaza las keys de publicista
- **Contexto:** llegó el manual v1.11 (guardado en `docs/PARTNER-APIv1.11.pdf`;
  estábamos integrados hasta v1.9). Novedades: (v1.11) `agent_id` opcional en
  `POST /players` + `GET /agents` + error `agent_not_allowed`; (v1.10, nos la
  habíamos perdido) bono con multiplicador **0** = regalo directo, disponible
  al instante, sin reclamo y **ya no pisa el bono en curso**.
- **Prueba en vivo (curl, key de prueba de la cuenta raíz, base
  `https://api-1gx.com/api/v1`):**
  1. `GET /agents` → 200 con los 4 sub-agentes: chat1=16893, onekey=16896,
     digital=16897, martin=16898. (Sirve además para verificar si una key es
     de la cuenta raíz: una key de publicista devolvería lista vacía.)
  2. Alta `zz_agtest7226` con `agent_id:16896` (onekey) → **201 OK**, pero la
     MISMA key que lo creó recibe **404 player_not_found** al leerlo (probado
     2 veces): el jugador queda ENTREGADO al sub-agente; solo las keys de
     onekey lo ven/operan.
  3. Control: alta `zz_agtest1833` SIN agent_id → la key lo lee perfecto
     (el `active:false` que devuelve el 201 es cosmético; en la lectura ya
     viene `active:true`).
- **CONCLUSIÓN:** muere la hipótesis de reemplazar el ruteo por keys de
  publicista con "master + agent_id": la master NO puede operar (ni leer) al
  jugador después del alta → seguimos necesitando la key del publicista para
  TODO lo posterior (saldo, cargas, retiros, SSO). `agent_id` solo serviría
  para el ALTA sin tener la key del publicista — y las keys ya las tenemos.
  El pool de keys por publicista (#192) sigue siendo la solución vigente.
- **Pendiente de decisión (v1.10):** aflojar los guards bono-sobre-bono para
  regalos con multiplicador 0 (ya no pisan el bono en curso) — no tocado.
- **Restos de la prueba:** `zz_agtest7226` quedó colgado del panel de onekey y
  `zz_agtest1833` bajo la cuenta raíz (saldo 0, inofensivos; no hay endpoint
  de borrado). La key de prueba pegada en el chat debe ELIMINARSE del panel.

### 194. Doc de RÉPLICA consolidado para la repo gemela (sesiones 15→19/8) + WORKLOG al día
- **Pedido del owner:** retomar la práctica de los docs `REPLICA-SESION-*` (la
  última era la del 2026-08-14) con UN doc consolidado de todo lo pendiente.
- **Nuevo:** `docs/REPLICA-SESION-2026-08-19-CONSOLIDADA.md` — especificación
  del ESTADO FINAL (no las iteraciones) de las entradas 175-193, en 6 bloques:
  (A) giroxService: limitador por key, pool de consultas `:rpm`, techos de
  publicista, pool por publicista, cache+coalescing de jugador y de stats,
  logs a stdout; (B) pool de keys en panel/endpoints; (C) landing signup
  completa; (D) front casino final (widget flotante v106); (E) SSM_SKIP_KEYS;
  (F) 2º pixel CAPI. + tabla de env nuevas, acciones del owner y NO-replicar.
- **Registro tardío (commit `dc08a53`, 2026-08-17, sin entrada en su
  momento):** el chat del casino de #189 (bottom-sheet 50%) se rediseñó como
  **WIDGET flotante en la esquina** (380×600 máx, no parte la pantalla, estilo
  chat de soporte, header "Soporte 1GIROX · EN LÍNEA", botones "💰 Quiero
  Depositar" con montos desplegables y "💸 Solicitar Retiro", chips CBU/Ya
  transferí/Hablar, escapes "↗ Casino aparte"/"🚪 Salir") — **SW v106**, que
  es el estado vigente en producción. También sin entrada: `db9b3d3` (landing:
  override `?api=` para probar contra otro backend) y `20bf51e`
  (`landing/demo.html`, demo simulada para el partner).
- **✅ APLICADO EN LA GEMELA (owner, 2026-08-19):** la repo gemela implementó
  la guía consolidada completa → está al día hasta la entrada #193 inclusive.
  La PRÓXIMA guía de réplica arranca desde acá (#194 en adelante).

### 193. Meta CAPI: soporte de 2º PIXEL (partner de tracking) — solo cargar 2 env y deployar
- **Pedido:** el partner de la pauta pidió recibir los MISMOS eventos
  server-side en SU pixel (confirmó que quiere server-side/CAPI, no lectura de
  pixel). Alcanza con que manden su Pixel ID + Access Token.
- **Ya estaba:** el sistema tiene Meta CAPI (`metaCapiService`) que dispara
  server-to-server `CompleteRegistration`, `Purchase` (carga), `WithdrawRequest`
  (retiro), `Lead`, `InitiateCheckout`, `RefundClaim`, `Login` — todo el embudo.
- **Cambio (aditivo):** `sendEvent` ahora dispara a TODOS los destinos
  configurados en paralelo (mismo event_id, cada pixel deduplica por su lado).
  2º pixel OPCIONAL por env: `META_PIXEL_ID_2` + `META_CAPI_ACCESS_TOKEN_2`
  (+ `META_TEST_EVENT_CODE_2` opcional para que el partner verifique en su
  Events Manager → Probar eventos). Sin esas env, se comporta igual que antes
  (solo el pixel propio). Boot loguea `[MetaCAPI] pixels: propio=OK · partner=…`.
- **⚠️ ACCIÓN OWNER (cuando el partner mande los datos):** cargar en SSM
  `/nardo1girox/prod/` → `META_PIXEL_ID_2` y `META_CAPI_ACCESS_TOKEN_2` (y si dan
  un test code, `META_TEST_EVENT_CODE_2`), redeploy, y verificar en el boot
  `partner=OK`. Ellos confirman en su Events Manager que llegan los eventos.
- **Validado:** `node --check` OK + test de la lógica de destinos. **Back
  necesita redeploy** (recién cuando se carguen las env del partner; el cambio
  de código se puede deployar antes sin efecto hasta que existan las env).

## Sesión 2026-08-16

### 192. POOL de keys por publicista: varias keys del MISMO publicista para repartir la carga (soluciona ONEKEY sin subir límites)
- **Contexto:** ONEKEY (publicista gigante, miles de usuarios) satura su única
  key de 1girox (30/min local). El owner NO puede pedir que se la suban a 180
  (la key la genera el publicista), PERO controla el panel de cada publicista y
  **puede generar MÁS keys para ONEKEY**. Verificado con curl: una 2ª key de
  ONEKEY VE a los jugadores creados con la 1ª (comparten scope bajo el agente).
- **Solución:** un publicista puede tener VARIAS keys (`giroxApiKeysExtra` en
  Campaign, select:false) y el sistema **reparte lecturas Y cargas** entre
  `giroxApiKey` + las extras → N keys = N×60/min de cupo, sin depender de 1girox.
  - **Resolver (server.js):** si la campaña tiene extras, devuelve el ARRAY de
    keys; giroxService elige la de MÁS lugar libre (`_pickPublisherKey`, misma
    idea que el pool de consultas). Se elige UNA vez por operación (antes de los
    reintentos) → no rompe idempotencia por reference. Cache del resolver se
    limpia al guardar la campaña (pool nuevo al instante).
  - **Panel:** en el campo "API key de 1girox" se pegan VARIAS separadas por
    coma (`pk_a,pk_b,pk_c`). maxlength subido a 600. Al guardar, el backend
    VALIDA cada key extra contra un jugador real de la campaña
    (`girox.readPlayerWithKey`): si una no ve a los jugadores (key de otro
    publicista) la rechaza con mensaje claro. admin-sw **v40**.
- **⚠️ ACCIÓN OWNER:** en el panel → editar ONEKEY → en "API key de 1girox"
  pegar las keys separadas por coma (la actual + las nuevas que generes) →
  Guardar. Con 3 keys tenés 180/min para ONEKEY; con 4, 240; etc. (generás más
  cuando quieras).
- **Validado:** `node --check` OK (server.js, giroxService.js, Campaign.js) +
  test aislado del parseo/selección. **Back necesita redeploy** (a PRODUCCIÓN).
- **Verificación (botón nuevo):** en el modal de la campaña, **"🔍 Estado del
  pool"** (`GET /api/admin/campaigns/:code/pool-status`) muestra cuántas keys
  tiene y prueba cada una contra un jugador real → "5 keys en el pool · 5 ✓ ven
  a los jugadores". admin-sw **v41**. ⚠️ ORDEN: primero deployar el código del
  pool, DESPUÉS cargar las keys separadas por coma (si se cargan en el back
  viejo, guardaría todo como una key inválida y rompe el publicista).
- **Keys SE SUMAN + borrado por key (2026-08-18, admin-sw v42):** al editar, las
  keys pegadas se AGREGAN al pool existente (dedup), NO reemplazan → no se pierde
  la key que ya estaba guardada (la única copia: el owner borra su copia local
  por seguridad). Para reemplazar/limpiar: en "🔍 Estado del pool" cada key tiene
  un 🗑 "quitar" (`POST /api/admin/campaigns/:code/pool-remove` {index}). Texto
  del panel actualizado explicando el pool y el "se suman" para referencia
  futura. Las keys siguen ocultas para TODOS (select:false).
- **Tolerante a keys malas (admin-sw v43):** `_parsePublisherKeys` ya NO tira
  error en la 1ª key mala → agrega las BUENAS y SALTEA las malas (formato o que
  no ven a los jugadores), devolviendo `skipped[]`. El panel avisa cuáles no se
  agregaron (las demás sí). Así un typo en una no te hace perder las otras 4.

### 191. Reportes agentes 17-18/8: saturación bajó ~4× pero sigue en ONEKEY → cache del status de reembolso + visibilidad SMS
- **Reportes (Telegram = UTC = hora de los logs):** 18/8 03:09-03:43 "lento la
  carga de bono", "carga manual >30s", "no carga automático (van 4 chats)";
  17/8 00:06 "AUTO-CARGA hgcash FALLÓ — plataforma saturada"; 17/8 21:39
  "usuarios no reciben el código SMS al querer retirar".
- **Diagnóstico (logs):** el cache de #188 YA está deployado
  (`cache jugador=8000ms`) y las saturaciones cayeron ~4× (124/h el 14 → 34 el
  17 / 12 el 18). Pero SIGUE saturando el carril de PUBLICISTA (30/min), ahora
  dominado por el **status de reembolso** (`refund-weekly/monthly` = 28 de 40),
  no cacheado. Es ONEKEY, el publicista gigante (los agentes le crean usuarios
  sin parar en los logs). El SMS: **cero errores `[smsService]/[otpService]` →
  los SMS SE ENVÍAN bien a SNS; el problema es de ENTREGA de AWS** (típico:
  límite de gasto mensual de SMS de SNS → los descarta en silencio).
- **Fixes:**
  1. **Cache de `getPlayerStats`** (`GIROX_STATS_CACHE_MS`, default 90s) — el
     rango del status es un período CERRADO (netwin estable) → seguro. La
     RECLAMACIÓN de reembolso (paga plata) pasa `{fresh:true}`. Corta el
     saturador actual (refund-*).
  2. **Log de envío de SMS a stdout** (`[smsService] OK → SNS MessageId=...`,
     sin el teléfono) para confirmar envíos y separar "no se envió" de "no se
     entregó".
- **⚠️ ACCIONES OWNER:** (a) **ONEKEY a 180** en 1girox (es el mega-publicista;
  con eso + `GIROX_PUBLISHER_KEY_RPM=<keyOnekey>:90` se cierra la saturación
  que queda); (b) **AWS SNS → revisar el LÍMITE DE GASTO mensual de SMS** y las
  métricas de entrega (casi seguro es eso lo del código que no llega); subir el
  límite.
- **Validado:** `node --check` OK (giroxService.js, smsService.js, server.js).
  **Back necesita redeploy** (a PRODUCCIÓN — chat1girox.com).

### 190. `SSM_SKIP_KEYS`: un entorno CLON puede tener su propia DB/URL sin tocar el SSM compartido
- **Contexto:** el owner levantó un entorno CLON ("pruebapau",
  pautagirox.sa-east-1.elasticbeanstalk.com) para PROBAR sin riesgo, pero usa
  el MISMO `SSM_PATH=/nardo1girox/prod/` que producción. `loadSecrets`
  SOBREESCRIBÍA process.env con SSM (`process.env[key]=value`), así que cambiar
  MONGODB_URI/PUBLIC_BASE_URL como propiedad de entorno del clon NO servía (SSM
  las pisaba), y cambiarlas en el SSM compartido rompería producción.
- **Fix (aditivo, cero riesgo para prod):** `loadSecrets` respeta
  **`SSM_SKIP_KEYS`** (lista coma-separada): esas claves NO se sobreescriben
  desde SSM → el clon las setea como propiedad de entorno y quedan. Producción
  no define SSM_SKIP_KEYS → idéntico a antes.
- **⚠️ SETUP DEL CLON (para probar aislado, sin tocar clientes reales):** en el
  entorno CLON, propiedades de entorno: `SSM_SKIP_KEYS=MONGODB_URI,PUBLIC_BASE_URL`
  + `MONGODB_URI=<uri con una DB de TEST, ej. .../giroxnardo_test>` +
  `PUBLIC_BASE_URL=https://pautagirox.sa-east-1.elasticbeanstalk.com`. ⚠️ Las
  keys de girox siguen compartidas (SSM) → cargas/retiros de prueba pegan a la
  1girox REAL (mover plata real). Aislar la DB evita ensuciar usuarios/mensajes
  reales; para la plata, usar sandbox de girox o montos mínimos.
- **Validado:** `node --check` OK. Aplica al arrancar el clon.

### 189. Landing: sin cambio de clave forzado + casino a pantalla completa con burbuja de soporte
- **Pedido del owner (video):** (1) que al entrar por el link de la landing NO
  pida cambiar la clave obligatoriamente; (2) que la entrada se vea **tal cual
  1girox.com** (casino a pantalla completa, no el chat) con una **burbuja de
  soporte abajo a la derecha** que abra un chat con acciones (depositar,
  retirar, hablar con soporte, pedir CBU).
- **(1) Cambio de clave (server.js, `/api/auth/access-link`):** el canje ya no
  fuerza `mustChangePassword:true` para todos. Ahora lee `acquisitionSource`:
  las cuentas de la LANDING (`'landing'`) NO lo fuerzan (ya recibieron su
  usuario+clave en pantalla); las creadas por AGENTE (clave temporal) sí, como
  antes. El single-use del link sigue siendo atómico.
- **(2) Casino (ui.js, `_showCasinoFrame`):** se sacó la barra superior propia
  → el iframe del casino ocupa toda la pantalla (se ve como 1girox.com). Todo
  el chrome pasó a una **burbuja 🎧 flotante abajo a la derecha** que abre el
  bottom-sheet de soporte. Ese panel tiene: header con escapes (↗ Aparte / 🚪
  Salir / ⬇ Volver) + **4 acciones**: 💰 Depositar (despliega montos
  $2k/$5k/$10k/$20k/✅ Ya transferí) · 💸 Retirar · 📋 Pedir CBU · 🎧 Hablar
  con soporte. Mismo cableado que #183 (todo cae en el chat del cajero). El
  badge de no leídos se movió a la burbuja. Safe-area arriba y abajo para
  iPhone. **SW a v105.**
- **Validado:** `node --check` OK (server.js, ui.js). **Back necesita
  redeploy** (por el cambio del access-link); SW v105. PROBAR: entrar por la
  landing → NO pide cambiar clave → se ve el casino full-screen → burbuja 🎧
  abajo a la derecha → abre el chat con las 4 acciones → "Depositar" → $5.000
  → llega al cajero.


### 188. CAUSA RAÍZ del lag (por fin): poll de saldo cada 30s satura la key del publicista → cache + coalescing + poll 90s
- **Diagnóstico con los logs nuevos (16/8, ya con el espejo a stdout de #179):**
  las saturaciones del limitador local NO eran del master (90/min) ni de las
  consultas — eran a **30/min y sin la marca "key consultas"** → o sea el
  carril de las **keys de PUBLICISTA** (30/min). 98 de 124 saturaciones eran
  `getPlayer` (= `getUserInfoByName`, la lectura de saldo).
- **Por qué:** la PWA polleaba el saldo **cada 30s por cada usuario online**
  (`setInterval(syncBalance, 30000)` → `/api/balance/live`). Los jugadores de
  un publicista comparten UNA sola key (30/min), así que con ~15 usuarios de
  ese publicista online el carril ya se saturaba; publicistas grandes (onekey
  2905, DIGITAL 1156, martin 561) lo reventaban. Al saturarse, TODO lo de esos
  usuarios (ver saldo, acreditar bono, cargar, SSO) quedaba en cola hasta 30s.
- **Fix estructural (3 partes):**
  1. **Cache corto + coalescing** en `getUserInfoByName` (giroxService) — el
     punto por donde pasan TODAS las lecturas de saldo (getUserBalance la usa).
     Cache por username (TTL `GIROX_PLAYER_CACHE_MS`, default 8s) + dedupe de
     llamadas en vuelo → girox se consulta ~1 vez por usuario por ventana por
     más que N cosas pidan el saldo. Solo cachea ÉXITOS (nunca null/errores).
     Se **invalida** en cada operación de plata del usuario (deposit / withdraw
     / creditUserBalance-bonus / claimPendingBonus) → toda lectura post-cambio
     es fresca. El débito real lo sigue validando girox server-side (el cache
     es solo lectura/display).
  2. **Poll de saldo 30s → 90s** (public/js/ui.js). El saldo igual se refresca
     al instante por socket (`balance_updated`) en cargas/retiros/bonos y al
     cerrar el casino; el poll solo cubre cambios por juego mientras el cliente
     mira la PWA sin jugar. **SW a v104.**
  3. **Override de rpm por key de publicista** (`GIROX_PUBLISHER_KEY_RPM` =
     `pk_x:90,...`) — para cuando 1girox suba la key de un publicista grande a
     180 sin cambiar el techo del resto. El boot ahora loguea el cache y los
     overrides.
- **⚠️ ACCIÓN OWNER (fondo real para mega-publicistas):** pedirle a 1girox que
  suba las keys de los publicistas grandes (onekey, DIGITAL, martin) a 180
  como el master; después setear `GIROX_PUBLISHER_KEY_RPM=<susKeys>:90`. Sin
  eso, un publicista con 45+ usuarios online concurrentes puede seguir rozando
  el techo aun con el cache (el cache no baja la frecuencia del poll por
  debajo de 1/90s por usuario).
- **Revisión adversarial (sub-agente) — encontró y se CORRIGIÓ 1 bug crítico
  de plata + 2:**
  1. 🔴 La verificación anti-fantasma del retiro (`_deductChipsAtConfirm`)
     comparaba el saldo "antes" (que pasó a salir del cache, viejo) contra el
     "después" (fresco) → podía marcar un retiro real como fallido (cliente
     sin fichas Y sin plata) o cancelar uno válido por "saldo insuficiente".
     **Fix:** opción `getUserInfoByName(u, {fresh:true})` que saltea el cache;
     el "antes" y el "después" del retiro ahora son `fresh`.
  2. 🟠 Race: una lectura en vuelo cuando se acreditó/retiró podía escribir el
     saldo pre-operación DESPUÉS de la invalidación. **Fix:** timestamp de
     invalidación por usuario + `_maybeCachePlayer` no cachea si la lectura
     arrancó antes de la última invalidación. Verificado con test aislado.
  3. 🟡 Los 3 guards bono-sobre-bono (`/api/admin/bonus`, welcome code cash,
     notif-batch gift) leían bonusLocked/claimableTotal cacheados → ahora
     `fresh`. Las lecturas de DISPLAY (status de reembolso, poll) siguen
     cacheadas (es lo que se quería acelerar). + prune periódico de los Maps.
- **Validado:** `node --check` OK (server.js, giroxService.js, ui.js) + test
  aislado de la lógica del cache (TTL/race/fresh/coalescing, todo OK). **Back
  necesita redeploy**; SW v104. PROBAR: en el próximo pico, los logs no
  deberían mostrar `getPlayer ... saturado` en el carril de publicista con la
  frecuencia de antes; y un retiro normal debe descontar y confirmar bien.

## Sesión 2026-08-15

### 175. DIAGNÓSTICO del lag nocturno reportado por los agentes (13/8 ~22:00-23:30 ART) — cuello: RATE LIMIT de la API girox, NO Mongo
- **Reporte:** los agentes vieron los chats/operaciones muy lentos "en un
  momento de la noche"; después se normalizó solo.
- **Evidencia (logs EB de ambas instancias + métricas Atlas del owner):**
  - Pico récord de demanda 22:00-23:00 ART del 13/8: ~556 conexiones de
    clientes/hora y ~386 consultas de reembolso/hora (cada apertura de PWA
    = 2 netwin). Total girox muy por encima de los 60 req/min del contrato.
  - Cola local del cliente girox SATURADA en las DOS instancias: llamadas
    esperando hasta 30s (MAX_QUEUE_WAIT_MS) y fallas "La plataforma está
    saturada" (`rate_limited_local`) 23:00-23:26 ART: SSO, sync de
    contraseña y 2 batches del tick VIP.
  - Mongo DESCARTADO con métricas Atlas de esa franja: Operation Execution
    Times 1-4 ms, CPU <10%, IOPS ~40/s, tickets al máximo, conexiones
    planas. El M10 estuvo sobrado. Sin OOM/nginx/Redis en logs.
  - "Se solucionó solo" = bajó la demanda después de la medianoche (+ el
    restart del deploy de las 02:20 ART renovó procesos).
- **Causa estructural:** 2 instancias × GIROX_MAX_RPM=55 local = hasta 110
  req/min contra un límite GLOBAL de 60 → 429 + colas garantizados en cada
  pico nocturno (el comentario del propio giroxService lo anticipa).
- **⚠️ ACCIÓN OWNER pendiente:** subir `GIROX_MAX_RPM=30` en SSM
  `/nardo1girox/prod/` (2×30=60 exacto; aplica al próximo restart). Si EB
  escalara a N instancias, el valor correcto es ~60/N — por ahora capacidad
  fija en 2. Se le redactó además un mail al desarrollador de 1girox
  pidiendo subir el límite (ideal 180/min) y/o keys con cupo separado.
- **Mejora futura si persiste:** cachear unos minutos el status de
  reembolso (mayor consumidor de cupo girox en el pico).

### 187. FIX 500 (real) del alta por landing: `giroxService` no definido — el import es `girox`
- **Diagnóstico (debug temporal que exponía el error):** "Error del servidor:
  giroxService is not defined". `_deriveUniqueUsername` llamaba
  `giroxService.validateUsername(...)`, pero en server.js el cliente se importa
  como **`girox`** (copié el nombre de giroxPublisherKeys.js, que sí lo llama
  `giroxService`). `node --check` no lo agarra: es ReferenceError de runtime,
  no de sintaxis.
- **Fix:** `giroxService.validateUsername` → `girox.validateUsername`. Quitado
  el debug que exponía el error al cliente (el 500 vuelve a mensaje genérico;
  el detalle sigue yendo a stdout para EB).
- **Nota:** el 502 del panel que vio el owner fue el restart del deploy (EB
  rolling), transitorio — el ReferenceError estaba dentro del try del handler,
  no tira el proceso.
- **Validado:** `node --check` OK. **Back necesita redeploy.** PROBAR: landing
  → nombre → crea la cuenta y muestra usuario+clave.

### 186. FIX 500 del alta por landing: `acquisitionSource:'landing'` no estaba en el enum del schema
- **Síntoma (video del owner, landing viva en Vercel):** "CREAR MI CUENTA" →
  "Error del servidor. Probá de nuevo." La llamada LLEGABA al backend (el CORS
  abierto de #185 andaba), pero tiraba 500.
- **Causa:** `User.create` en `/api/landing/signup` seteaba
  `acquisitionSource:'landing'`, pero el enum del schema solo permitía
  `['organic','manual']` → Mongoose ValidationError → catch 500.
- **Fix:** `'landing'` agregado al enum de `acquisitionSource` (User.js) —
  además queda distinguible en las estadísticas de origen. Y el catch del
  endpoint ahora espeja el error+stack a **stdout** (`console.error`) para que
  los 500 se vean en los logs de EB (el logger winston va solo a archivo).
- **Validado:** `node --check` OK (server.js, User.js). **Back necesita
  redeploy.** PROBAR: landing de Vercel → nombre → ahora crea la cuenta y
  muestra usuario+clave.

### 185. `/api/landing/signup` con CORS abierto → landings rotables sin tocar ALLOWED_ORIGINS
- **Problema:** el CORS global bloquea todo origen fuera de ALLOWED_ORIGINS,
  así que cada dominio/host puente nuevo (Vercel, Cloudflare, dominio final)
  exigía editar SSM + redeploy. Inviable para rotar.
- **Fix:** un middleware previo al `cors()` global detecta `/api/landing/signup`
  y responde con `Access-Control-Allow-Origin` reflejando el origin (no `*`,
  sin Allow-Credentials — no usa cookies) y maneja el preflight OPTIONS. El
  resto de las rutas sigue con el CORS estricto de siempre. Seguro: el endpoint
  es público, sin credenciales, ya protegido por código de campaña + límite por
  IP. Ahora la landing funciona desde CUALQUIER host/dominio sin redeploy.
- **Validado:** `node --check` OK. **Back necesita redeploy** (una vez; después
  ya no hace falta por cada dominio nuevo).

### 184. Landing de conversión (bono + credenciales + popup) — clave de 6 dígitos mostrada al cliente
- **Contexto:** el owner vio una landing de un competidor (Bet33, en un dominio
  puente `walink.ac`) con el mismo funnel y pidió llevar la nuestra a ese nivel.
- **Backend (`/api/landing/signup`):** la password pasó de random-12 a **PIN
  de 6 dígitos** (`crypto.randomInt`, cumple el mínimo ≥6 de 1girox) y se
  **devuelve en la respuesta** (`password`) para mostrarla — así el cliente
  puede volver a entrar desde cualquier dispositivo, no solo por el link.
- **Landing (`landing/index.html`) rediseñada, marca 1GIROX:** banner de bono
  (BONUS_BIG/SUB configurables — ⚠️ deben ser la oferta REAL), pitch, form de
  nombre, sellos de confianza (acreditación al instante / retiros rápidos /
  soporte 24/7), legal +18. Al crear: pantalla de **credenciales** (usuario +
  clave grandes + "guardalos") con botón "ENTRAR A MI CUENTA" → accessUrl
  (logueado, sigue con `ir=casino` → abre el casino). **Popup de enganche**
  ("tu bono te espera") al intento de salida o a los 12s, una vez.
- **Validado:** `node --check` OK (server.js) + parseo HTML. **Back necesita
  redeploy.** Copia para preview en `~/Tor Browser/landing-1girox.html`.
  PROBAR: abrir con `?p=CODIGO` → nombre → ver usuario+clave → ENTRAR → cae en
  el casino logueado.

### 183. Entrada por landing → CASINO directo + menú de acciones rápidas en el pop-up de carga
- **Pedido del owner (sobre #182/#176):** que la entrada sea más automática —
  al poner el nombre que se abra el CASINO directo, con el chat de carga en un
  pop-up adentro, que igual llegue al panel adminprivado2026, con una serie de
  opciones para cargar directo. Opción elegida: **menú de acciones amplio**.
- **Casi todo reusa lo existente:** el alta por landing (#182), el pop-up
  "Cargar acá" dentro del casino y su chat al panel (#176), CBU/comprobante/
  saldo y hgcash ya estaban. Piezas nuevas, ambas front:
  1. **Landing → casino directo:** el `accessUrl` que devuelve
     `/api/landing/signup` lleva `&ir=casino`. `auth.js` lo lee en
     `tryAccessLink` (antes de limpiar la URL) y, tras `showChatScreen()` en
     `verifyToken`, abre el casino solo (`VIP.ui.enterCasino()`).
  2. **Menú de acciones en el pop-up (`ui.js`):** barra de chips arriba del
     chat del casino — 💰 Cargar (despliega montos $2k/$5k/$10k/$20k/Otro) ·
     📋 Pedir CBU · ✅ Ya transferí · 👛 Mi saldo · 💸 Retirar · 💬 Escribir.
     `VIP.ui.casinoQuickAction()` cablea cada uno a lo que YA existe: montos y
     retiro → mandan mensaje al cajero (`_casinoSendQuick` → messageInput +
     `VIP.chat.sendMessage`, cae en adminprivado2026); CBU → `loadAndShowCBU`;
     comprobante → click en `attachBtn`; saldo → `syncBalance` + mensaje.
     El cajero sigue viendo y confirmando todo (no es un bot).
- **El candado del retiro sigue igual:** "💸 Retirar" solo manda el mensaje; el
  SMS se exige recién al procesar el retiro real (`/api/withdrawal/request`).
- **Validado:** `node --check` OK (ui.js, auth.js, server.js). **SW a v103.**
  Back necesita redeploy (por el `&ir=casino`; el resto es front). PROBAR:
  entrar por la landing → se abre el casino logueado → "💬 Cargar acá" →
  tocar "💰 Cargar" → $5.000 → llega "Quiero cargar $5.000" al panel; "Pedir
  CBU" muestra el CBU; "Ya transferí" abre la cámara; "Retirar" → pide SMS al
  procesarlo.

### 182. ALTA POR LANDING externa (solo-nombre, sin SMS): endpoint `/api/landing/signup` + landing puente
- **Pedido del owner:** landing en un dominio PUENTE propio donde el visitante
  pone SOLO un nombre → se crea el usuario en 1girox atribuido a la pauta, se
  vincula a chat1girox y entra directo al chat con el agente para cargar y
  jugar. Anti-abuso decidido: NO se pide SMS al crear; el SMS se exige recién
  AL RETIRAR (y no se le avisa al cliente al principio).
- **Clave — casi todo ya existía:** el candado del retiro
  (`/api/withdrawal/request` ya rechaza sin `phoneVerified` →
  `PHONE_VERIFICATION_REQUIRED`), la verificación de teléfono para un usuario
  logueado (`/api/auth/verify-phone/send-otp` + `/confirm`), el link de acceso
  de un solo uso (`issueAccessLinkFor`) y la atribución de campaña YA estaban.
  Faltaba solo el alta solo-nombre pública (register-quick pide user+pass y
  está deshabilitado con 410).
- **Endpoint nuevo `POST /api/landing/signup`** (público, `landingIpLimiter`):
  nombre + campaignCode (+utm/fbc/fbp/landingUrl). Deriva un username 1girox
  válido y ÚNICO del nombre (base saneada sin acentos + sufijo aleatorio,
  reintenta ante colisión) y password aleatoria (el cliente nunca la tipea:
  entra por el link). Crea en 1girox PRIMERO — con la **key del publicista**
  si la campaña la tiene (si no, master), setea `giroxOwnerCampaign` — y si
  falla NO deja cuenta local huérfana. Luego crea la cuenta local
  `phoneVerified:false` + CAPI/fb-ads CompleteRegistration, y devuelve
  `accessUrl` (link de un solo uso a chat1girox). La landing redirige ahí →
  cliente logueado.
- **Anti-abuso:** límite por IP (`LANDING_SIGNUP_MAX_PER_IP_HOUR`, default 8)
  para que un bot no queme el cupo de la API de 1girox; kill-switch
  `LANDING_SIGNUP_DISABLED=true`; hook opcional de captcha dejado documentado.
- **Landing puente:** `landing/index.html` (archivo suelto, va en el dominio
  puente, NO en public/). Nombre + botón + aviso 18+; toma el código de
  `?p=`/`?campaign=`/path; postea al endpoint y salta al accessUrl. Constantes
  `API_BASE` y `CAMPAIGN_CODE` a completar arriba del script.
- **⚠️ ACCIÓN OWNER:** (1) subir `landing/index.html` al dominio puente con
  `API_BASE=https://chat1girox.com`; (2) agregar ese dominio a
  `ALLOWED_ORIGINS` en SSM (si no, CORS bloquea); (3) redeploy del back.
  ⚠️ La landing debe mostrar la MISMA oferta real que ve el usuario — mostrarle
  a Meta algo distinto es cloaking (baneo de dominio+pixel+cuenta).
- **Validado:** `node --check` OK (server.js) + parseo del HTML. **Back
  necesita redeploy.** PROBAR: abrir la landing con `?p=UNCODIGO` → poné un
  nombre → cae logueado en chat1girox y puede cargar; pedir un retiro → pide
  SMS; en 1girox el jugador aparece bajo el sub-agente correcto si la campaña
  es de publicista.

### 181. Techo propio para keys de PUBLICISTA (no heredan más GIROX_MAX_RPM)
- **Contexto:** con la master en 180 (GIROX_MAX_RPM=90) las keys de
  publicista heredaban ese 90 — pero en la plataforma siguen en 60.
- **Fix:** constante `PUBLISHER_MAX_RPM` (env `GIROX_PUBLISHER_MAX_RPM`,
  default **30** = 60÷2 instancias) para toda key que no sea master ni de
  consultas. La radiografía de boot ahora también la muestra
  ("· publicistas=30 (default)/min").
- **Config final del owner (2026-08-15, ya cargada en SSM):** master 180 →
  `GIROX_MAX_RPM=90`; consultas `pk_...:30,pk_...:30` (siguen en 60);
  publicistas default 30. Total 300 req/min contra la plataforma (~8× el
  pico real que causó el lag). **Back necesita redeploy** (o ya incluido en
  el deploy que cargue esto).
- **Validado:** `node --check` OK (giroxService.js, server.js).

### 180. Techo de rate limit POR KEY con sufijo `:rpm` (1girox subió a 180 solo ALGUNAS keys)
- **Dato del owner:** la plataforma subió el límite a 180/min pero solo en
  algunas API keys — un `GIROX_MAX_RPM` parejo ya no sirve (90 haría 429 en
  las keys que siguen en 60; 30 desperdicia las de 180).
- **Código (giroxService):** cada entrada de `GIROX_API_KEY_CONSULTAS`
  acepta sufijo `:rpm` con su techo POR INSTANCIA (mismo criterio que
  GIROX_MAX_RPM = límite de esa key ÷ N instancias). Ej. 2 instancias, una
  key de 180 y una de 60: `pk_aaa:90,pk_bbb:30`. Sin sufijo → GIROX_MAX_RPM
  (que sigue siendo el techo de master y publicistas). El balanceador ahora
  elige por LUGAR LIBRE (techo − usado): la key de 180 absorbe
  proporcionalmente más. El log de saturación y la radiografía de boot
  muestran el techo real por key ("keys consultas cargadas: 2 (techos 90,
  30/min)").
- **⚠️ ACCIÓN OWNER:** averiguar CUÁLES keys quedaron en 180 (panel girox o
  soporte) y ajustar SSM con la regla techo = límite÷2: consultas con
  sufijo por key; si la MASTER quedó en 180 → GIROX_MAX_RPM=90 (los
  publicistas comparten ese default, pero su tráfico es mínimo, sin riesgo
  real). Redeploy y verificar la línea `[girox] config:` del boot.
- **Validado:** `node --check` OK + parseo probado standalone (sufijo
  inválido cae al default). **Back necesita redeploy.**

### 179. Lag nocturno OTRA VEZ (madrugada 15/8, post-deploy con keys) + los logs girox eran INVISIBLES → espejo a stdout + radiografía al boot
- **Reporte:** owner deployó (~03:05-03:24 UTC) con las keys de consultas
  configuradas, y a las 04:15-04:36 UTC (01:15-01:36 ART) volvió el lag:
  fallas "plataforma saturada" en SSO, auto-claim de bonus, sync de
  contraseña Y TAMBIÉN el batch VIP (que debería ir por las keys nuevas).
- **Hallazgo clave del diagnóstico:** `giroxService` loguea con el winston
  de `src/utils/logger.js`, que en producción escribe SOLO a archivos
  locales (`logs/*.log`) — NO a stdout → los warns del limitador (qué carril
  se saturó, si dice "key consultas"), los reintentos y los 429 reales NUNCA
  aparecieron en web.stdout.log. Imposible confirmar desde los logs de EB si
  las keys de consultas cargaron o qué carril se llenó.
- **Hipótesis principal (a confirmar con el próximo boot):** las keys de
  consultas NO cargaron (nombre/formato del parámetro SSM) y además
  `GIROX_MAX_RPM=30` achicó el carril único a la mitad → peor que antes.
- **Fix de visibilidad (este commit):**
  1. giroxService: warn/error se ESPEJAN a consola (web.stdout.log los
     captura) además del archivo winston.
  2. Log de arranque en el bootstrap: `[girox] config: key master OK · keys
     consultas cargadas: N · GIROX_MAX_RPM=X` → el próximo deploy dice al
     toque si la config real es la esperada.
- **⚠️ ACCIÓN OWNER:** verificar en CloudShell el parámetro
  `/nardo1girox/prod/GIROX_API_KEY_CONSULTAS` (nombre EXACTO, keys separadas
  por coma, SecureString) y `GIROX_MAX_RPM=30`; redeploy; mirar en el log de
  arranque "keys consultas cargadas: 2". Si el lag vuelve, los logs ahora
  van a decir qué carril se saturó ("key consultas" o master).
- **Validado:** `node --check` OK (giroxService.js, server.js). **Back
  necesita redeploy.**

### 178. Pulido del chat sobre el casino (5 reclamos del owner con capturas, sobre #176)
1. **Falso "¿El casino no termina de cargar?":** el aviso salía a los 15s
   TAPANDO el casino ya funcionando (el watchdog no se cancelaba nunca).
   Ahora el `load` del iframe lo cancela; para el caso raro de app colgada
   por cookies bloqueadas queda el "↗ Abrir aparte" fijo de la barra.
2. **Barra superior en UNA línea:** en celu los 3 botones se apilaban.
   Ahora: "🎰" (sin la palabra CASINO) + "💬 Cargar acá" + "↗ Abrir aparte"
   + "← Volver" (antes "← Volver a Chat de cargas"), font 12px, sin wrap,
   con scroll horizontal de fallback si el ancho no da.
3. **"No se puede bajar del todo" en el panel:** el piso `min-height:170px`
   de `.chat-container` empujaba la barra de escribir fuera del panel. Al
   montar se pisa con `min-height:0` (se restaura al desmontar) y el scroll
   al fondo va tras `requestAnimationFrame` (layout ya reacomodado).
4. **Panel 20% más bajo:** 62% → **50%** de alto (tapaba mucho juego).
5. **Más mensajes a la vista:** dentro del panel se OCULTA la cabecera
   "Cargas 1Girox" (avatar/en línea/🌙/🔔/🔥) — el panel ya tiene título
   propio — y ese título pasa de "Chat de cargas" a **"💬 Chat rápido"**.
   Al volver a la página, la cabecera reaparece intacta.
- **Validado:** `node --check` OK (ui.js, SW). **SW a v102.** Solo front.
  PROBAR: casino cargado → NO aparece más el aviso de "no termina de
  cargar"; barra en 1 línea en celu; abrir Chat rápido → se ve título,
  mensajes hasta el último y barra de escribir completa, mitad del juego
  visible; cerrar y volver a la página → chat normal con su cabecera.

### 177. SEGUNDA API KEY de girox para consultas (el límite es POR KEY) + limitador local por key
- **Contexto:** ante el pedido del #175, soporte de 1girox respondió: el
  límite de 60/min es POR KEY (no por cuenta), se puede crear otra key desde
  el panel para separar operaciones de consultas, y "en breves" lo suben a
  180/min.
- **Código (giroxService.js):**
  1. Env opcional **`GIROX_API_KEY_CONSULTAS`** — UNA o VARIAS keys separadas
     por coma (pedido del owner: blindar el crecimiento; pool balanceado, cada
     lectura sale por la key con más lugar en su ventana → N keys = N×60/min
     de cupo de lectura). Si está, `getPlayerStats` y `getPlayersStatsBatch`
     (netwin → reembolsos, VIP, referidos, datos) que irían por la MASTER
     firman con una del pool (flag `readOnly` en `_request` +
     `_pickReadsKey`). Las keys de publicista no se tocan (cada una es la
     única que ve a sus jugadores). Sin la env → todo por la master como
     siempre (deploy seguro antes de crear las keys).
  2. Limitador local ahora **por key** (`_laneTimestamps` Map): consultas y
     publicistas ya no le comen cupo local a la master (antes una sola
     ventana compartida — con límite por key era regalar capacidad).
- **SSM:** `GetParametersByPath` levanta la var nueva solo; nada que tocar.
- **⚠️ ACCIÓN OWNER (2 pasos):** (1) crear 1-2 keys extra en
  admin.1girox.com — DEBEN ser del MISMO agente que la master, si no no ven
  a los jugadores —, (2) subirlas a SSM
  `/nardo1girox/prod/GIROX_API_KEY_CONSULTAS` (varias = separadas por coma,
  ej. `pk_aaa,pk_bbb`) + poner `GIROX_MAX_RPM=30` (2 instancias × 30 = 60
  por key). Cuando 1girox suba el límite a 180: cambiar a 90. Aplica al
  próximo restart/deploy. Dimensión hoy: el pico real de lecturas fue
  ~15-20 req/min → UNA key de consultas alcanza y sobra; con 2 en el pool
  queda cubierto hasta ~6× el volumen actual (y ~18× cuando suban a 180).
- **Validado:** `node --check` OK. ARCHITECTURE §4.3 actualizado. **Back
  necesita redeploy.** PROBAR post-deploy con la key puesta: abrir la PWA
  (status de reembolso usa netwin) → funciona igual; en un pico, los logs ya
  no deberían mostrar "saturada" en SSO/cargas aunque las stats estén a
  full.

### 176. Botón "💬 Cargar acá" en el casino: el chat de cargas REAL en un panel sobre el juego
- **Pedido del owner:** que el jugador pueda cargar SIN salir del casino,
  con el mismo chat de la pantalla anterior, y que al agente le llegue por
  la misma bandeja de siempre.
- **Cómo:** el casino es un overlay nuestro sobre la PWA, así que el chat
  sigue vivo abajo (mismo socket). El botón nuevo "💬 Cargar acá" (barra del
  casino) abre un panel de 62% de alto sobre el juego (`#casinoChatDrawer`)
  y MUDA los nodos reales `.chat-container` + `.chat-input-container`
  adentro (appendChild conserva ids/listeners/socket → es EL MISMO chat, no
  una copia; cero cambios de backend ni de panel admin). "⬇ Volver al
  juego" (o salir del casino) los devuelve a su lugar exacto con
  marcadores. El juego sigue corriendo detrás (iframe intacto).
- **Badge de no leídos:** MutationObserver sobre `#chatMessages` cuenta lo
  que llega con el panel cerrado y pinta un badge rojo (1..9+) en el botón;
  se resetea al abrir. Sin tocar chat.js.
- **Safe-area iPhone:** el panel llega al borde físico y compensa con
  padding interno (mismo criterio que #172).
- **Validado:** `node --check` OK (ui.js, SW). **SW a v101.** Solo front
  (deploy de estáticos). PROBAR: entrar al casino → "💬 Cargar acá" abre el
  chat con el juego sonando atrás → mandar "quiero cargar 5000" → responde
  el agente (misma bandeja) y el cliente lo ve; "⬇ Volver al juego" y de
  vuelta al chat de la página al salir del casino; mensaje entrante con el
  panel cerrado → badge rojo en el botón.

## Sesión 2026-08-14

> ✅ **DEPLOYADO:** el owner confirmó (2026-08-14) que TODO lo de esta sesión
> (#172–#174) ya está deployado en AWS EB. Con ese deploy también quedan
> cumplidos los redeploys pendientes de la sesión anterior (#167, #169–#171).

### 172. FIX iPhone PWA: overlay del casino respetaba el safe-area (barra bajo el reloj + franja blanca)
- **Reclamo del owner (captura):** en iPhone, SOLO con la app instalada (PWA
  standalone), los botones "↗ Abrir aparte / ← Volver a Chat de cargas" del
  casino quedaban pegados arriba abajo del reloj/status bar, y aparecía una
  franja blanca abajo. En navegador funcionaba bien.
- **Causa:** la PWA usa `viewport-fit=cover` + status bar `black-translucent`
  (index.html) → en standalone el viewport ocupa TAMBIÉN la zona del notch y
  del home indicator. Todo el front compensa con `env(safe-area-inset-*)` en
  CSS, pero el overlay del casino se arma por JS (`VIP.ui._showCasinoFrame`,
  ui.js) con estilos inline SIN safe-area: barra con `padding:8px` fijo (bajo
  el reloj) e iframe hasta el borde físico inferior — la franja blanca era el
  fondo del casino embebido asomando en la zona del home indicator.
- **Fix (ui.js, solo estilos inline del overlay):** barra superior con
  `padding-top:calc(8px + env(safe-area-inset-top,0px))`; overlay con
  `padding-bottom:env(safe-area-inset-bottom,0px)` (fondo #0d0d1a → la zona
  del home indicator queda oscura y el iframe termina antes). En navegador
  los env() valen 0 → cero cambio.
- **Validado:** `node --check` OK (ui.js, SW). **SW a v99.** Solo front: se
  actualiza con el SW, sin redeploy de back (aunque subir los estáticos
  requiere deploy en EB igual). PROBAR en iPhone con la app instalada: abrir
  el casino → la barra dorada arranca DEBAJO del reloj y no hay franja blanca
  abajo; en Safari normal sigue igual que antes.

### 173. Marca: textos visibles que aún decían "VIPCARGAS" → "1GIROX"
- **Reclamo del owner (captura del modal "Información del Servicio"):** decía
  "beneficios de jugar en VIPCARGAS".
- **Cambiados (los 5 visibles al cliente):** subtítulo de Información del
  Servicio, banner "✨ Bienvenido a…" de campañas, modales "BIENVENIDO A…" y
  "BENEFICIOS DE JUGAR EN…" (index.html) y botón "Volver a…" del recuadro de
  error del casino (ui.js). **SW a v100.** Solo front.
- **⚠️ Sigue pendiente (decisión de marca, ya señalado en #151):** los SMS de
  OTP (`otpService.js`) todavía dicen "VIPCARGAS: codigo... vipcargas .com".
  También puede haber COMANDOS guardados en la base que mencionen vipcargas
  (la migración de #151 los loguea al arrancar, revisar sección COMANDOS).

### 174. El error "bono activo" de la Bonificación ahora DICE LOS MONTOS (diagnóstico para el agente)
- **Duda del owner:** al querer dar una Bonificación a un cliente SIN saldo,
  rebotaba con "ya tiene un bono ACTIVO" y no se entendía por qué (terminó
  cargando desde el panel de 1girox directo — ⚠️ justo lo que el candado
  evita: si el cliente tenía bono activo, dárselo desde allá se lo pisa).
- **Explicación (no era bug):** el bono NO es saldo. Un cliente con $0 puede
  tener (a) un resto de bono con rollover en curso — el guard salta con
  CUALQUIER valor > 0, aunque sean centavos — o (b) un "regalito" sin
  reclamar en el casino (p. ej. un auto-claim que falló y quedó colgado),
  que no se ve en ningún saldo del panel.
- **Fix (server.js, guard de `/api/admin/bonus`):** el error ahora detalla
  los montos: "$X de bono con rollover en curso y $Y de bono SIN RECLAMAR
  (el regalito del casino)" — el agente sabe al toque cuál de los dos casos
  es y qué decirle al cliente (terminarlo o reclamarlo).
- **Decisión del owner (mismo día):** NO auto-reclamar el regalito (queda
  solo el aviso con montos) + **piso de $50**: si el total entre rollover en
  curso y sin reclamar es ≤ $50, la bonificación SALE igual (el vuelto chico
  se pisa — preferible a rebotarle la operación al agente). Constante
  `BONUS_GUARD_MIN_ARS` en el guard de `/api/admin/bonus`. Los otros guards
  (welcome code cash, lotes) siguen estrictos en > $0.
- **Validado:** `node --check` OK. **Back necesita redeploy.** PROBAR:
  intentar Bonificación a un cliente con bono pendiente grande → toast rojo
  con los montos; con un resto ≤ $50 → la bonificación sale normal.

## Sesión 2026-08-10

> ✅ **DEPLOYADO:** el owner confirmó (2026-08-10, fin del día) que TODO lo de
> esta sesión (#158–#166) ya está deployado en AWS EB. Los "Back necesita
> redeploy" de las entradas de abajo quedan cumplidos. Con ese restart también
> tomó efecto `HGCASH_FANOUT_URL=off` (SSM, #158). ⚠️ #167 es POSTERIOR a ese
> deploy: necesita un redeploy más.

### 171. CÓDIGO PÚBLICO para Telegram/redes (canjeable por CUALQUIER cliente, con cupo opcional)
- **Pedido del owner:** que el regalo por código (monto o %) pueda ser un
  código creado para subir a la Comunidad de Telegram u otras redes (algo
  externo, sin lote de destinatarios), con la misma mecánica. También aclaró:
  los topes anti-abuso son POR USUARIO (confirmado, así estaba) y los dos
  comportamientos de fichas quedan: por tiempo = todos automático; por
  código = solo los que canjean.
- **Modelo:** `NotifBatch.isPublic` + `maxClaims` (cupo total de canjes,
  null = sin cupo); `audienceType` suma 'public'.
- **Create (`audienceType:'public'`):** solo modo code; mensaje opcional (no
  se envía NADA — `sendDone:true`, recipients vacío); cupo 1..100.000
  opcional. El código se sube a mano a Telegram/redes.
- **Canje:** cualquier `role:'user'` puede canjear UNA vez: el usuario se
  APPENDEA a recipients con update atómico (filtro "no está ya" + cupo por
  `$expr $size` + vigencia; los updates por doc se serializan en Mongo → sin
  dobles por carrera). Fichas → misma acreditación automática con topes
  anti-abuso y rollover; si el crédito falla, se lo saca con `$pull`
  (no consume cupo y puede reintentar). % → PromoBonus/cartel verde. Código
  público vencido responde "venció" (no "no válido").
- **Panel:** audiencia nueva "📣 Código PÚBLICO (para Telegram/redes)" —
  oculta destinatarios/modo ventana, muestra cupo, no exige mensaje; confirm
  especial (fichas sin cupo → "SIN CUPO TOTAL — pensalo bien"); resultado
  muestra el código listo para copiar; historial "📣 código público · N
  canjes de M" y el detalle lista a los que canjearon. Guía ❓ actualizada.
  admin-sw **v38**. **Back necesita redeploy.** PROBAR: crear código público
  de fichas con cupo 2 → canjear desde 2 cuentas OK, la 3ª "llegó a su
  límite"; canjear 2 veces desde la misma → "una sola vez"; % público →
  cartel verde.

### 170. FICHAS SIEMPRE automáticas (también por tiempo) + TOPES anti-abuso con ALERTA URGENTE
- **Pedido del owner (sobre #169):** todo lo que sea acreditar fichas,
  automático (para que el agente no pierda tiempo con tantos chats) — pero
  "que no sea un descontrol": si alguien encuentra un bug y farmea fichas,
  que salte un aviso URGENTE.
- **Fichas por TIEMPO = acreditación automática AL ENVIAR:** el motor
  acredita a cada destinatario del lote (helper único `_creditNotifBatchGift`
  compartido con el canje por código). Sin PromoBonus/cartel para fichas: el
  cliente recibe "💰 Te ACREDITAMOS $X" y el agente no interviene. El confirm
  del panel avisa en grande el gasto TOTAL (monto × destinatarios) antes de
  enviar. El % sigue igual (cartel verde, ambos modos).
- **Candados anti-abuso (en TODA acreditación de lote):**
  1. Topes duros por usuario, cruzando TODOS los lotes (Transaction
     source 'notif_batch', permanente): máx **3 acreditaciones en 24hs** y
     máx **$300.000 en 7 días** (constantes NOTIF_BATCH_USER_MAX_*).
  2. Superar un tope BLOQUEA el crédito y dispara **alerta urgente**:
     log ERROR `[notif-batch][ALERTA]`, nota roja admin-only en el chat del
     usuario, y socket `security_alert` a la sala admins → **toast rojo en
     vivo** en todos los paneles conectados (listener nuevo en admin.js).
  3. Guard bono-sobre-bono (no se acredita si tiene bono activo en el casino
     — lo pisaría) y reference idempotente `vip-nbatch-{batchId}-{userId}`
     (jamás doble pago, ni en reintentos ni entre instancias).
  4. Todo lo NO acreditado queda visible en el detalle del lote
     ("⚠ sin acreditar: <motivo>", campo recipients[].creditError).
- **Resiliencia:** fallo transitorio de la API (girox caído) → el recipient
  queda EN 'sending' y el motor lo reintenta solo a los 10 min (sin doble
  pago por la reference fija); bloqueo definitivo → sin mensaje ni push (no
  se le promete nada), registrado. Rollover ahora se valida contra
  bonus.multipliers para fichas en CUALQUIER modo.
- **⚠️ Nota de rate limit:** un lote de fichas por tiempo hace ~3 requests a
  girox por destinatario (info + credit + claim) paseadas por el limitador
  local (55 rpm) — un lote de 300 tarda ~15-20 min en completar en segundo
  plano. Normal, no es un cuelgue (se ve el progreso en el historial).
- **Validado:** `node --check` OK (server.js, NotifBatch.js, admin.js,
  admin-sw v37). **Back necesita redeploy.** PROBAR: (1) lote fichas POR
  TIEMPO a 2 cuentas de prueba → confirm muestra el total → saldo acreditado
  solo + mensaje "Te ACREDITAMOS"; (2) mandarle 4 lotes seguidos a la misma
  cuenta → el 4° crédito se bloquea y salta el toast rojo + nota en su chat;
  (3) % por tiempo → cartel verde como siempre.

### 169. Regalo de FICHAS por código: acreditación AUTOMÁTICA como bono (rollover x0 configurable por lote)
- **Pedido del owner:** el regalo de fichas (giftType fixed) canjeado con
  CÓDIGO se acredita SOLO (bono girox, rollover x0 default, modificable
  desde el panel); el % en próxima carga sigue con cartel verde + marcar
  usado. Modo POR TIEMPO no cambia (fichas y % van con cartel del agente —
  auto-acreditar a todo un lote sin acción del cliente sería regalar plata
  masiva con un click; si algún día se quiere, es un cambio chico).
- **Modelo:** `NotifBatch.rolloverX` (default 0) + `recipients[].creditedAt`
  / `creditTxId`.
- **Create:** acepta `rolloverX` (fixed): rango 0-50 y validado contra
  `bonus.multipliers` de 1girox (mismo criterio que el welcome code #143 —
  el canje nunca falla en la cara del cliente por un multiplier inválido).
- **Canje (fichas+código), espejo del welcome code cash (#148):** guard
  bono-sobre-bono ANTES de la reserva (bonusLocked/claimableTotal → rechazo
  sin quemar el canje; si no se puede leer la cuenta → 503 reintentable);
  reserva atómica; `creditUserBalance` con multiplier=rolloverX y reference
  estable **`vip-nbatch-{batchId}-{userId}`** (reintento tras fallo falso →
  duplicate:true, jamás doble pago; si el crédito falla se libera la reserva
  y puede reintentar); auto-claim v1.7 (`claimPendingBonus`); Transaction
  type bonus `metadata.source:'notif_batch'`; mensaje al cliente "ya está
  ACREDITADO" (+ nota de rollover si >0) y nota admin-only "no hay que hacer
  nada". Respuesta status 'credited' → la PWA muestra la tarjeta verde y
  refresca el saldo (render existente, sin cambios de PWA).
- **Panel:** input "🎯 Rollover (x)" visible solo con Fichas+Código; el
  confirm del envío avisa "⚠️ la plata se acredita AUTOMÁTICAMENTE al
  canjear"; el detalle del lote muestra "💰 acreditado automático"; guía ❓ y
  textos actualizados con la regla nueva de quién pone la plata. admin-sw
  **v36**. **Back necesita redeploy.** PROBAR: lote fichas+código con
  rollover 0 → canjear → saldo acreditado al toque y nota al agente; con
  rollover inválido (ej. 3 si la config permite [0,2,5,10,20,40]) → el
  guardado del lote lo rechaza con la lista; lote % → cartel verde como
  siempre.

### 168. Botón "❓ Cómo funciona" en la card "🎁 Lote con regalo"
- Guía completa para agentes desplegable en la card (misma mecánica que los
  ❓ de Datos/Datos 2.0): qué es un lote, la regla de oro ("el regalo NUNCA
  se acredita solo"), tipos de regalo, modo código vs por tiempo, audiencias,
  validar lista (📱/🌐/🔕), el cartel verde y el flujo del cajero, historial,
  y respuestas rápidas para clientes. Solo HTML estático con toggle inline.
  admin-sw **v35**. Solo front: recargar panel.

### 167. Paginador de Cerrados con NÚMEROS (de a 6) + salto directo por N° (sobre #165)
- **Pedido del owner:** con muchas páginas (ej. 48) avanzar de a 1 es lento;
  que haya números de a 6 o poder escribir el número. El reset a página 1 al
  salir y volver a Cerrados QUEDA así a propósito (lo confirmó).
- **Backend:** la respuesta de closed suma `totalPages`
  (`countDocuments` sobre el match de 48hs — usa el índice
  `{status, lastMessageAt}`, barato).
- **Panel:** el paginador ahora es `‹ [21][22][23][24][25][26] › [N°] Página
  23 de 48 · últimas 48hs` — ventana de 6 números centrada en la actual
  (con ≤6 páginas se ven todas), botón activo resaltado en dorado, y un
  input para escribir el número y saltar con Enter (`closedChatsGoTo`, con
  clamp 1..total). Si el total baja (chats saliendo de la ventana de 48hs)
  y quedaste más allá de la última página, se reacomoda solo. admin-sw
  **v34**. **Back necesita redeploy** + recargar panel. PROBAR: Cerrados →
  números visibles, saltar con un número escrito + Enter, ‹ › siguen
  funcionando.

### 166. CASO ASENTADO: loop "requiere Chrome" al abrir la app en algunos Android (WebAPK) — NO es bug nuestro
- **Reporte (agente admin, con video):** en algunos teléfonos, al abrir la app
  instalada aparece "CARGAS 1GIROX requiere la siguiente app: Chrome
  [CERRAR/INSTALAR]"; INSTALAR lleva al Play Store donde Chrome figura YA
  instalado (botones Desinstalar/Abrir); Abrir vuelve a la app y el cartel
  reaparece — loop. El agente confirmó que **desinstalar la app y volver a
  instalarla lo arregla**.
- **Diagnóstico:** ese cartel es un **diálogo del SISTEMA Android**, no
  nuestro. La PWA instalada desde Chrome se empaqueta como **WebAPK** atado a
  Chrome como navegador anfitrión; si ese vínculo queda roto/desactualizado
  (Chrome deshabilitado al momento de instalar, update de Chrome corrupto,
  etc.), el shell no puede arrancar y Android muestra ese diálogo ANTES de
  que corra ni una línea nuestra — por eso no hay nada que parchear del lado
  del código. Verificado además que nuestro botón "Instalar App"
  (VIP.ui.installApp, public/js/ui.js) jamás linkea al Play Store: usa
  deferredPrompt o instrucciones manuales.
- **Solución para soporte (script para agentes):** 1) desinstalar la app,
  2) abrir CHROME (no otro navegador), 3) actualizar Chrome desde el Play
  Store si tiene update pendiente, 4) entrar a la página y reinstalar desde
  el menú ☰ → "Instalar App". Alternativa sin reinstalar: actualizar/habilitar
  Chrome y reiniciar el teléfono. Se le sugirió al owner crear un COMANDO
  desde el panel con este texto para responder al toque.
- Afecta solo a ALGUNOS Android (vínculo WebAPK↔Chrome del dispositivo);
  nada que deployar.

### 165. Cerrados PAGINADO de a 100 (sobre #164, pedido del owner)
- En vez de traer hasta 500 filas de una (cientos de KB), la pestaña Cerrados
  ahora carga **de a 100** con botones **"‹ Más nuevos / Más viejos ›"** y
  label "Página N · últimas 48hs" — siempre dentro de la ventana de 48hs.
- **Backend:** `?page=N` (1-50) solo para closed; pide 101 filas para saber
  `hasMore` sin count extra; skip/limit sobre el índice
  `{status, lastMessageAt}`. Respuesta suma `page` y `hasMore`.
- **Panel:** paginador arriba de la lista (visible solo en Cerrados);
  `closedChatsPage` se resetea al cambiar de pestaña; el cache de 30s por
  pestaña guarda SOLO la página 1 (helper `_setTabCache` reemplaza los 4
  sets directos — las páginas viejas no pisan el cache ni lo usan). admin-sw
  **v33**. **Back necesita redeploy** + recargar panel. PROBAR: Cerrados →
  100 filas + "Más viejos ›" pasa de página; volver a Abiertos y regresar →
  arranca en página 1.

### 164. Pestaña CERRADOS del chat: ahora muestra las últimas 48 HORAS (antes top 100)
- **Pedido del owner:** ver las últimas 48hs de chats para auditar la
  atención de chats viejos; preguntó si afecta la velocidad.
- **Causa de que "desaparecieran":** `/api/admin/conversations` traía el TOP
  100 por actividad de cada pestaña — con el volumen actual, en Cerrados eso
  cubría solo unas horas. No era un corte por tiempo ni el TTL de mensajes.
- **Fix:** solo para `status='closed'`: `lastMessageAt >= ahora-48h`, tope de
  sanidad 500. Abiertos/pagos/comunidad SIN cambios (un chat abierto viejo es
  trabajo pendiente y debe aparecer siempre, como hasta ahora). Los mensajes
  viven 72h (TTL) así que las 48hs siempre tienen su historial completo.
- **Performance:** sin impacto real — la query usa el índice compuesto
  existente `{status, lastMessageAt}` de ChatStatus; solo crece la respuesta
  de la pestaña Cerrados (hasta 500 filas) y su render, con cache de 30s por
  pestaña en el panel. Solo back: **necesita redeploy**. PROBAR: pestaña
  Cerrados → aparecen los cerrados de ayer y anteayer; Abiertos igual que
  siempre.

### 163. Botón "❓ Cómo leer esta hoja" en Datos y Datos 2.0
- **Pedido del owner:** dejar la explicación de qué muestra cada hoja (escrita
  para que el admin principal se la explique a cajeros/empleados) como un
  botón dentro del panel.
- Botón "❓ Cómo leer esta hoja" en el header de AMBAS secciones → despliega
  un recuadro celeste con la explicación en criollo: Datos = "la foto del día"
  (qué mide cada bloque y qué NO te dice); Datos 2.0 = "la película de cada
  camada" (qué significa cada columna, el "—", el $/nuevo vs costo de pauta,
  la regla práctica de uso y un ejemplo concreto lunes→viernes). Solo HTML
  estático con toggle inline — sin JS nuevo. admin-sw **v32**. Solo front:
  recargar el panel.

### 162. DATOS 2.0 — retención por COHORTES (camadas diarias) + rendimiento de la pauta por campaña
- **Pedido del owner:** % de gente que cargó más de 3 veces con historial día
  a día ("en 10 días ver qué retención dejó"), seguimiento a 1/3/7 días, etc;
  y una hoja nueva "Datos 2.0" con lo que recomiende para analizar el
  rendimiento de la pauta (gastan a diario, entra gente nueva todo el tiempo,
  algunos se quedan, otros se van o vuelven a los días/semanas).
- **Concepto (distinto del recuadro Datos, que mira el PERÍODO):** cada día es
  una **cohorte/camada** = los usuarios que SE REGISTRARON ese día, y se la
  sigue en el tiempo. La retención Dx se define como "su ÚLTIMA carga real fue
  ≥ x días después del registro" — capta también a los que se van y VUELVEN.
  Una cohorte solo es "elegible" para Dx cuando ya cumplió x días (si no, la
  celda muestra "—", nunca un % falso bajo).
- **Endpoint nuevo `GET /api/admin/datos2?days=7..90`** (default 30; mismo
  gate que /datos: cualquier rol de staff). Por cohorte (día ART, UTC-3 fijo
  como el resto): nuevos (desglose 📣 pauta = acquisitionCampaign / 🧑‍💼
  agente = createdByEmployeeId / 🌱 orgánico), % cargó ≥1/≥2/**≥3** veces,
  cargas promedio por depositante, días distintos con carga, $ depositado y
  **$/nuevo** (para comparar contra el costo por registro de la pauta),
  retención D1/D3/D7/D14/D30. "Carga real" = type:'deposit' sin
  payout_refund (mismo criterio que /datos e ingresos diarios). Además:
  **resumen** (totales + headline pedido: % de 3+ cargas promediado sobre las
  camadas de los últimos 10 días) y **breakdown por campaña** (con publisher
  de Campaign; buckets CREADOS POR AGENTE y ORGÁNICO/DIRECTO aparte).
- **Panel:** nav nuevo **"📊 Datos 2.0"** (después de Datos) con: explicación
  en criollo arriba, selector 10/14/30/60/90 días, 4 cards resumen (nuevos
  con desglose, % cargó, **% 3+ últimos 10 días**, $ depositado y $/nuevo),
  tabla "📅 Camada por camada" (Día | Nuevos 📣/🧑‍💼/🌱 | ≥1 | ≥2 | ≥3 |
  cargas prom | $ | $/nuevo | D1..D30 con semáforo de color y tooltip "X de
  Y seguían cargando") y tabla "🎯 Rendimiento por campaña" (nuevos, % cargó,
  3+, $, $/nuevo, Ret. D7) con tip de lectura. admin-sw **v31**.
- **Validado:** `node --check` OK (server.js, admin.js, admin-sw). **Back
  necesita redeploy**; panel, recargar. PROBAR: abrir Datos 2.0 → cohortes de
  los últimos 30 días con las camadas recientes mostrando "—" en D7+; cambiar
  a 10 días; comparar una campaña de pauta contra ORGÁNICO en la tabla 🎯.

### 161. Lotes SIN límite práctico + audiencias (inactivos con cupo / lote completo) + motor de envío que NUNCA pierde un lote
- **Pedido del owner (sobre #160):** poder enviar a la cantidad que quiera
  (ej. "lote de 300 a inactivos de cierto tiempo", o el lote completo), que
  el envío "nunca falle" y sea seguro.
- **Audiencias** (`_resolveNotifBatchAudience`, mismo body en preview y create):
  - `list` — usernames pegados (flujo original).
  - `inactive` — sin login hace ≥ N días (mismo criterio `lastLogin` que los
    segmentos del push masivo), orden lastLogin DESC (los "más frescos"
    primero = más probables de volver) y **cupo opcional** (ej. 300).
  - `all` — lote completo (todos los clientes activos, sin bloqueados).
  - Tope de 500 → **20.000** (tope de sanidad, no de negocio; la base hoy
    tiene ~1.6k). El descriptor queda en el lote (audienceType/Days/Limit) y
    se muestra en el historial ("😴 inactivos ≥15d (cupo 300)" / "🌍 todos").
- **Motor de envío reanudable** (el "nunca falle"): el envío ya NO vive en la
  request. Los recipients nacen `delivery:null` y `_processNotifBatchQueue`
  (cron cada 45s + kick al crear el lote) los procesa de a uno con **claim
  atómico** ($elemMatch delivery:null → 'sending', findOneAndUpdate con
  proyección posicional para saber a quién reclamó sin traer 20k subdocs):
  - Deploy/reinicio a mitad de lote → el cron lo retoma donde quedó; un
    'sending' colgado >10 min se recupera solo.
  - Multi-instancia EB → dos instancias pueden procesar el mismo lote SIN
    duplicar a nadie (el claim por destinatario es la barrera).
  - El PromoBonus del modo window también lo crea el motor (salta si el
    recipient ya tiene promoBonusId → sin bonos dobles tras un retome).
  - Ritmo: pausa de 35ms entre destinatarios (lote completo ~1-2 min).
  - `sendDone:true` (index) cuando no queda nadie pendiente.
- **Panel:** selector de audiencia en la card (📋 Lista / 😴 Inactivos con
  días+cupo / 🌍 Lote completo con aviso). "Validar lista" muestra totales
  COMPLETOS y hasta 150 chips (server recorta la lista visible). El envío
  corre el preview por atrás para confirmar con el CONTEO REAL. Historial:
  audiencia + progreso en vivo ("⏳ enviando (120/300)") vía campo
  `pendientes`; detalle capado a 400 filas en DOM. admin-sw **v30**.
- **Validado:** `node --check` OK (server.js, NotifBatch.js, admin.js,
  admin-sw v30). Sin datos que migrar (#160 nunca se deployó). **Back
  necesita redeploy**; panel, recargar. PROBAR: (1) lote a "inactivos ≥1 día,
  cupo 3" → preview muestra 3 y quiénes; (2) lote completo → confirm con el
  total real; (3) crear un lote grande y reiniciar el server a mitad → al
  minuto sigue solo y termina (historial pasa de "⏳ enviando" a totales);
  (4) los pendientes de un lote viejo nunca se re-mandan al completarse.

### 160. LOTES de notificaciones con REGALO (código exclusivo o ventana horaria) + historial + fixes de push
- **Pedido del owner:** enviar notificaciones a LOTES de personas con regalo
  (bonificación % en próxima carga o regalo de $X); canje por CÓDIGO exclusivo
  del lote (quien no está en el lote no puede usarlo) o por LAPSO horario
  configurable (1h, 3h...); cartel verde para el agente con "marcar como
  usado"; recuadro de lotes enviados (quién envió y a quiénes); y revisar la
  detección de quién puede recibir push (FCM/PWA).
- **Diseño clave — se REUTILIZA PromoBonus:** el bono del lote es un
  PromoBonus con `sourceRuleCode:'lote'` → el cartel verde del chat
  (`loadChatPromoBonus` → `GET /api/admin/promo-bonus`) y el botón "Marcar
  usado" (`POST /api/admin/promo-bonus/:id/use`) existentes funcionan sin
  duplicar nada. Además el depósito con bonus ya marcaba el PromoBonus activo
  como usado solo — aplica también a los de lote.
  - `_getActivePromoBonus(username, {includeFixed})`: el endpoint ADMIN ahora
    incluye regalos de $ FIJO (`montoFijoARS`, antes filtrados por
    `percent>0`) y los bonos 'lote' están EXENTOS del cap de lectura 30%
    (ese cap es de los bonos AUTOMÁTICOS; el lote lo configura un agente).
    El endpoint de la PWA (`/api/promo-bonus/mine`) NO cambió.
  - Cartel del panel: renderiza "REGALO PENDIENTE: $X" para monto fijo y
    muestra el origen ("Lote de <agente>" en vez de "regla -").
- **Modelo nuevo `src/models/NotifBatch.js`:** id, name, mode ('code'|'window'),
  giftType ('percent' 1-200 | 'fixed' 1-500k), amount, code (uppercase, índice),
  validHours (1-168), sentAt/expiresAt, title/message, sentBy/sentByRole,
  recipients[] {userId, username, channel ('app'|'browser'|'none'), delivery
  ('socket'|'push'|'none'|'error'|null), claimedAt, promoBonusId}.
- **Endpoints nuevos (server.js, junto a PromoBonus):**
  - `POST /api/admin/notif-batches` (roles admin|depositor): valida todo
    (código sin colisión con el de bienvenida ni con otro lote ACTIVO; máx
    500 destinatarios; usernames case-insensitive vía collation), crea el
    lote, en modo window activa el PromoBonus de todos al toque, y notifica
    EN SEGUNDO PLANO (Message de chat con el regalo/código/vigencia +
    `sendPushIfOffline`), registrando la entrega por destinatario.
  - `POST /api/admin/notif-batches/preview`: valida la lista ANTES de enviar
    — existentes/bloqueados/no encontrados + canal de push de cada uno
    (misma clasificación que el badge APP INSTALADA / NAVEGADOR / SIN NOTIS).
  - `GET /api/admin/notif-batches` (+`/:id`; también withdrawer): historial
    con quién lo envió, totales (notificados, canjeados, sin notis) y
    detalle por usuario con estado del bono (activo/usado por quién/vencido).
- **Canje modo código:** enganchado al claim existente
  (`POST /api/community-code/claim`): los códigos de LOTE se chequean PRIMERO
  (`_tryClaimNotifBatchCode`); solo canjea quien está EN el lote (para el
  resto: "código no válido", sin revelar que existe), una vez por usuario
  (reserva atómica con $elemMatch claimedAt:null), vigente hasta expiresAt
  del lote (un solo reloj: código canjeable Y bono valen hasta ahí). Al
  canjear: PromoBonus + mensaje al cliente + nota admin-only al agente.
  Sin gate de app instalada (a diferencia del código de bienvenida): la
  exclusividad ES la membresía del lote.
- **PWA:** el modal "Código de Bienvenida" pasó a **"🎁 Reclamar Bono con
  Código"** (menú ☰ ídem) y ahora SIEMPRE muestra el input — antes, quien ya
  había canjeado el código de bienvenida no podía escribir ningún código más
  (bloqueaba los códigos de lote). Los estados pending/used/credited muestran
  su tarjeta + "¿Te llegó otro código por notificación?". La respuesta del
  canje de lote reusa el shape del claim (status pending + type
  next_charge/cash) así el render existente funciona sin JS nuevo. SW **v98**.
- **Panel:** en Notificaciones, cards nuevas **"🎁 Lote con regalo"**
  (modo/regalo/monto/vigencia/código con 🎲 autogenerar/título/mensaje/
  destinatarios + "🔍 Validar lista" con preview de canales + confirm) y
  **"📤 Lotes enviados"** (fecha, quién, regalo, código, vigente/vencido,
  totales, "👥 Ver lote" expandible con canal/entrega/canje/usado-por de cada
  usuario). admin-sw **v29**.
- **Fixes de push (auditoría pedida):**
  1. `sendPushIfOffline` ahora devuelve `{delivery, sent, failed, cleaned}`
     (los callers viejos ignoran el retorno) y acepta `{forcePush}`.
  2. **Socket fantasma:** `_maybeSendPushFallback` (chat) llamaba a
     `sendPushIfOffline` que re-chequeaba `connectedUsers` → al fantasma
     (socket sin ack en 3s, sigue en el Map) le RE-EMITÍA por el mismo socket
     muerto y el push real nunca salía. Ahora pasa `forcePush:true` (en sus
     dos casos el socket ya falló; el tag 'chat-message' colapsa duplicados).
  3. **Badge en vivo del panel:** el handler de `user_app_status` clasificaba
     con el contexto del ÚLTIMO token → un cliente CON app que abría Chrome
     pasaba a "NOTIS EN NAVEGADOR" hasta recargar. Ahora re-fetchea el user
     (`loadUserInfo`) y el badge usa la lógica multi-token completa.
  - Revisado y documentado (sin cambio): `_rouletteHasAppInstalled` acepta
    tokens standalone viejos sin validar que sigan vivos.
- **Validado:** `node --check` OK (server.js, NotifBatch.js, admin.js, ambos
  SW) + parse de los scripts inline de index.html (el único fallo del checker
  es un comentario HTML pre-existente, no código). **Back necesita redeploy**;
  PWA y panel se actualizan con los SW. PROBAR: (1) lote modo código a 2-3
  usuarios → les llega push+chat con el código; canjear desde uno del lote →
  cartel verde al agente; canjear desde uno DE AFUERA → "código no válido";
  (2) lote por tiempo 1h → cartel verde inmediato a todos, desaparece al
  vencer; (3) marcar usado desde el cartel → figura "usado por X" en el
  detalle del lote; (4) historial muestra agente y lote completo; (5) usuario
  que YA usó su código de bienvenida puede canjear un código de lote.

### 159. MÍNIMO para cobrar el reembolso (semanal $1.500 / mensual $5.000), editable desde el panel
- **Pedido del owner:** que haya un mínimo de reembolso semanal y mensual para
  poder cobrarlo; si el cliente tiene reembolso > $0 pero no llega, error
  claro con el monto mínimo ACTUALIZADO del panel (nunca un texto fijo).
- **Config nueva `refundMinimums`** (`{weekly: 1500, monthly: 5000}` por
  default, 0 = sin mínimo) + helper `getRefundMinimums()` (server.js) — sin
  cache, mismo patrón multi-instancia que `getRefundTiersByPeriod`.
- **Claims (`/api/refunds/claim/{weekly|monthly}`):** si el reembolso
  CALCULADO da menos que el mínimo → rechazo con "🚫 No llegaste al mínimo…
  tu reembolso del período es $X y el mínimo para cobrarlo es $Y" (montos
  con formato es-AR; `belowMinimum:true`, `minAmount`, `canClaim:true`). El
  chequeo va **ANTES de la reserva atómica** a propósito: el rechazo no quema
  el una-vez-por-período. El caso netLoss=0 conserva su mensaje propio.
- **`/api/refunds/status`:** cada período suma `minAmount` y `belowMinimum`
  (la PWA actual no los usa — muestra el toast con el message del claim, que
  ya alcanza para el flujo pedido; quedan para pintar el aviso en el recuadro
  si algún día se quiere).
- **Panel (card "Rangos de reembolso", solo admin general):** bloque nuevo
  "💵 Mínimo para cobrar" con los 2 inputs; se guardan con el MISMO botón
  "Guardar rangos". `GET/POST /api/admin/refund-tiers` ahora llevan
  `minimums` — **opcional en el POST**: un panel cacheado viejo que no lo
  manda guarda solo las escaleras y NO pisa los mínimos vigentes. Validación
  0–10.000.000; `Config.set` para registrar quién lo cambió.
- **Validado:** `node --check` OK (server.js, admin.js, admin-sw.js).
  admin-sw a **v28**. **Back necesita redeploy**; panel, recargar. PROBAR:
  (1) panel → card de rangos muestra los mínimos 1500/5000, cambiarlos y
  guardar; (2) cliente con reembolso chico (< mínimo) → al reclamar ve el
  error con el monto del panel; (3) con reembolso ≥ mínimo → cobra normal;
  (4) sin pérdida → sigue el mensaje "No tenés pérdida en el período".

### 158. Lentitud reportada → Atlas upgradeado de FREE a M10 (autoscaling hasta M50) + fanout hgcash apagado
- **Reclamo del owner:** "la página anda lenta". Diagnóstico con video del panel
  (post-upgrade) + tail de 100 líneas de las 2 instancias EB.
- **Acción del owner:** cluster de Atlas subido de **M0 free a M10 con
  autoscaling hasta M50**. El free tier (CPU compartida + throttling de ops) era
  el sospechoso principal de la lentitud con 1644 usuarios y ~28k mensajes.
  Restart de la app 14:28–14:30 ART; conectó bien al cluster nuevo.
- **Diagnóstico post-upgrade:** logs de ambas instancias SANOS — cargas/retiros
  en ~1s, Socket.IO multi-instancia con Redis OK, sin errores de DB ni timeouts.
  En el video cada chat tarda ~2s en cargar, pero el owner navega por Tor
  (Tails): 0,5–1,5s de latencia por request es el piso de Tor, y abrir un chat
  dispara varias requests. **Verificar con un agente sin Tor** si quedó rápido;
  si no, mirar Atlas → Metrics y EB → Health (P90/P99).
- **Fanout hgcash APAGADO:** los logs mostraban `[hgcash-fanout]` fallando con
  404 contra `https://www.autoreembolsos.com/api/hgcash/webhook` en CADA webhook
  (+ los pagos del hermano cayendo acá como "webhook de pago sin payout local").
  No frena nada local (es fire-and-forget) pero ensuciaba logs. El owner agregó
  `HGCASH_FANOUT_URL=off` en SSM `/nardo1girox/prod/` (no existía; el código
  usaba el default hardcodeado). ⚠️ **Aplica recién al próximo restart/deploy**
  (SSM se carga en el bootstrap). Si autoreembolsos revive con el endpoint,
  volver a ponerle su URL.
- **Pendiente menor detectado:** warning al boot por índice duplicado en
  `nextRetryAt` (index:true + schema.index() en el mismo campo) — cosmético,
  limpiar cuando se toque ese schema.

## Sesión 2026-08-07

### 157. FIX "Cerrar todas las sesiones" ya no desloguea al que lo tilda
- **Reclamo del owner:** al cambiar la contraseña con el checkbox "Cerrar todas
  las sesiones activas" tildado, se le cerraba la sesión TAMBIÉN al propio
  usuario que hizo el cambio (tenía que volver a loguearse estando ya adentro).
- **Causa (doble):** (1) subir `tokenVersion` invalida TODOS los JWT, incluido
  el de la request que hizo el cambio; (2) el front encima se deslogueaba a sí
  mismo a propósito (removeItem + reload).
- **Fix:** los DOS endpoints (`/api/auth/change-password` y su variante
  temporal `/change-password/pending`) ahora, cuando `closeAllSessions`,
  emiten un **token FRESCO** (mismo payload que el login, con el tokenVersion
  nuevo, 30d) y lo devuelven como `token`. El front lo guarda
  (VIP.state.currentToken + localStorage `userToken`) y muestra "Se cerraron
  las sesiones en los demás dispositivos. La tuya sigue activa." — sin
  relogin. Aplica también al cambio OBLIGATORIO de primer ingreso y al flujo
  temporal (el flag `_temporalCloseAllSessions` quedó solo como fallback).
- **Fallback conservado:** si el back deployado fuera viejo y no devolviera
  `token`, el front cae al comportamiento anterior (relogin) — nunca queda con
  un token muerto.
- **Validado:** `node --check` OK (server.js, auth.js). SW a **v97**. Back
  necesita redeploy. PROBAR: cambiar contraseña con el tilde puesto → toast
  "los demás dispositivos" y seguir navegando SIN reloguear; en OTRO
  dispositivo abierto con la misma cuenta → al próximo request lo saca.

### 156. Alta rápida: prefijo default "gx" en TODOS los altas + clave "asd123" precargada para publicistas
- **Pedido del owner (3 partes):**
  1. **Registro de la PWA (lado cliente):** el usuario precargado pasa de
     "girox" a **"gx"** (index.html value/placeholder + re-fill de auth.js,
     mismo mecanismo de #127 — sigue siendo borrable). SW a **v96**.
  2. **Alta del panel (admin general / depositor / etc., modal "crear
     usuario"):** el campo usuario ahora arranca precargado con **"gx"**
     (value en el HTML + prefill en showCreateUserModal si está vacío; tras
     crear, vuelve a "gx" para el próximo). Antes no había ningún default.
  3. **Alta del publisher_admin:** usuario precargado **"gx"** (completa:
     gxhector2) y contraseña precargada **"asd123"** (editable). Tras crear
     cada usuario TODO vuelve al estado inicial: usuario="gx", clave="asd123",
     publicista DESELECCIONADO (de #155) e influencer limpio — alta en serie
     rápida eligiendo publicista en cada una.
- Validación nueva en el form del publicista: "gx" solo (default sin
  completar) se rechaza con mensaje claro antes de pegarle al server.
- **⚠️ Nota de seguridad (aceptada por el owner):** "asd123" como clave
  INICIAL de cuentas creadas por agente es deliberada y transitoria — el
  cliente entra con el link de un solo uso (#111) y crea su propia clave. No
  reintroduce el hueco de #149 (aquello era el AUTO-IMPORT creando cuentas con
  clave fija sin que nadie la elija + login local que la aceptaba; el login
  ahora valida contra 1girox).
- **Validado:** `node --check` OK (admin.js, auth.js, SW). Solo front (PWA +
  panel): SW v96 y recarga del panel. PROBAR: registro PWA → campo con "gx";
  alta admin → "gx" precargado y vuelve tras crear; alta publicista → "gx" +
  "asd123" precargados, crear uno → todo se resetea y el publicista queda sin
  elegir.

### 155. publisher_admin MULTI-PUBLICISTA: una cuenta puede tener varias campañas y elegir a cuál cargarle cada usuario
- **Pedido del owner:** que un mismo acceso publisher_admin pueda tener 2, 3 o
  más publicistas asignados y, al crear un usuario, marcar a cuál cargárselo
  (cada publicista se separa: el jugador se crea bajo la cuenta de 1girox de
  ESE publicista, con su key).
- **Modelo:** campo nuevo `User.publisherCampaignCodes` (lista, uppercase). El
  viejo `publisherCampaignCode` queda como "principal" (= el primero) por
  compat — nada que migrar: las cuentas existentes siguen funcionando con su
  única campaña. Helper central **`_publisherCodesOf(employee)`** (server.js):
  unión de ambos campos, normalizada y sin duplicados — TODA validación de
  "¿puede operar esta campaña?" pasa por ahí.
- **Backend (endpoints del publisher_admin):**
  - `create-user`: acepta `campaignCode` en el body. Con 2+ asignadas es
    OBLIGATORIO; con una sola se puede omitir (flujo idéntico al de antes).
    SEGURIDAD: un código que no esté en su lista → 403 (jamás se crea bajo un
    publicista ajeno). El resto del flujo (key de la campaña elegida,
    giroxOwnerCampaign, atribución, influencer de ESA campaña) ya colgaba de
    `campaign` y no cambió.
  - `influencers`: nuevo `?campaign=` (validado contra la lista; default la
    primera) — cada campaña tiene sus propios influencers.
  - `my-stats`: totales sobre TODAS sus campañas (`$in`) + campo nuevo
    `publishers` (lista completa para armar el selector; `publisher` queda por
    compat). `users`: `$in` + filtro opcional `?campaign=` + devuelve
    `acquisitionCampaign` para el badge.
  - `access-link`/`change-password`: el gate pasó de "tiene campaña" a "tiene
    al menos una" (la propiedad real sigue siendo createdByEmployeeId).
- **Backend (gestión del admin general):** POST y PUT de
  `/api/admin/publisher-admins` aceptan **`campaignCodes` (lista)** — todas
  deben existir y estar activas, tope 20 — o el legacy `campaignCode`; guardan
  lista + principal. El GET devuelve `publisherCampaignCodes` y `campaigns`
  (todas resueltas). Helper `_resolveCampaignCodesInput`. El login devuelve
  también `publisherCampaignCodes`.
- **Panel — vista publisher_admin:** bloque nuevo **"🏢 ¿A qué publicista?"**
  en el form de crear usuario, visible SOLO con 2+ campañas (con una, todo
  sigue igual). Son **BOTONES de un toque** (no un desplegable — pedido owner:
  rápido para el agente), y **NUNCA hay uno preseleccionado**: se elige EN CADA
  usuario y tras crear se **deselecciona solo** — así el próximo alta vuelve a
  exigir la elección y no se le carga a un publicista equivocado por arrastre.
  Al tocar un botón se recargan los influencers de esa campaña (con 2+ y nada
  elegido, el selector de influencer se oculta hasta elegir). El header pasa a
  "Mis publicistas" con la lista en el subtítulo, y "Mis usuarios" muestra un
  badge 🏢 con la campaña de cada usuario.
- **Panel — vista admin:** el modal de CUENTAS PUBLICISTAS pasó de select único
  a **checkboxes** (marcar varias campañas); la card de cada cuenta lista
  todas sus campañas y códigos.
- **Sin cambios en el lockdown** (`PUBLISHER_ADMIN_ALLOWED_PATHS`): no hay
  rutas nuevas, solo body/query en las existentes.
- **Validado:** `node --check` OK (server.js, User.js, admin.js). admin-sw a
  **v27**. **Back necesita redeploy**; panel, recargar. PROBAR: (1) editar una
  cuenta publicista y marcarle 2-3 campañas; (2) loguear con esa cuenta → el
  form muestra el selector; crear un usuario para cada publicista → en 1girox
  cada jugador aparece bajo el sub-agente correcto y el badge 🏢 en "Mis
  usuarios" coincide; (3) una cuenta con UNA sola campaña → sin selector, flujo
  viejo intacto; (4) intentar create-user por curl con un código ajeno → 403.

### 154. Script de los 21 SSM del clon: `scripts/clon-ssm-put.sh` (para CloudShell)
- **Pedido del owner:** un solo archivo para subir/modificar todos los SSM del
  clon (runbook MIGRACION-AWS paso 5).
- **Qué es:** bash con los 21 parámetros como variables `COMPLETAR_*` que el
  owner llena LOCAL en Tails (⚠️ **nunca commitearlo con valores reales: el
  repo es público**), lo sube a CloudShell de la cuenta nueva y corre.
  Precargados los valores conocidos (GIROX_API_URL, scope casino, región,
  ADMIN_USERNAME ignite1000); `JWT_SECRET`/`JWT_REFRESH_SECRET` se AUTOGENERAN
  (openssl rand). Sube todo como SecureString con `--overwrite` a
  `/1girox/prod/` en sa-east-1.
- **Guardas y modos:** aborta si `aws sts get-caller-identity` no da la cuenta
  nueva (220282357357 — imposible pisar la vieja por error); los sin completar
  se SALTEAN con aviso (permite tandas: HGCASH_WEBHOOK_SECRET recién existe en
  el paso 12); `--check` lista qué está subido y qué falta; `bash
  clon-ssm-put.sh NOMBRE [NOMBRE2…]` sube/corrige solo esos (para modificar
  después). Re-correrlo completo es idempotente.
- Runbook actualizado (paso 5 apunta al script). **Validado:** `bash -n` OK.
  El script es TEMPORAL como el runbook: borrar ambos al terminar el clon.
- **UPDATE (mismo día) — CAMBIO DE PLAN del owner: la página nueva va en el
  Amazon VIEJO** (la cuenta nueva Maiteabigailsosaaws no se puede usar). Script
  y runbook replanteados: path SSM **`/nardo1girox/prod/`** (el entorno EB
  nuevo lleva `SSM_PATH=/nardo1girox/prod/`; loadSecrets.js lee de ahí, cero
  cambio de código). Guards nuevos: aborta si el prefijo fuera el
  `/1girox/prod/` VIVO y si la CloudShell es la cuenta nueva descartada.
  Simplificaciones por misma cuenta: chau caso SNS y chau usuario IAM nuevo
  (las keys AWS del export sirven → pasan a "copiar igual": 8 copiados + 13
  propios = 21); Redis se REUSA (`paginacopia-redis-node`) con base lógica
  **/2** (la /1 es de NUEVOgirox, la /0 de la vieja vipcargas — DB distinta,
  adapters sin cruce). Sigue haciendo falta: ACM del dominio nuevo, entorno EB
  nuevo, SG del Redis con regla para el SG nuevo, y los externos.
- **UPDATE 2 (mismo día) — LOS 21 SSM SUBIDOS Y VERIFICADOS** ✅ por el owner
  en CloudShell (`--check` dio los 21 sin faltantes). Antes de subir se
  corrigieron 2 valores que iban a fallar: `ALLOWED_ORIGINS` (le faltaba el
  esquema y tenía mayúsculas — se compara contra el header `Origin` exacto,
  que siempre llega en minúsculas con `https?://`; se agregó también la
  variante http:// de la URL EB) y `MONGODB_URI` (sin nombre de base caía en
  la DB `test` de Atlas — se agregó `/giroxnardo` antes del `?`).
  Dato: `HGCASH_WEBHOOK_SECRET` ya existía (el dashboard hgcash ya lo había
  generado) → se subió de una, el paso 11 queda solo para configurar la URL y
  probar. El script del repo volvió a placeholders (sin secretos) tras el uso.
  **Próximo paso: FASE 2 paso 5 — crear el entorno EB nuevo** con
  `SSM_PATH=/nardo1girox/prod/` (⚠️ ese path, no el vivo).

### 153. REEMBOLSO DIARIO ELIMINADO de punta a punta — quedan solo SEMANAL y MENSUAL
- **Pedido del owner:** sacar el reembolso diario de TODO el código, que no quede
  nada, y re-alinear el recuadro de reembolsos de la PWA.
- **Backend (server.js):**
  - `/api/refunds/status` ya NO calcula el diario (ni pide su netwin a la
    Partner API: una request menos por status). Manda un **stub `daily` en $0 /
    no reclamable** SOLO por compat: las PWAs cacheadas viejas hacen
    `daily.potentialAmount` sin chequear y un `undefined` les rompía TODO el
    recuadro hasta que el SW se actualice. `tiers` (legacy) ahora es la escalera
    del SEMANAL. El front nuevo ignora el stub por completo.
  - `POST /api/refunds/claim/daily` → **stub amable** (mismo criterio que
    register-quick #141): responde "ya no está disponible", nunca acredita.
  - `getRefundPercents`/`REFUND_PCT_DEFAULTS`, `getRefundTiersByPeriod` y los
    endpoints `refund-percents` / `refund-tiers` (GET/POST) quedaron solo con
    weekly/monthly — una llave `daily` vieja en `Config['refundTiersByPeriod']`
    se ignora al leer y el próximo guardado la deja afuera.
  - `buildEscaleraText()` ({escalera} de la bienvenida) sin DIARIO.
  - `/api/admin/reembolsos` (stats del panel) y `/api/refunds/all` sin bucket
    diario; `/api/claims-feed` (ticker del login) **filtra los claims
    históricos** `type:'daily'` y los ejemplos ya no generan "diario".
- **Notificaciones:** reglas seed **B1/B2** (recordatorios del diario 14:00/22:00)
  eliminadas de los defaults + **migración idempotente en el seed** que BORRA de
  la base las que ya estén sembradas (`deleteMany({audienceType:
  'refund-pending-daily'})`). La audiencia `refund-pending-daily` se eliminó de
  `_resolveAudience`, del enum de NotificationRule y `_yesterdayInArt` con ella.
- **Datos (decisión consciente):** los RefundClaim históricos `type:'daily'`
  QUEDAN en la base (historial de la tabla del panel, rotulados "Diario
  (histórico)"). Por eso el **enum de RefundClaim conserva 'daily'** (sacarlo
  rompería cualquier save() de un doc viejo) y el script one-shot
  `migrate-refund-periodkey.js` sigue sabiendo backfillear daily.
- **Front PWA:** botón 📅 Diario del recuadro ELIMINADO (con lápida) — semanal y
  mensual se reparten la fila 50/50 solos (flex:1 de `.dash-refunds-row`, sin CSS
  nuevo). Fuera también: opción del modal unificado, rama daily de
  `showRefundModal`, labels/％, escalera del diario en Mi Perfil (la comparación
  "misma escalera" ahora es weekly vs monthly), textos informativos
  ("Reembolsos: semanal y mensual"), CSS `.refund-btn.daily`, listener en app.js
  y label del ticker. **SW a v95.**
- **Panel admin:** editor de rangos solo Semanal/Mensual; botón "Copiar Diario →
  Semanal y Mensual" reemplazado por **"Copiar Semanal → Mensual"**
  (`copyWeeklyTiersToMonthly`; el save ya no manda daily). Stats de reembolsos
  sin la card de Diarios. **admin-sw a v26.**
- **Utils:** `getYesterdayRangeArgentinaEpoch` ELIMINADA de periodRanges.js (solo
  la usaba el diario; `getToday…` sigue: la usa el fueguito). `canClaimDailyRefund`
  ELIMINADA de models/refunds.js. Comentarios de refundTiers/periodRanges al día.
- **Intactos a propósito:** todo lo "diario" que NO es reembolso (ruleta diaria,
  fueguito/racha diaria, ScheduledNotif mode 'daily', ingresos diarios, breakdown
  diario de publicistas, DailyPlayerStats) y el guard `_isStaleClientWelcome`
  (su regex matchea textos VIEJOS cacheados, tiene que seguir reconociendo
  "Reembolso DIARIO"). Los clientes muertos jugaygana* no se tocaron (regla de
  CLAUDE.md: congelados para revertir; `referralRevenueService.js` menciona
  "diario" solo en un comentario).
- **⚠️ ACCIÓN OWNER (revisar 1 vez):** si algún comando de la sección COMANDOS
  (p. ej. `/sys_welcome` guardado en la base) menciona el reembolso DIARIO en su
  TEXTO literal, editarlo a mano — los textos guardados no se migran solos (el
  guardado de rangos ya avisa cuáles mencionan reembolsos, #118).
- **Docs:** ARCHITECTURE.md actualizado (§flujo de reembolsos, periodKey, tabla
  de módulos — de paso se corrigió la fila stale de `giroxReportsService`, que ya
  no existe desde #101). **Validado:** `node --check` OK en los 13 archivos JS
  tocados. **Back necesita redeploy** (corre la migración de reglas B1/B2 al
  arrancar); PWA y panel se actualizan con los SW nuevos. PROBAR: recuadro con
  SOLO Semanal y Mensual bien repartidos; Mi Perfil sin bloque Diario; panel →
  Rangos de reembolso con 2 escaleras y "Copiar Semanal → Mensual"; stats de
  reembolsos con 2 cards; una PWA vieja cacheada no debe romperse (botón diario
  muestra $0 / "ya no está disponible").

### 152. Borrar un comando /sys_* ahora = APAGARLO de verdad (causa raíz del #151 confirmada)
- **Owner (con captura del panel en vivo):** "sí se pueden borrar los comandos
  automáticos" — su panel deployado (anterior al candado isSystem de #149)
  muestra 🗑️ en los /sys_*. **Eso confirma la causa raíz del #151:** el owner
  BORRÓ /sys_reminder en su momento → con el comando AUSENTE el handler usa el
  FALLBACK hardcodeado (el texto viejo de vipcargas) → el mensaje seguía
  saliendo aunque no estuviera en la lista. Borrar de verdad es una trampa
  doble: el fallback lo revive Y el seed lo resucita en cada arranque.
- **Fix (borrar = apagar):** `DELETE /api/admin/commands/:name` para los de
  sistema ahora VACÍA la response en vez de borrar el doc (vacío = no se envía,
  regla #43; el doc existente frena el re-seed y el fallback). Gate de admin
  general (paridad con el POST de #149) + 404 si no existe. Los comandos
  comunes se siguen borrando de verdad.
- **Panel:** 🗑️ visible en TODOS los comandos (también /sys_); para los de
  sistema el confirm explica "se APAGA, queda en la lista vacío para
  reactivarlo con texto" y el toast muestra el mensaje del server.
- **Seed de /sys_reminder → VACÍO por defecto** (complementa #151): como el
  owner ya lo había borrado, el re-seed del próximo arranque lo va a recrear —
  ahora nace APAGADO en vez de nacer con texto. En el clon (base nueva) ídem.
- **Dato para el runbook del clon (captura):** panel en
  nuevogirox.sa-east-1.elasticbeanstalk.com → **región sa-east-1 (São Paulo)**.
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita
  redeploy; panel, recargar. PROBAR: 🗑️ sobre un /sys_ → confirm nuevo → queda
  vacío en la lista y el mensaje no se manda; 🗑️ sobre un comando común →
  se borra como siempre.

### 151. /sys_reminder con texto viejo de VIPCARGAS tras cada carga → VACIADO + código saneado
- **Reclamo del owner (captura):** después de cada carga aparecía "🎮 ¡Recuerda!
  Para cargar o cobrar, ingresa a www.vipcargas.com" — texto de la era
  VIPCARGAS. Y "no está en la lista de comandos, no lo puedo borrar".
- **Qué era:** el comando **`/sys_reminder`** (recordatorio post-depósito).
  SÍ figura en COMANDOS (como `/sys_reminder 🔒`, sin botón de borrar por ser
  de sistema — por eso no lo encontraba/podía borrar). El texto viejo estaba
  en DOS lados: sembrado en la BASE desde el primer arranque (seed de
  initializeData) y HARDCODEADO como fallback en el handler del depósito.
- **Fix:** (1) migración idempotente sin flag en initializeData:
  `updateOne({name:'/sys_reminder', response:/vipcargas/i}, {response:''})` —
  vacío = NO se envía (regla #43); si el owner escribe un texto nuevo desde
  COMANDOS, no se vuelve a tocar (el regex ya no matchea). (2) seed y fallback
  reescritos SIN dominio hardcodeado ("entrá siempre a esta misma página") —
  clave también para el CLON (mismo código, otro dominio). (3) la migración
  además loguea (warn) cualquier otro comando cuya response aún mencione
  "vipcargas", para editarlos desde COMANDOS.
- **⚠️ Pendiente señalado al owner (NO tocado, decisión de marca):** los SMS
  de OTP (`src/services/otpService.js`) todavía dicen "VIPCARGAS: codigo ...
  vipcargas .com" — texto visible para el cliente. Cambiarlo cuando el owner
  defina la marca (¿"CARGAS 1GIROX" + cargas1girox.com?).
- **Validado:** `node --check` OK. **Back necesita redeploy** (corre la
  migración al arrancar). PROBAR: cargar fichas → NO debe aparecer más el
  mensaje "¡Recuerda!"; en COMANDOS, /sys_reminder queda vacío y editable.

### 150. CHAU canal-proximamente PARA SIEMPRE: redirects del server /go/comunidad y /go/soporte
- **Reclamo del owner (con video):** el pill "Unite a la Comunidad" y el botón
  "SÍ, quiero entrar" de la encuesta post-carga seguían cayendo en el 404 de
  /canal-proximamente a pesar de #134/#136/#147. En el video se ve el pill con
  el fallback y el menú ☰ con el link real AL MISMO TIEMPO.
- **Causa raíz (por qué los parches anteriores no alcanzaban):** los botones
  arrancan con el fallback HARDCODEADO en el HTML y el link real llega recién
  cuando el CLIENTE logra el fetch de la config (lento/fallando por Tor). El
  cache en localStorage (#147) no ayuda al owner ni a testers porque **Tor
  Browser borra localStorage en cada sesión** → cada sesión nueva reabre la
  ventana de carrera, y la encuesta (ui.js) copia el href del pill en ese
  estado. Era irresoluble del lado del cliente.
- **Fix definitivo (resolución en el SERVER):** endpoints públicos nuevos
  **`GET /go/comunidad`** y **`GET /go/soporte`** — leen la config VIGENTE
  (`communityConfig.channelUrl`/`supportUrl`, con los mismos fallbacks de
  lectura legacy que /api/config/community; soporte hereda de soporteVipTelegram
  si falta) y responden 302 al link real EN EL MOMENTO DEL CLICK. Sin URL
  configurada o DB caída → redirect a `/` (nunca más una página 404).
- **Front:** los 3 hrefs estáticos pasan a los redirects (`/go/comunidad` en el
  pill del header y el ítem del menú; `/go/soporte` en Soporte 24/7);
  `CANAL_FALLBACK_URL` (chat.js) y el fallback de la encuesta (ui.js) ídem.
  El pisado dinámico con el link directo cuando la config carga SE MANTIENE
  (ahorra el hop del redirect) — pero ya no es crítico: el peor caso ahora es
  un 302 al link correcto.
- **Rutas verificadas sin colisión:** `/:code` (vanity de campañas) matchea un
  solo segmento; express.static no tiene carpeta /go; el catch-all `app.get('*')`
  está registrado después. Sin auth ni rate-limit (fuera de /api/) — es un
  redirect barato (1 lectura de Config, sin cache a propósito: multi-instancia).
- **Validado:** `node --check` OK (server.js, chat.js, ui.js, SW). SW a **v94**.
  **Back necesita redeploy** (rutas nuevas). PROBAR: sesión NUEVA de Tor →
  click INMEDIATO en el pill (antes de que cargue nada) → debe abrir el
  Telegram real; ídem "SÍ, quiero entrar" de la encuesta; Soporte 24/7 del
  menú; con la config vacía → va al inicio, no a un 404.

## Sesión 2026-08-05

### 149. AUDITORÍA DE SEGURIDAD COMPLETA — 15 fixes aplicados (4 críticos de robo de plata)
- **Pedido del owner:** auditoría integral ("que sea imposible que me roben").
  Se corrió con 4 auditores en paralelo (auth/roles, flujos de plata,
  inyección/XSS, superficie pública/secretos) + verificación propia de cada
  hallazgo leyendo el código antes de tocar nada.
- **⚠️ Los detalles de lo NO parcheado NO se documentan acá a propósito** (repo
  público — mismo criterio que #96). El owner los tiene en la conversación.
- **CRÍTICOS cerrados (robo de plata directo, todos verificados explotables):**
  1. **Login con contraseña fija**: el auto-import creaba la cuenta local con
     una clave conocida y el login la aceptaba → se entraba a la cuenta de
     cualquier jugador de la plataforma que no hubiera pasado por la app.
     Ahora se valida usuario+contraseña **contra 1girox** (`validateCredentials`)
     y la cuenta se crea con la clave REAL. Fallback de la clave fija ELIMINADO
     + migración one-shot `migration_kill_asd123_done` que neutraliza las
     cuentas ya creadas así (fuerza cambio de clave + sube tokenVersion).
  2. **Alta en la plataforma con la misma clave fija** (`sync-jugaygana`) →
     ahora random (al casino se entra por SSO, nadie necesita esa clave).
  3. **Escalada de privilegios**: `PUT /api/users/:id` dejaba a CUALQUIER rol
     de staff cambiar la contraseña del ADMIN GENERAL. Y `change-password`
     estaba escrito como lista NEGRA, así que el rol `comunidad` (creado
     después) no estaba contemplado y podía hacer lo mismo. Ambos cerrados.
  4. **Desvío de la recaudación**: `POST /api/admin/cbu` (sin gate de rol,
     mientras su gemelo `PUT /api/admin/config/cbu` sí lo tenía) y los comandos
     `/sys_*` (un cajero reescribía la plantilla `/sys_cbu` con su CBU). Ambos
     ahora exigen admin general.
  5. **Doble descuento en retiros**: `POST /payouts/:id/pay` aceptaba reintentar
     un pago `failed` y volvía a entrar al descuento SIN el guard
     `debitConfirmed !== true` (que su gemelo `pay-other-bank` sí tenía) →
     dejaba el payout marcado como "nunca descontado" y el `/cancel` posterior
     NO devolvía las fichas: el cliente perdía la plata y no cobraba.
  6. **Panel admin expuesto en el dominio público**: `ADMIN_HOST` era una const
     evaluada al require y la env llega por SSM DESPUÉS → la protección nunca
     se aplicaba. Ahora es getter lazy (misma trampa que #130).
- **ALTOS/MEDIOS cerrados:** API key de publicista solo admin general (definía
  bajo qué agente caen jugadores y saldos); `login-without-password` limitado a
  admin/depositor; `tokenVersion` ahora sube en TODOS los cambios de contraseña
  administrativos (una cuenta comprometida ya no sobrevive al cambio de clave);
  `requireAdmin` de notificaciones con paridad de authMiddleware (tokenVersion,
  isBlocked, rol de DB); rate limit global ya no se evade con una cookie
  inventada; filtro de push masivas con lista blanca; ruleta (reset-daily y
  budget) solo admin general; bono cash del código de bienvenida solo admin
  general y tope 10M→500k; XSS almacenado en la tabla de COMANDOS del panel
  (nombre interpolado en onclick, robaba el token del admin) cerrado en las dos
  capas (regex server-side + escapado en el render); CSP con `base-uri`,
  `form-action` y `frame-ancestors`; `x-powered-by` desactivado.
- **Confirmado limpio:** sin secretos en el repo ni en los 322 commits del
  historial; idempotencia por `reference` correcta en todos los flujos de plata;
  reservas atómicas OK en reembolsos, ruleta, fueguito, rakeback y código de
  bienvenida; webhook hgcash con HMAC fail-closed; sin IDOR; lockdown de
  publisher_admin sólido; OTP y recuperación por SMS bien implementados.
- **Validado:** `node --check` OK (server, notificationRoutes, admin.js) y
  verificado que el panel no usa los endpoints que cambiaron de permisos.
  **Back necesita redeploy** (corre además la migración one-shot).

### 148. Código de bienvenida v3: APP OBLIGATORIA, tipo bono = % en próxima carga, cash acreditado COMO BONO
- **Pedido del owner (3 cambios sobre #142/#143):**
  1. **App instalada SÍ o SÍ** para canjear (mismo criterio que el bono de
     instalación): gate `_rouletteHasAppInstalled` (token FCM standalone),
     ANTES de la reserva atómica — un rechazo no quema el una-vez-por-cuenta.
     Aplica a los DOS tipos.
  2. **Tipo "próxima carga" pasa de monto fijo a PORCENTAJE** (config nueva
     `communityWelcomePercent`, default 100, rango 1-200, editable por admin
     general y depositor): el agente ve "+X% EXTRA" en el banner del chat y se
     lo suma a la carga. `User.welcomeCodeBonusAmount` congela el % en este
     tipo (el campo guarda monto O % según welcomeCodeBonusType). Mensajes
     (/sys_welcome_code fallback, nota admin, respuesta, modal PWA) en %.
  3. **Tipo cash se acredita COMO BONO** (`creditUserBalance` con multiplier →
     POST /players/{u}/bonus) con el ROLLOVER elegido en el panel → figura como
     Bono en 1girox. Auto-claim (claim_required=true) + guard bono-sobre-bono
     ANTES de la reserva. La validación del rollover en el panel ahora usa
     **bonus.multipliers** ([0,2,5,10,20,40]) — no los de depósito.
- **Gate de saldo (#142) quedó SOLO para el tipo cash** (comparar saldo contra
  un porcentaje no tiene sentido). Reference `vip-welcome-{userId}` intacta.
- **Panel:** card con campo nuevo "% extra en la PRÓXIMA CARGA" + labels que
  aclaran qué campo aplica a qué tipo. **Validado:** `node --check` OK + parse
  inline. SW a **v93**. Back necesita redeploy. PROBAR: canje sin app → error
  claro; tipo % → banner del agente "+50% EXTRA"; tipo cash → en 1girox figura
  como Bono con el rollover.

### 147. Config de Comunidad CACHEADA en el dispositivo (el pill ya no arranca en canal-proximamente)
- **Síntoma (owner):** al abrir la app, el pill del canal apuntaba primero a
  /canal-proximamente y recién al abrir el menú tomaba el link real. Causa: la
  config se lee por RED al arrancar (por Tor tarda o falla) y hasta que llega,
  los botones quedan con los defaults del HTML.
- **Fix:** cada lectura exitosa guarda `{channelUrl, supportUrl, chatLogoUrl}`
  en localStorage (`communityCfgCache`) y `loadCanalInformativoUrl` la APLICA
  AL INSTANTE al arrancar, antes de tocar la red — la red queda solo para
  refrescar cambios del panel. El fallback solo aparece en la primerísima
  visita de un dispositivo (sin cache). Si los 3 intentos fallan, la cache
  aplicada se conserva (ya no se pisa con el fallback).
- **Validado:** `node --check` OK (chat.js). SW a **v92**. Solo front.

### 146. balance_updated por ROOM (fix multi-instancia) + mini-ENCUESTA de Comunidad en la invitación
- **Fix real de multi-instancia:** los 6 emits de `balance_updated` usaban el
  Map LOCAL `connectedUsers` → si el cliente estaba en la OTRA instancia, el
  evento no salía y la invitación al casino esperaba el poll de 30s (por eso el
  cartel "no aparecía tan al instante como los mensajes", que sí van por room).
  Todos migrados a **`io.to('user_<id>')`** (cruza instancias vía el adapter
  Redis): carga manual, bonus, auto-carga hgcash, confirm de payout, webhook de
  payout y devolución de rechazo. Ahora el cartel sale a la vez que el mensaje.
- **Encuesta de Comunidad:** el bloque informativo del código de $5.000 dentro
  de la invitación fue REEMPLAZADO (lápida) por una mini-encuesta: "📣 ¿Ya
  estás en nuestra Comunidad de Telegram?" con **"🚀 SÍ, quiero entrar"**
  (abre el link de la Comunidad — el de la card del panel, leído del pill del
  header con fallback) y **"✅ Ya estoy en la Comunidad"**. Cualquier respuesta
  se recuerda (localStorage `communitySurveyDone`) y la encuesta no se repite;
  el cartel completo sigue desapareciendo a los 15s.
- **Infra completada por el owner (esta sesión):** stickiness ya venía del
  clon; `/1girox/prod/REDIS_URL` cargada apuntando al ElastiCache del entorno
  viejo con **base lógica /1** (sin cruce con la vieja vipcargas).
- **Validado:** `node --check` OK (server, ui). SW a **v91**. Back necesita
  redeploy (zip). PROBAR con 2 instancias: carga → cartel + mensaje AL MISMO
  TIEMPO; encuesta → SÍ abre Telegram y no vuelve a aparecer.

### 145. DIAGNÓSTICO: tiempo real muerto en el entorno AWS nuevo (chats no aparecen sin refresh)
- **Reclamo de los agentes:** los chats nuevos no aparecen sin refresh; todo
  carga más lento que en la vieja vipcargas. Del lado del cliente, ídem.
- **Diagnóstico (probado en vivo contra cargas1girox.com):** el handshake de
  Socket.IO falla — 2ª request del polling → `"Session ID unknown"` (cayó en
  la OTRA instancia). El entorno NUEVOgirox corre **2 instancias SIN sticky
  sessions en el ALB** y **SIN REDIS_URL** en /1girox/prod (el adapter de
  Socket.IO queda en "single-instance mode", warning en el log). Sin tiempo
  real: cliente cae al poll de 30s y el panel a la reconciliación de 180s —
  exactamente el síntoma. NO es bug de código: es infra que el entorno viejo
  tenía y este no.
- **Fix inmediato (indicado al owner):** bajar el entorno a **1 instancia**
  (min=max=1) → sockets instantáneos sin más requisitos.
- **Para escalar a 2+ instancias (futuro):** (1) stickiness en el load
  balancer, y (2) un Redis PROPIO del entorno en `/1girox/prod/REDIS_URL`
  (el server activa el adapter solo). ⚠️ No compartir el Redis con la vieja
  vipcargas: los adapters se cruzarían los eventos.

### 144. CASO ASENTADO: retiro de $85.000 (giroxWalter354) descontado pero NO visible en "Cargas y Retiros" de 1girox
- **Hechos (owner, 2026-08-05 ~10:00 ART, capturas p1/p2):** retiro
  autogestionado de $85.000 de giroxWalter354 (usuario del publicista
  superwhat): el flujo completo anduvo — solicitud, verificación del agente,
  descuento de fichas (saldo quedó en 0), pago automático hgcash y comprobante
  PDF enviado. PERO en el panel de 1girox (logueado como giroxsuperwhat),
  "Cargas y Retiros de Fichas" del día muestra SOLO la carga de $20.000
  (vip-dep-53288d6b…) — Total de retiros $0.
- **Verificación hecha (Partner API directa):** `GET /players/giroxWalter354`
  con la key MASTER → `player_not_found` ⇒ el jugador vive BAJO EL SUB-AGENTE
  superwhat ⇒ el débito de los $85.000 solo pudo ejecutarse con la key de
  superwhat (ruteo #132 funcionando). El descuento es real y verificado
  doblemente (el confirm del payout relee el saldo y exige que haya bajado
  antes de pagar — anti-fantasma #61). **No hay pérdida de plata**: fichas
  descontadas + pago hgcash hecho = operación consistente.
- **Conclusión:** es un problema de VISUALIZACIÓN del panel de 1girox — el
  RETIRO hecho por Partner API con la key del sub no aparece en su vista
  "Cargas y Retiros de Fichas", aunque la CARGA por la misma vía sí aparece.
  Inconsistencia de su lado (¿otra sección? ¿bug de la vista?).
- **Datos para el reclamo a 1girox:** jugador `giroxWalter354`, agente
  `giroxsuperwhat`, 05/08/2026 ~10:00, monto $85.000, operación WITHDRAW por
  Partner API, reference **`vip-payout-2771989b-55bb-47b8-8a09-8f8e2bba1760`**.
  Pedirles que ubiquen el ledger de esa reference y expliquen por qué no
  figura en la vista del agente.
- **Chequeo extra sugerido al owner:** el saldo del AGENTE superwhat debería
  haber SUBIDO ~$85.000 con ese retiro (las fichas del retiro vuelven al saldo
  del agente dueño de la key). Sobre el origen de los $85.000 con una sola
  carga de $20.000 en el día: el filtro era "Hoy" (puede haber cargas de días
  anteriores) y las GANANCIAS de juego no aparecen en esa vista — no es
  anomalía por sí misma.

### 143. El rollover del bono del código de Comunidad ahora es EDITABLE desde el panel
- **Pedido del owner (sobre #142):** el x2 fijo pasa a config. Nuevo
  `Config['communityWelcomeRolloverX']` (default **2**, 0 = sin rollover),
  helper `getWelcomeCodeRolloverX()` sin cache. El canje tipo cash acredita con
  ese multiplier (0 → depósito libre).
- **Panel (card "🎁 Código de bienvenida"):** input "🎯 Rollover del bono cash
  (x)" — lo editan admin general y depositor (misma regla que el monto). El
  POST valida el valor contra los multiplicadores de DEPÓSITO permitidos por
  1girox (`rollover.multipliers`, hoy [0,1,2,5,10]) y rechaza con la lista si
  no está permitido — así el canje nunca falla en la cara del cliente.
- **Validado:** `node --check` OK. Back necesita redeploy; panel, recargar.

### 142. Lote de UI del owner + código de Comunidad con gate de saldo y rollover x2
- **"Ocultar menú"**: el colapsado ahora deja SOLO `.dash-play` (botón "PÁGINA
  CASINO AQUÍ" + TU SALDO) — antes dejaba `.dash-top` (reembolsos + usuario).
  Botón del casino con text-align:center explícito.
- **Recuadro USUARIO**: el pill pasa de "NIVEL Y REEMBOLSOS ▾" (se cortaba) a
  **"VER MÁS ▾"**; username más chico (9px) para que no se corte.
- **Campanita de notificaciones**: ELIMINADA del menú ☰ (a veces ni aparecía) y
  MOVIDA a la cabecera del chat al lado del sol (`.notif-topbar-btn`, MISMO id
  `notificationBtn` → todo el cableado FCM intacto). Solo ícono: 🔔 verde =
  activadas, 🔕 rojo = bloqueadas, 🔔 neutro = tocá para activar (labels del
  FCM inline pasados a emoji pelado; los title explican cada estado).
- **Invitación al casino post-carga (#135)**: ahora incluye el cartel "🎲 Probá
  tu suerte. ¿No te fue bien? Volvé: con el código de la Comunidad reclamás
  $5.000 GRATIS (menú ☰ → Código de Bienvenida)". ⚠️ El "$5.000" es copy fijo:
  si cambia el monto del bono en el panel, actualizar ui.js.
- **Código de Comunidad (`/api/community-code/claim`), 2 cambios de negocio:**
  1. **GATE DE SALDO**: solo canjeable con el saldo REAL de la plataforma por
     DEBAJO del monto del bono (va ANTES de la reserva atómica para no quemar
     el una-vez-por-cuenta; si el saldo no se puede leer → 503 reintentable).
  2. **Tipo cash con ROLLOVER x2 AUTOMÁTICO**: depósito con multiplier 2 (x2
     permitido en la config del owner) — jugable al instante, retirable tras
     apostar 2× el bono. El tipo next_charge no cambia (lo aplica el agente).
- **"GANADORES DE HOY · RULETA DIARIA" del inicio: ELIMINADO para siempre**
  (rouletteRecentWinnersCard + su render en roulette.js, con lápidas). La lista
  de ganadores DENTRO del modal de la ruleta sigue.
- **Validado:** `node --check` OK (server, ui, roulette) + parse inline. SW a
  **v90**. El gate/rollover del código necesita redeploy del back; el resto es
  front. PROBAR: ocultar menú → solo casino+saldo; campanita en la cabecera
  cambia de color según permiso; carga → cartel con el código; canje con saldo
  ≥ bono → rechazado con mensaje; canje con saldo bajo (tipo cash) → acredita
  con rollover x2; el home sin el recuadro de ganadores.

### 141. SMS OBLIGATORIO en el auto-registro (los creados por agente siguen sin SMS)
- **Pedido del owner (revierte la decisión de #74):** el que se registra SOLO
  verifica su teléfono por SMS SÍ O SÍ (sin poder omitirlo); las cuentas
  creadas por un AGENTE siguen sin exigir SMS (tienen su propio flujo, #137).
- **Backend (`/api/auth/register`):** teléfono + otpCode ahora OBLIGATORIOS
  (antes opcionales). El resto ya existía: OTP purpose 'register'
  (`/api/auth/send-register-otp`, público y rate-limiteado), unicidad por
  phoneKey, phoneVerified:true al crear. Los altas del panel no pasan por acá.
- **`/api/auth/register-quick` DESACTIVADO (410):** era el camino sin SMS del
  flujo de pauta — SIN callers en el front (verificado por grep) pero público:
  un curl con un campaignCode real creaba cuentas sin SMS. El código queda
  abajo por si se revierte.
- **Front (index.html + auth.js):** el modal de registro suma teléfono
  OBLIGATORIO (selector de prefijo + número, mismo armado que verify-phone) y
  el registro pasa a 2 FASES con el mismo botón: "📲 Enviarme el código SMS"
  (valida campos y manda OTP) → aparece el campo del código → "✅ Confirmar y
  crear cuenta". Link "↩ Cambiar número / reenviar código"
  (`VIP.auth.resetRegisterOtp`). Se quitó el `maybeOfferSmsVerification`
  post-registro (ya nace verificado) y la nota dorada ahora explica el porqué.
- **⚠️ Impacto en PAUTA avisado:** los que llegan por anuncios de Meta también
  van a tener que pasar el SMS (las webviews de IG/FB a veces complican recibir
  el código — motivo original del registro sin SMS). Si la conversión de pauta
  cae, se puede rehabilitar register-quick para campañas puntuales.
- **Validado:** `node --check` OK (server, auth.js). SW a **v89**. Back
  necesita redeploy. PROBAR: registro nuevo → exige teléfono → SMS → código →
  cuenta creada con phoneVerified; sin código o con código malo → rechazado;
  register-quick por curl → 410.

### 140. FIX real del #139: la lista de multiplicadores era la de BONOS, y el default correcto es 0
- **Los mismos 2 errores persistían.** Causas: (a) el server probado aún no
  tenía el fix deployado, y (b) el fix #139 leía la lista EQUIVOCADA — se
  verificó la config real con `GET /config` directo contra la Partner API:
  `rollover.multipliers=[0,1,2,5,10]` (DEPÓSITOS) vs
  **`bonus.multipliers=[0,2,5,10,20,40]`** (BONOS) — el 1 elegido por #139 no
  está permitido para bonos. Además `claim_required=true` y
  `fixed_min=2/fixed_max=1000000`.
- **Fix:** `getGiroxBonusMultiplier()` lee `bonus.multipliers` y el default
  preferido es **0 = bono SIN rollover** (tipado como Bono en el panel de
  1girox pero retirable como siempre — exactamente el comportamiento histórico
  de los bonos manuales, que es lo que el owner pidió: distinguirlos, no
  cambiarles las reglas). `GIROX_BONUS_MULTIPLIER` (env) sigue pudiendo forzar
  cualquier valor permitido (ahora acepta 0). **Auto-claim TAMBIÉN en la carga
  con bonus** (claim_required=true: el bono adjunto podía quedar "a reclamar").
- **Validado:** `node --check` OK + config real consultada a la API. Back
  necesita redeploy (Render: verificar que tome el último commit — tiene un
  "Payment failed" que puede frenar deploys; AWS: zip nuevo).

### 139. FIX del #138: multiplicador de bono VÁLIDO elegido desde la config de la plataforma
- **Errores reportados por el owner al probar #138:** carga con bonus → "The
  bonus multiplier field is required when bonus percent / bonus amount is
  present" (la API EXIGE `bonus_multiplier` junto con `bonus_amount`); bono
  directo → "The selected multiplier is invalid" (el x1 default NO está entre
  los multiplicadores permitidos de su config de 1girox).
- **Fix:** helper **`getGiroxBonusMultiplier()`** — lee los multiplicadores
  permitidos de `GET /config` (via `girox.getPlatformConfig()`, cache 10 min) y
  elige: `GIROX_BONUS_MULTIPLIER` (env/SSM) si la plataforma lo permite; si no,
  el MENOR permitido (rollover más suave); último recurso 1. Usado en los DOS
  flujos: el depósito con bonus ahora manda `bonusMultiplier` siempre, y el
  bono directo usa el multiplicador válido.
- **Validado:** `node --check` OK. Back necesita redeploy. PROBAR: carga con
  bonus y bono directo — ambos deben acreditar sin error y verse como Bono en
  el panel de 1girox.

### 138. Carga con bonus y bono directo NATIVOS: en el panel de 1girox ya se distinguen de las cargas
- **Reporte del owner (con capturas del panel 1girox):** una "carga con bonus"
  aparecía como DOS operaciones tipo "Carga" (+$1000 y +$1000, refs vip-dep y
  vip-depbonus) — indistinguibles salvo por la descripción. Ídem el botón Bonus.
- **Carga con bonus (`POST /api/admin/deposit`):** ahora es UNA sola operación —
  el bonus viaja NATIVO en el depósito (`bonus_amount` del feat "Rollover y
  Bonos") → la plataforma registra carga y bono como tipos DISTINTOS y le
  aplica al bono su regla de rollover (la configurada en 1girox). Se eliminó el
  segundo depósito (vip-depbonus) y la pausa de 700ms. `result.bonusFailed`
  (carga OK pero bono rechazado) alimenta el aviso admin-only existente.
  ⚠️ Si el bono viola los límites del feat, la plataforma puede rechazar la
  operación COMPLETA (antes la carga entraba y el bono moría) — el agente ve el
  error y corrige montos.
- **Bono directo (`POST /api/admin/bonus`):** ahora usa `POST /players/{u}/bonus`
  (tipo BONO real) vía `creditUserBalance` con `multiplier` =
  **`GIROX_BONUS_MULTIPLIER`** (env/SSM, default 1; debe ser un multiplicador
  permitido en 1girox). Reglas v1.7 cubiertas: **guard previo** que BLOQUEA si
  el cliente ya tiene bono activo o pendiente (otorgar otro lo pisaría y le
  debitaría el resto) + **auto-claim** (`claimPendingBonus`) para que no quede
  "a reclamar"; si el claim falla, warn y el cliente lo reclama del casino.
- **⚠️ Cambio de comportamiento (consecuencia natural del pedido):** la parte
  de bono ahora SIGUE LAS REGLAS DE BONO de la plataforma (rollover, no
  retirable al instante) — antes era plata libre. Avisado al owner.
- **Referencias intactas:** vip-dep-{txId} y vip-bonus-{txId} idénticas
  (idempotencia). **Validado:** `node --check` OK. Back necesita redeploy.
  PROBAR: carga con bonus → en el panel 1girox deben verse Carga + Bono como
  tipos distintos; botón Bonus a cliente sin bono activo → entra como Bono y
  el saldo lo refleja; con bono activo → bloqueado con mensaje claro.

### 137. Bono de instalación SIN SMS para usuarios creados por un AGENTE
- **Pedido del owner:** el bono 100% de instalación exige app instalada + SMS
  verificado. Para usuarios que NO se registraron solos (los creó un agente
  desde el panel), NO pedir el SMS — que puedan completar el teléfono u
  omitirlo. Si el usuario se registró SOLO, sigue TODO igual (app + SMS).
- **Campo nuevo `User.createdByAgent`** (bool): lo setean los DOS altas del
  panel (POST /api/admin/users con role user, y el create-user del
  publisher_admin). Señales de respaldo para cuentas creadas ANTES del campo:
  `acquisitionSource='manual'` (publisher) o `accessLinkCreatedAt` (el link de
  un solo uso siempre lo genera un agente).
- **Gate del claim (`/api/install-bonus/claim`):** el chequeo `phoneVerified`
  se saltea si `_agentCreated`. Los DEMÁS candados siguen para todos: app
  standalone + token FCM + bloqueo por dispositivo que ya cobró
  (DEVICE_ALREADY_CLAIMED). Racional: el creado por agente no puede
  auto-fabricarse cuentas en masa (el alta la controla el agente).
- **Front sin cambios:** installbonus.js solo reacciona a los códigos del
  server; el banner de "verificá tu teléfono" sigue empujando la verificación
  opcional (#115). **Validado:** `node --check` OK. Back necesita redeploy.
  PROBAR: usuario creado por agente + app instalada, SIN teléfono → reclama OK;
  usuario auto-registrado sin SMS → sigue rechazado con
  PHONE_VERIFICATION_REQUIRED.

### 136. Config de Comunidad: reintento continuo + refresh al abrir el menú (los links ya no quedan clavados)
- **Reporte del owner:** con la config de Comunidad BIEN guardada en el panel
  (verificada en su captura: canal y soporte cargados), el cliente seguía
  cayendo en canal-proximamente; y el Soporte 24/7 "también se rompió" — en
  realidad era el MISMO síntoma (ambos fallbacks son 404 del dominio propio y
  se ven iguales; antes soporte caía en el wa.link de METAWIN, que era peor).
- **Causa:** la app aplicaba esa config UNA sola vez, en el arranque de la
  sesión. La sesión del cliente era ANTERIOR al guardado de la config (y por
  Tor la lectura además puede fallar) → hrefs clavados en los fallbacks hasta
  recargar la página.
- **Fix:** `loadCanalInformativoUrl` ahora (a) reintenta en background cada 60s
  hasta lograr aplicar la config, y (b) se RE-EJECUTA al abrir el menú ☰
  (throttled a 30s del último éxito) → un cambio guardado en el panel llega al
  cliente sin recargar. Aclaración al owner: la card estaba bien cargada y SÍ
  está en la sección Comandos del panel (corrección mía previa era errónea).
- **Validado:** `node --check` OK (chat.js) + parse inline. SW a **v88**. Front.

### 135. Link de referidos con dominio real + INVITACIÓN AL CASINO al acreditarse una carga
- **Link de referidos (fix):** `referralController` tenía
  `REFERRAL_BASE_URL='https://vipcargas.com/linkreferido'` como CONST hardcodeada
  → getter lazy `referralBaseUrl()` sobre `PUBLIC_BASE_URL` (misma trampa y mismo
  patrón que #130; default cargas1girox.com). Los 2 usos migrados.
- **Invitación al casino (feature, pedido owner):** cuando el saldo del cliente
  SUBE (carga del agente, auto-carga hgcash, premio, devolución), aparece un
  recuadro grande centrado: "💰 ¡Saldo acreditado! $X — 🎰 JUGAR AHORA EN
  1GIROX" con barra de tiempo; se va solo a los **15 segundos** o con la ✕. El
  botón llama a `VIP.ui.enterCasino()` (el SSO de siempre: entra logueado).
  - **Cableado:** `ui.showCasinoInvite/hideCasinoInvite/handleBalancePush` +
    handler NUEVO `socket.on('balance_updated')` en socket.js — el server YA
    emitía ese evento al acreditar y el cliente NO lo escuchaba (solo polling
    de 30s): ahora la invitación sale al instante; el polling queda de respaldo
    (mismo criterio sube/baja).
  - Guardas: throttle 60s (socket+polling no duplican), no aparece si el casino
    ya está abierto, subida → invitación / bajada → toast de siempre.
- **Validado:** `node --check` OK (referralController, ui.js, socket.js). SW a
  **v87**. El fix de referidos necesita redeploy del back; la invitación es
  front. PROBAR: cargarle a un usuario con la app abierta → recuadro al
  instante con el monto; tocar → casino logueado; dejarlo → se va a los 15s;
  modal de referidos → link con cargas1girox.com.

### 134. Soporte/canal saneados: chau wa.link de METAWIN, botón violeta eliminado, fallbacks al dominio nuevo, login unificado
- **Reportes del owner (verificados los 4):**
  1. "Soporte 24/7" del menú ☰ derivaba a `wa.link/metawin2026` — era el HREF
     DEFAULT hardcodeado en el HTML (resto de la era WhatsApp/metawin); chat.js
     lo pisa con Comunidad→supportUrl, pero si esa carga fallaba (Tor) quedaba
     el default. Nuevo default: `cargas1girox.com/soporte-proximamente` (404 del
     dominio propio, mismo criterio que el canal #106).
  2. El pill "Unite a la Comunidad" caía en `vipcargas.com/canal-proximamente`
     con la config bien cargada → mismo motivo: UN solo fetch sin retry que
     falló por Tor dejó el fallback. `loadCanalInformativoUrl` ahora hace **3
     intentos con backoff** (patrón #133) y los 3 fallbacks del canal pasaron a
     `cargas1girox.com/...`. ⚠️ Aclarado al owner: el canal se configura en la
     card "📣 Comunidad / Canal de Telegram" del panel (channelUrl), NO en
     COMANDOS.
  3. **Botón violeta "💬 Soporte Telegram" del dashboard ELIMINADO** (con
     lápida): communitySection + communitySupportBtn + su script inline. El
     soporte vive SOLO en el menú ☰ (decisión owner).
  4. **Soporte del login unificado:** `GET /api/config/soporte-vip` (público,
     lo usa el botón del login) ahora HEREDA `communityConfig.supportUrl` si la
     card "Soporte VIP" no tiene URL propia → el soporte se configura en UN
     lugar (Comunidad) y alimenta login + menú ☰.
- **Validado:** `node --check` OK (server, chat.js) + parse inline (7 scripts).
  SW a **v86**. El punto 4 necesita redeploy del back; el resto es front.

### 133. FIX bienvenida perdida: reintentos (chat vacío al entrar por link en red lenta)
- **Síntoma (owner, probando por Tor):** entró con el link de acceso y el chat
  quedó VACÍO (sin bienvenida) y el chat tampoco aparecía del lado del admin
  hasta que el cliente escribiera; al recargar la página, la bienvenida salió.
- **Causa:** `sendWelcomeMessages` (ui.js) hacía UN solo POST a
  `/api/messages/welcome` y el catch se tragaba cualquier fallo de red en
  silencio, sin retry. En una red lenta (Tor, 3G) el primer request muere y no
  hay bienvenida hasta la próxima carga de página. Como la bienvenida es la que
  crea el ChatStatus, el admin tampoco veía la conversación.
- **Fix:** 3 intentos con backoff (0/2.5s/7s); el endpoint ya es idempotente
  (throttle 24h server-side) así que reintentar es seguro; si fallan los 3,
  warn en consola y reintenta en la próxima carga (comportamiento previo).
- **Validado:** `node --check` OK (ui.js). SW a **v85**. Solo front.

### 132. RUTEO por dueño: las operaciones de jugadores de PUBLICISTA van con la key del sub-agente
- **Síntoma (owner):** al cargarle desde el panel a un usuario creado por un
  sub-agente (publicista con API key propia), la carga decía "el usuario no
  existe" — aunque desde el panel WEB de 1girox el principal sí puede cargarle.
- **Causa raíz:** la key MASTER **NO VE por Partner API** a los jugadores creados
  bajo un sub-agente (el supuesto de #97 "la master opera sobre toda su
  jerarquía" era FALSO para la API). Solo el ALTA usaba la key del publicista;
  cargas/retiros/saldo/stats/SSO iban con la master → player_not_found.
- **Fix (central, sin tocar los ~60 call sites):**
  - `giroxService.setKeyResolver(fn)`: server.js inyecta un resolver
    `username → apiKey|null` (cache 60s). `_request` acepta `username` (resuelve
    la key del dueño) o `apiKey` explícita; `_headers(override)`.
  - Las 11 operaciones por jugador pasan `username` (create, getPlayer,
    validate, changePassword, session/SSO, deposit + deposit-retry, withdraw,
    bonus, stats, bonusClaim) → firman solas con la key correcta. La red de
    seguridad del deposit (crear jugador al vuelo) también hereda el ruteo.
  - **Batch de stats agrupado por key**: antes un batch único con la master
    devolvía a los de publicista como not_found (reembolsos/VIP/referidos en $0
    silencioso). Ahora agrupa por key resuelta y hace un request por grupo.
  - **`User.giroxOwnerCampaign`** (campo nuevo): se setea SOLO cuando el alta
    del publisher_admin se hizo con la key del publicista OK. null = master.
    El resolver usa ESTE campo (no acquisitionCampaign: los captados por LINK
    de pauta se crean bajo la master y ruteárlos por la sub los rompería).
- **⚠️ Consecuencias operativas (avisadas al owner):**
  1. Los depósitos a jugadores de publicista salen del SALDO del sub-agente en
     1girox → el principal debe mantener fondeados a los sub-agentes.
  2. Los usuarios de PRUEBA creados antes de este fix bajo sub-agentes no tienen
     `giroxOwnerCampaign` → siguen fallando; recrearlos (o marcarlos a mano).
- **Comentario stale de giroxPublisherKeys.js corregido** (afirmaba el supuesto
  falso). **Validado:** `node --check` OK (server, giroxService, publisherKeys,
  User). Back necesita redeploy. PROBAR: crear usuario con un publicista →
  cargarle desde el panel (debe acreditar y descontar del saldo del SUB en
  1girox); botón CASINO del cliente; reclamar un reembolso con pérdida.
- **UPDATE (mismo día):** migración one-shot
  **`migration_backfill_girox_owner_done`** — backfillea `giroxOwnerCampaign` a
  los usuarios creados por publisher_admin ANTES del fix (condición triple:
  acquisitionSource manual + createdByEmployeeId + giroxSyncStatus synced +
  campaña con key). Corre sola en el próximo arranque → los 4 usuarios de prueba
  del owner quedan ruteados sin tocar nada a mano.

### 131. La card de hgcash del panel mostraba el webhook con vipcargas.com hardcodeado
- **Síntoma (owner):** la línea informativa "Webhook a configurar en hgcash:"
  decía `https://vipcargas.com/api/...` — el dominio estaba HARDCODEADO en
  admin.js. Era solo display (lo que vale es la URL cargada en el dashboard de
  hg.cash), pero confundía.
- **Fix:** `GET /api/admin/hgcash/config` ahora devuelve `webhookFullUrl` armada
  con `getPublicBaseUrl()` (lazy, #130) y el panel la muestra tal cual (fallback
  local a cargas1girox.com). Back necesita redeploy; panel, recargar.

### 130. FIX links con vipcargas.com en AWS: PUBLIC_BASE_URL pasó a getter LAZY
- **Síntoma (owner):** en el entorno de AWS, los links de acceso salían con
  `vipcargas.com` aunque `/1girox/prod/PUBLIC_BASE_URL` estaba PERFECTO
  (verificado por CloudShell) y se reiniciara el server.
- **Causa raíz:** `const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || ...)`
  se evaluaba AL REQUIRE, pero en EB esa env llega desde SSM en el bootstrap
  ASYNC (después) → la const quedaba clavada en el default. La trampa exacta
  contra la que avisa CLAUDE.md (lazy getters de JWT_SECRET). En Render no se
  notaba porque las env llegan directas al proceso.
- **Fix:** la const es ahora **`getPublicBaseUrl()`** (lee process.env en cada
  llamada; comentario "No volver a const"). Actualizados los 4 usos: link de
  acceso (`issueAccessLinkFor`), link del comprobante de pago, y los 2 renders
  de HTML con placeholder (index + admin). Default del fallback actualizado a
  `https://cargas1girox.com` (el dominio canónico nuevo).
- **Validado:** `node --check` OK. **Back necesita redeploy** (es cambio de
  código: en AWS subir zip nuevo, no alcanza el restart). PROBAR: generar link
  → sale `https://cargas1girox.com/?acceso=...`.

### 129. Visto del agente en el panel: verde brillante + etiqueta "Visto" (chau confusión gris/celeste)
- **Síntoma (owner, captura):** en la burbuja violeta del panel, los ✓✓ celestes
  (#53bdeb, leído) casi no se distinguían de los grises (enviado).
- **Fix (solo CSS + markup):** NO leído = ✓✓ blanco translúcido bien apagado;
  LEÍDO = ✓✓ **verde #00e676 con glow** + la palabra **"Visto"** al lado. La
  etiqueta va siempre en el markup y la muestra el CSS con `.msg-read` → el
  pintado en vivo (`user_read_messages` agrega la clase) la enciende sin tocar
  JS. Panel: recargar. Los ✓✓ del CLIENTE en la PWA no se tocaron.

### 128. Cabecera del chat: "Soporte 1Girox" → "Cargas 1Girox"
- Pedido del owner. Cambiado el nombre de la cabecera del chat de la PWA (y el
  alt del avatar). SW a **v84**. Solo texto/front.

### 127. Prefijo default del registro: "VIP" → "girox"
- **Pedido del owner:** en el registro manual de la PWA, el campo de usuario
  venía pre-cargado con "VIP" — ahora arranca con **"girox"** (placeholder
  "giroxtuusuario"). Sigue siendo BORRABLE como antes (es solo un default, no un
  prefijo forzado). Cambiado en index.html (value/placeholder) y auth.js (el
  re-fill al mostrar el form). SW a **v83**. Solo front.

### 126. Los publisher_admin ahora generan LINKS DE ACCESO (al crear y regenerable)
- **Pedido del owner:** el alta de usuarios del publicista no entregaba el link
  de acceso de un solo uso (#111 era exclusivo de admin general/depositor) y
  tampoco se podía regenerar para un usuario ya creado.
- **Backend:** helper **`issueAccessLinkFor(userId)`** (extraído del endpoint del
  admin, misma lógica: token 192 bits, solo se guarda el sha256, regenerar pisa
  el anterior). Lo usan: (a) el endpoint del admin/depositor (refactor, mismo
  comportamiento); (b) **`POST /api/admin/publisher-admin/users/:userId/access-link`**
  (NUEVO) — con el mismo doble check que change-password: SOLO usuarios que ese
  publisher_admin creó (`createdByEmployeeId`), role 'user', no bloqueados; cae
  bajo el prefijo del lockdown así que no se tocó PUBLISHER_ADMIN_ALLOWED_PATHS;
  (c) **`create-user` del publicista** — genera el link en el alta y lo devuelve
  (`accessLink`; si falla, el usuario igual queda creado y se regenera después).
- **Panel (vista publisher_admin):** al crear un usuario se abre el MISMO modal
  del link del flujo admin (#111, showAccessLinkModal) con botón copiar; en "Mis
  usuarios" cada fila tiene el botón **"🔗 Link"** (confirm + modal). El ok del
  alta avisa que el link está en el recuadro.
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy;
  panel, recargar. PROBAR logueado como publisher_admin: crear usuario → modal
  con link; abrirlo en incógnito → entra logueado y pide contraseña; "🔗 Link"
  sobre un usuario viejo → regenera; intentar el endpoint con un usuario de OTRO
  publicista → 403.

### 125. Variable {escalera} en la bienvenida: los rangos de reembolso se insertan solos
- **Contexto (owner):** la bienvenida guardada decía "DIARIO 20% / SEMANAL 10% /
  MENSUAL 5%" — porcentajes de la era JUGAYGANA, mal para todos. Con los rangos
  editables (#118), cualquier texto fijo queda desactualizado al primer cambio.
- **Fix:** helper **`buildEscaleraText()`** (server.js) — arma el texto de la
  escalera VIGENTE leyendo `getRefundTiersByPeriod()` al momento de ENVIAR cada
  bienvenida: si las 3 escaleras son iguales muestra una sola ("Si perdés hasta
  $30.000 → te devolvemos el 3%…"); si difieren, una línea por período. Nueva
  variable **`{escalera}`** en `/api/messages/welcome` (mismo formato {var} que
  {username}/{cbu}). Fallback y seed de `/sys_welcome` actualizados (afuera el
  20/10/5 stale; la description del comando documenta la variable).
- **⚠️ ACCIÓN OWNER (una vez, por base ya sembrada):** el `/sys_welcome` GUARDADO
  en la base conserva el texto viejo — editarlo desde COMANDOS reemplazando las 3
  líneas de "Reembolso X del N%" por `{escalera}`.
- **Validado:** `node --check` OK. Back necesita redeploy.

### 124. La app pasa a llamarse "CARGAS 1GIROX"
- **Pedido del owner:** cambiar el nombre visible de la app por "CARGAS 1GIROX".
- Cambiado en: `<title>` ("CARGAS 1GIROX | 24/7"), metas `apple-mobile-web-app-title`
  y `application-name` (index.html) y `name`/`short_name`/`description` del
  `manifest.json` → pestaña del navegador + nombre de la PWA instalada.
  ⚠️ Los que YA tienen la app instalada pueden seguir viendo el nombre viejo
  hasta reinstalar (Android cachea el nombre del WebAPK). SW a **v82**. Solo front.

### 123. FIX crash-loop de arranque: el seed del admin inicial ya no tumba el server (E11000 ADMIN001)
- **Síntoma (Render):** deploys fallando en loop con `MongoServerError: E11000 ...
  index: accountNumber_1 dup key: { accountNumber: "ADMIN001" }`. Causa: el seed
  de `initializeData` busca el admin por `ADMIN_USERNAME` y si no lo encuentra lo
  CREA con `accountNumber:'ADMIN001'` (único). Si la base ya tiene un admin con
  ADMIN001 pero con OTRO username (típico: se cambió `ADMIN_USERNAME` en el env
  apuntando a una base ya sembrada), el create chocaba y el rechazo no manejado
  mataba el proceso → deploy en loop.
- **Fix:** try/catch alrededor del create — con E11000 loguea un mensaje claro
  (qué pasó y las 2 salidas: ADMIN_USERNAME = el admin existente, o base nueva en
  MONGODB_URI) y el boot SIGUE. El admin inicial es conveniencia, no puede
  voltear el server.
- **Nota (no tocado):** en Render también aparece un `ValidationError
  keyGeneratorIpFallback ... ERR_ERL_UNKNOWN_VALIDATION` de express-rate-limit:
  es RUIDO no fatal (Render instaló otra versión de la lib que no reconoce esa
  opción de validate; la lib loguea y sigue). En EB con el lockfile (7.5.1) la
  opción es válida.
- **Validado:** `node --check` OK. Back necesita redeploy.

### 122. Premios del FUEGUITO con ROLLOVER x5 (reemplaza el requisito de cargas)
- **Pedido del owner:** cambiar cómo se pagan los premios del fueguito — antes el
  reclamo exigía actividad de cargas del período; ahora el premio se paga SIEMPRE
  pero con **rollover**: para retirarlo hay que apostar X veces el monto (ej.
  premio $10.000 con x5 → apostar $50.000).
- **Cómo se implementó (candado del lado de la PLATAFORMA, cero contabilidad
  local):** el premio se acredita con `girox.depositToUser(..., {multiplier: x})`
  — depósito CON objetivo de apuestas de 1girox. La plata entra al saldo al
  instante (jugable) pero `wagering.available` no la incluye hasta apostar
  multiplier × premio, y el retiro YA validaba contra `available` → no hubo que
  tocar nada del flujo de retiros. ⚠️ NO se usó `/bonus` con multiplier a
  propósito: esa vía queda "a reclamar" en el casino (v1.7) y pisa bonos activos.
  La reference `vip-fire-...` es LA MISMA de siempre (se pasa explícita y
  `_buildReference` no la toca) → idempotencia intacta.
- **Multiplicador configurable:** `Config['fireRolloverMultiplier']` (default
  **5**, rango 0-50, 0 = premio libre como antes), editable en la card "🔥
  Premios del Fueguito" del panel (input nuevo, `Config.set` con username). Sin
  cache (multi-instancia). GET/POST `/api/admin/fire-milestones` lo exponen.
- **ELIMINADO (con lápida) el gate "Req 6"** de `/api/fire/claim-reward`
  (requisito de cargas `milestone.requireDeposits` vía `getDepositsInPeriod`):
  reemplazado por el rollover. Los campos de requisito siguen en la config y en
  la tabla del panel pero YA NO se chequean al reclamar (el hint del panel lo
  aclara). `getDepositsInPeriod` queda sin callers (se conserva).
- **Avisos al cliente:** el recuadro del premio pendiente (fire.js) muestra
  "🎯 Para poder retirarlo: apostá $X (rollover x5)" ANTES de reclamar; la lista
  de hitos dice "(retiro con rollover x5)" (antes decía "requiere actividad del
  mes", stale); el mensaje de éxito del server explica el objetivo y va también
  al chat. `/api/fire/status` expone `rolloverMultiplier`.
- **Nota sobre "en el mes":** el objetivo de apuestas lo administra 1girox y NO
  tiene vencimiento mensual propio de nuestro lado — queda pendiente hasta
  cumplirse (si la config de rollover de la plataforma define expiración, manda
  esa). Si el owner quisiera un vencimiento calendario estricto habría que
  llevar contabilidad local (se le explicó el trade-off).
- **Validado:** `node --check` OK (server.js, fire.js, admin.js). SW a **v81**.
  **Back necesita redeploy.** PROBAR: llegar a un hito → el recuadro avisa el
  rollover → reclamar → saldo sube pero `wagering.available` no; intentar
  retirar → la plataforma lo frena hasta apostar 5×; cambiar el x en el panel.

### 121. Branding v2: íconos TRANSPARENTES, banner de inicio definitivo y logo 1GIROX fijo en el soporte
- **Pedido del owner:** (a) íconos de la PWA con fondo transparente; (b) el banner
  del login pasa a ser `bannerinicio.png` (arte con deportes + ruleta + cartas, no
  el de SLOTS); (c) el logo del chat de soporte seguía sin verse → que quede
  puesto directo desde el código.
- **Íconos:** regenerados los 10 con **alfa real** (badge "1G" al 96% sobre
  transparente). ⚠️ Caveats estándar: iOS pinta NEGRO detrás del
  apple-touch-icon transparente y algunos launchers Android le ponen su propio
  fondo — con branding oscuro se ve bien igual.
- **Login:** `public/images/banner-inicio-1girox.jpg` (800x200, 44KB) reemplaza a
  `slots-1girox.jpg` (ELIMINADO — duró una sesión, #120).
- **Soporte:** el `src` DEFAULT de `#chatTopbarAvatar` (index.html) ahora es
  **`public/images/soporte-1girox.png`** (cuadrado 256px, logo 1GIROX horizontal
  centrado sobre oscuro, pensado para el recorte circular con object-fit:cover)
  — ya no depende de la config del panel para verse; si el panel carga un logo
  (Comunidad), chat.js lo sigue pisando. Sobre el "no se cambia": el guardado
  del panel quedó OK en la base (la preview persiste); la PWA lo aplica al
  ARRANCAR sesión — sospecha de SW/recarga vieja en el emulador del owner. Con
  el default hardcodeado el look deseado queda garantizado.
- **Validado:** íconos y avatar verificados visualmente. SW a **v80**. Solo
  front/assets. PROBAR: reinstalar la PWA → ícono 1G sin placa de fondo; login
  con el banner nuevo; chat con el logo 1GIROX en la cabecera.

### 120. BRANDING 1girox: íconos de la app nuevos + banner SLOTS en el login
- **Pedido del owner:** reemplazar el logo tipográfico "♛ V I P / VIPCARGAS" del
  login por el arte de 1girox, y cambiar los íconos de la PWA instalada por el
  badge "1G" dorado.
- **Íconos PWA:** regenerados los 10 `public/icons/icon-*.png` (32→512) desde el
  arte fuente (badge "1G" 3000x3000): recorte automático al contenido + centrado
  al 90% sobre fondo oscuro #0d0a14, con PIL. **Mismos nombres de archivo** → no
  hubo que tocar manifest.json, los <link> del head, las notificaciones push
  (icon/badge) ni el avatar default del chat (`/icons/icon-96x96.png`) — todo
  apunta a las rutas de siempre y toma el arte nuevo solo. El SW precachea 192 y
  512 → bump a **v79** purga los viejos.
- **Login:** el bloque corona/VIP/VIPCARGAS (entre Reseñas y Regalos) fue
  reemplazado (con lápida) por `public/images/slots-1girox.jpg` (banner SLOTS de
  1girox, 800px, 47KB, borde dorado suave). `public/images/` es carpeta nueva.
- **Sobre "cambio el logo del chat y no se ve":** el guardado del panel FUNCIONA
  (la vista previa persiste tras recargar = quedó en la config). La PWA lo aplica
  en `loadCanalInformativoUrl` que corre EN EL ARRANQUE de la sesión (auth.js) —
  el cliente lo ve al RECARGAR la app (con SW puede necesitar 2 recargas). No es
  bug; es el momento de aplicación. El default del avatar además ahora ya es el
  ícono 1G nuevo.
- **Validado:** íconos verificados visualmente (512px). Solo front + assets — no
  necesita redeploy del back. PROBAR: login con el banner nuevo; reinstalar la
  PWA (o esperar que el SO refresque el ícono) → ícono "1G"; recargar la app del
  cliente → avatar del chat con el logo subido desde el panel.

### 119. "Activar notificaciones" + el botón flotante "Instalar App" ya no tapa la cámara del chat
- **Pedido del owner:** (a) el botón "NOTIS" pasa a decir "Activar notificaciones";
  (b) el cartel flotante "📱 Instalar App" (a los que navegan SIN la app instalada
  les aparece fijo abajo a la derecha) tapaba la CÁMARA y el enviar de la barra del
  chat → los que no tienen la app no podían mandar el comprobante ni fotos.
- **Textos de notificaciones (index.html):** los 5 estados del botón
  ('🔔 NOTIS' → '🔔 Activar notificaciones', '🔕 NOTIS BLOQUEADAS' → '🔕
  Notificaciones bloqueadas', '🔔 NOTIS ACTIVADAS' → '🔔 Notificaciones
  activadas'), el toast de "Firebase cargando" y la etiqueta estática del menú ☰.
  El modo COMPACTO (solo emoji tras la primera vez) queda igual. Los console.log
  internos que dicen NOTIS no se tocaron (no los ve el usuario).
- **Botón flotante de instalación (`.pwa-install-btn`):** estaba en `bottom:20px;
  right:20px` con z-index 9999 — exactamente arriba de la cámara/enviar de la
  barra estilo WhatsApp. Ahora: **`bottom:86px`** (queda ARRIBA de la barra de
  escribir), más chico (padding 9/14, font 13px), con comentario-advertencia en el
  CSS para que nadie lo vuelva a bajar. Además se le agregó una **✕ para
  ocultarlo** (guarda `pwaInstallDismissedAt` en localStorage y no reaparece por
  3 días; `stopPropagation` para que cerrar no dispare la instalación). El texto
  va en un span propio (`pwaInstallLabel`) para que el modo iOS ("Agregar a
  Inicio") no pise la ✕. El ítem "Instalar App" del menú ☰ sigue siempre
  disponible.
- **Validado:** parse OK de los scripts inline (7/7). SW a **v78**. Solo front —
  no necesita redeploy del back (pero puede ir junto). PROBAR en un celular SIN
  la app: el cartel aparece arriba de la barra, la cámara y el enviar quedan
  libres, la ✕ lo oculta y no vuelve al recargar.

### 118. RANGOS de reembolso EDITABLES desde el panel, con escalera PROPIA por período
- **Pedido del owner:** que los rangos (% según pérdida del período) se puedan
  cambiar desde el panel; que el diario, el semanal y el mensual puedan tener
  escaleras DISTINTAS (no las 3 iguales sí o sí); todo personalizable; y que al
  cambiarlos se actualice todo lo que los muestra — con AVISO de lo que hay que
  tocar a mano (los comandos).
- **`src/utils/refundTiers.js` generalizado:** `getRefundTier`/`calcRefund`/
  `listTiers` ahora aceptan una escalera como parámetro (default = la histórica
  Bronce 3% / Plata 6% / Oro 10%, renombrada `DEFAULT_TIERS`; alias
  `REFUND_TIERS` queda por compat). Nuevo **`normalizeTiers(raw)`**: valida y
  normaliza una escalera cruda (1-6 rangos, % 0-100 con 1 decimal, umbrales
  enteros ESTRICTAMENTE crecientes, solo el último sin techo — si ninguno es
  "sin techo" se lo fuerza al último; ordena por umbral así el panel no depende
  del orden) y TIRA errores en castellano para mostrarle al admin.
  Emoji/color salen de la POSICIÓN (`TIER_STYLES`, hasta 6: 🥉🥈🥇💠💎👑).
- **Config:** `Config['refundTiersByPeriod']` = `{daily:[{name,pct,max}],
  weekly:[...], monthly:[...]}` (solo lo editable; min/emoji/color se derivan al
  leer). Helper `getRefundTiersByPeriod()` en server.js — **sin cache a
  propósito** (multi-instancia EB, misma razón que getConfig #91); escalera
  inválida/ausente cae a `DEFAULT_TIERS` por período (una config corrupta jamás
  rompe un reclamo).
- **Aplicado en los 4 lugares:** `/api/refunds/status` (los 3 cálculos, cada uno
  con SU escalera) y los 3 `POST /api/refunds/claim/*`. El status ahora manda
  **`tiersByPeriod`** (las 3 tablas) y conserva `tiers` (= la del diario) por
  compat con PWAs cacheadas viejas.
- **Endpoints nuevos `GET/POST /api/admin/refund-tiers`** (patrón refund-percents:
  adminMiddleware + re-check `role==='admin'`). El POST valida los 3 períodos
  (todo-o-nada), guarda con `Config.set(..., username)` (queda QUIÉN lo cambió) y
  devuelve **`commandWarnings`**: los comandos `/sys_*` activos cuyo TEXTO
  menciona porcentajes (`\d%`) o "reembolso" (`_scanRefundTextCommands`) — esos
  NO se actualizan solos y el panel se los lista al admin para editarlos a mano.
- **Panel:** la card vieja "🎁 Porcentajes de reembolso" (refundPercents, sin uso
  desde #99) fue REEMPLAZADA (con lápida) por **"🏅 Rangos de reembolso"**: 3
  editores (Diario/Semanal/Mensual) con filas Nombre | pérdida hasta $ | %,
  agregar/quitar fila (máx 6, viene del backend), botón **"📋 Copiar Diario →
  Semanal y Mensual"**, confirm al guardar, y `alert` con los comandos a revisar
  si hay `commandWarnings`. Solo admin general (403 → card oculta). Los
  endpoints refund-percents del backend quedan (deprecados, nadie los llama).
- **PWA (refunds.js + index.html):** el modal de perfil muestra la escalera POR
  PERÍODO cuando son distintas (si las 3 son iguales, una sola tabla como
  siempre; backend viejo → fallback a `tiers`). Los textos hardcodeados
  "Reembolsos hasta 10%" / "3, 6 o hasta 10%" de infoModal/adServiceModal se
  GENERICIZARON y ahora `updateRefundLabels()` los completa con el % MÁXIMO real
  (`infoRefundsTitle`/`adRefundsTitle`).
- **Validado:** `node --check` OK (server, refundTiers, refunds.js, admin.js) +
  prueba en frío de normalizeTiers (cortes 30000/30001/100000/100001, escalera
  custom de 4 desordenada, errores de validación, auto-sin-techo). SW a **v77**.
  Back necesita redeploy. PROBAR: card nueva en el panel (solo admin general),
  cambiar la escalera de UN período y ver que el perfil de la PWA muestra 3
  tablas distintas y el % del botón cambia; guardar con umbrales repetidos →
  error claro; el alert de comandos lista los /sys_* con %.

### 117. Login solo con Soporte Telegram + logo del chat de soporte subible como IMAGEN
- **Pedido del owner:** (a) sacar el botón "Soporte WhatsApp" del login (el soporte
  por WhatsApp ya no existe; queda solo Telegram); (b) el "Logo del chat de soporte"
  del panel (Comunidad) solo aceptaba URL — ahora también se puede SUBIR un archivo
  de imagen.
- **Login (PWA):** eliminado el botón `helpWhatsappBtn` (index.html, con lápida) y su
  cableado en app.js. El botón de Telegram queda solo en la fila (ocupa todo el ancho).
  El endpoint `/api/config/soporte-vip` sigue devolviendo el bloque whatsapp (no se
  tocó el backend de eso; ya no lo consume nadie en el login).
- **Logo del chat como imagen (panel Comunidad):** input file + vista previa +
  botón "🗑️ Quitar" junto al campo URL de siempre. La imagen se procesa EN EL
  NAVEGADOR: recorte cuadrado centrado + resize a 128x128 por canvas → data URL
  (PNG si el archivo era PNG —conserva transparencia—, si no JPEG 0.85, ~5-40KB)
  y se guarda en `communityConfig.chatLogoUrl` al tocar "Guardar Comunidad".
  - **Backend (`POST /api/admin/community`):** rama nueva para el logo — acepta
    `data:image/(png|jpeg|webp|gif);base64,...` (cap 300KB, validado por regex) SIN
    pasarlo por `_normUrl` (lo rompía: prefijo https:// + recorte a 300 chars).
    Una URL normal sigue el camino de siempre.
  - **Sin cambios en la PWA:** chat.js ya hace `avatar.src = chatLogoUrl` y la CSP
    ya permite `img-src data:`. El body JSON acepta 10mb → la imagen entra bien.
  - **Lógica del form (admin.js):** `_communityLogoPending` (undefined=sin cambios,
    ''=quitar, data:...=imagen nueva) + `_communityLogoSaved`. Guardar con el input
    URL vacío NO borra una imagen subida (para borrar está "Quitar"); tipear una URL
    pisa la imagen. Un data URL guardado no se vuelca al input de texto (solo preview).
- **Validado:** `node --check` OK (server.js, app.js, admin.js, SW). SW a **v76**.
  Back necesita redeploy (rama nueva del logo). PROBAR: subir una foto en el panel →
  Guardar → la cabecera del chat del cliente muestra la foto; "Quitar" + Guardar →
  vuelve el logo default; login sin botón de WhatsApp.

## Sesión 2026-08-04

### 116. Avisos de formulario del navegador en ESPAÑOL (PWA + panel)
- **Síntoma (owner):** con contraseña corta o el número sin completar, el globo de
  aviso salía EN INGLÉS ("Please fill out this field"). Son los mensajes NATIVOS
  del navegador: salen en el idioma del SISTEMA e ignoran el `lang="es"`.
- **Fix:** interceptor global del evento `invalid` (captura, aplica a TODOS los
  formularios presentes y futuros) que reemplaza el texto vía `setCustomValidity`
  con mensajes en español según el tipo de error (vacío, muy corto — con variante
  para contraseñas —, email/URL inválidos, mín/máx, formato). Se limpia al tipear
  (`input`/`change`) para que el campo se revalide normal. Mismo snippet en la PWA
  (boot inline de index.html) y en el panel admin.
- **Validado:** parse OK de ambos interceptores. SW a **v75**. Solo front.

### 115. El teléfono del cambio de clave obligatorio se puede OMITIR temporalmente
- **Pedido del owner:** al entrar por el link del admin, el cambio de contraseña
  obligatorio está OK, pero el teléfono — que sigue siendo obligatorio a la larga —
  tiene que poder omitirse temporalmente para que el cliente conozca la página; al
  RETIRAR sí o sí debe verificar; y al omitir, avisarle que más adelante va a tener
  que verificar por SMS para evitar cuentas duplicadas.
- **Front only** (el backend YA soportaba cambiar la clave sin teléfono y el retiro
  YA exige teléfono verificado en 3 gates del server — verificado):
  - Botón **"⏭ Omitir por ahora (lo verificás más adelante)"** bajo el campo de
    WhatsApp — visible SOLO en el cambio obligatorio y sin teléfono verificado.
  - Al tocarlo: `confirm()` con el aviso ("podés entrar igual, pero verificar por
    SMS va a ser OBLIGATORIO para retirar y evita cuentas duplicadas") → guarda la
    clave sin teléfono (flag de un solo uso `_skipPhoneOnce`, se resetea siempre
    para que un submit normal no lo herede) + toast recordatorio al éxito.
  - Después de omitir: el banner "Verificá tu teléfono" (existente) queda visible
    empujando la verificación, y el retiro la exige (flujo existente).
  - Hint del campo actualizado: "Obligatorio para RETIRAR y recuperar tu cuenta".
- **Validado:** `node --check` OK (auth.js, app.js). SW a **v74**. Solo front — no
  necesita redeploy del back (pero conviene ir junto con lo pendiente). PROBAR:
  entrar con link de acceso → crear clave → "Omitir por ahora" → entra y ve el
  banner de verificación; intentar retirar → exige SMS.

### 114. Visto para el ADMIN, nivel VIP simplificado con T&C, "Página CASINO" en el menú y "Volver a Chat de cargas"
- **Visto del admin (espejo del #108):** ahora también el AGENTE ve ✓✓ en sus
  mensajes del panel — gris = enviado, celeste #53bdeb = el cliente lo vio en su
  app. Backend: `POST /api/messages/read-received` (lo llama la PWA al mostrar el
  chat — en loadMessages y al recibir un mensaje del agente con la app a la vista,
  con throttle CON COLA de 4s para que el último visto nunca quede colgado; NO toca
  los adminOnly) → marca `read:true` en los mensajes agente→cliente y emite
  `user_read_messages` a los admins; el panel pinta los ticks del chat activo en
  vivo. Ticks en `createMessageElement` del panel usando `message.read`.
- **Nivel VIP simplificado (perfil):** afuera el "apostado total" y el "te faltan
  $X de apuestas" — ahora es "🎁 Progreso de tu nivel para ganar $BONO" con barra y
  % solamente. El detalle (cómo suma, rakeback, escalera completa con umbrales) se
  movió a un desplegable "📄 Términos y condiciones" abajo (elemento <details>).
- **"Página CASINO" en el menú ☰** (mismo SSO de `VIP.ui.enterCasino`) + card nueva
  en Información del Servicio explicando que entra directo con la sesión iniciada.
- **Casino embebido:** el botón "✕ Cerrar" del recuadro pasó a decir
  "← Volver a Chat de cargas" (captura del owner).
- **Validado:** `node --check` OK (server, chat, socket, refunds, ui, admin). SW a
  **v73**. Back necesita redeploy (endpoint nuevo). PROBAR: mandar mensaje desde el
  panel con el cliente mirando la app → ✓✓ celeste en vivo; perfil → progreso simple
  + T&C desplegable; menú ☰ → Página CASINO entra logueado.

### 113. Bono de bienvenida con DOS tipos: monto sorpresa automático o bono en la próxima carga
- **Pedido del owner:** que el bono del código pueda ser (a) un **monto sorpresa que
  se acredita AUTOMÁTICO** al canjear, o (b) el **bono extra en la próxima carga**
  (manual: el agente lo suma y lo marca como usado — el flujo de #112).
- **Config nueva:** `communityWelcomeBonusType` (`cash` | `next_charge`, default
  next_charge). Selector en la card del panel — lo cambian admin general y depositor
  (misma regla que el monto). **Tipo y monto quedan CONGELADOS por cliente al
  canjear** (`User.welcomeCodeBonusType`).
- **Tipo `cash`:** la reserva atómica queda en 'pending' y recién con el crédito OK
  pasa a **'credited'** (enum nuevo). Reference **`vip-welcome-{userId}`** (uno por
  cuenta para siempre → imposible pagar dos veces, aunque se reintente). Si el
  crédito falla, la reserva se RESTAURA (guard en 'pending') y el cliente puede
  reintentar. Transaction type 'bonus' con `metadata.source:'welcome_code'` —
  agregado a los `GIFT_SOURCES` para que NO cuente como carga real en la analítica.
  Mensaje al cliente por **`/sys_welcome_code_cash`** (comando nuevo) y nota
  informativa al agente ("no hay que hacer nada"). El modal de la PWA muestra el
  recuadro verde "$X acreditados" y refresca el saldo del header.
- **Tipo `next_charge`:** sin cambios (#112) — banner azul + marcar como usado.
- **Panel:** banner nuevo para 'credited' (verde informativo, sin botón).
- **Validado:** `node --check` OK + parse del inline. SW a **v72**. Back necesita
  redeploy. PROBAR: canje con tipo cash (saldo sube solo, banner verde en el panel)
  y con tipo próxima carga (flujo manual de siempre).

### 112. CÓDIGO DE BIENVENIDA de la Comunidad de Telegram (bono sorpresa) + "Soporte 1Girox"
- **Pedido del owner:** (a) renombrar la cabecera del chat "Soporte VIPCARGAS" →
  **"Soporte 1Girox"**; (b) ítem "Código de Bienvenida" en el menú ☰: al entrar a la
  Comunidad de Telegram hay un código para usuarios nuevos que da un **bono
  sorpresa**; (c) monto editable en el panel por **admin general y depositor**;
  (d) código editable **solo por admin general**; (e) al canjear, recuadro para el
  admin y para el usuario con "$X de bono para la próxima carga" y que el admin lo
  marque como usado **igual que el bono 100%**.
- **Modelo (`User`):** `welcomeCodeBonusStatus` (none|pending|used, indexado),
  `welcomeCodeBonusAmount` (**CONGELADO al canjear** — cambiar la config después no
  altera bonos ya dados), `welcomeCodeClaimedAt/UsedAt/UsedBy`. **Una vez por cuenta
  PARA SIEMPRE**, aunque el código cambie (reserva atómica con `$nin`).
- **Config:** `communityWelcomeCode` + `communityWelcomeBonusAmount`.
  `GET/POST /api/admin/community-code`: monto → admin general y depositor; código →
  SOLO admin general (a un depositor el GET ni le devuelve el código y el panel le
  oculta el campo). Card nueva en Config → "🎁 Código de bienvenida".
- **Canje:** `POST /api/community-code/claim` (auth + authLimiter). Coincidencia
  case-insensitive. El monto NO se revela antes de canjear (es sorpresa: el status
  sólo lo devuelve con pending/used). Al canjear: mensaje de sistema al cliente
  (**`/sys_welcome_code`** nuevo, editable en COMANDOS) + nota admin-only en el chat
  ("BONO SORPRESA PENDIENTE ($X)") — calco del flujo #100.
- **Panel:** banner AZUL en el chat cuando está pendiente (con monto y botón
  "Marcar como usado" → `POST /api/admin/users/:id/welcome-code-bonus/use`, marca
  atómica pending→used con quién/cuándo); gris cuando ya se usó. Div propio
  (`chatWelcomeCodeBanner`) para no pisar el banner del bono 100%.
- **PWA:** menú ☰ → "🎁 Código de Bienvenida" abre un modal con la explicación +
  input de canje; si ya canjeó muestra el recuadro "tenés $X esperando tu próxima
  carga"; si ya lo usó, el estado gris.
- **Validado:** `node --check` OK (server.js, User.js, admin.js) + parse del script
  inline. SW a **v71**. Back necesita redeploy. PROBAR: configurar código y monto en
  el panel, canjearlo desde la app (recuadro azul en el chat del panel), sumar el
  bono en una carga y marcarlo usado; reintentar canje → rechazado.

### 111. Link de acceso de UN SOLO USO + modal de clave estilo WhatsApp + sin logout
- **Pedido del owner:** (a) sin botón de cerrar sesión; (b) crear usuarios desde el
  panel con un link de un solo uso que loguee automáticamente al abrirlo (y no sirva
  más), regenerable desde el panel; (c) al entrar por el link, recuadro para crear
  una contraseña nueva segura; (d) todo con diseño tipo WhatsApp claro/oscuro.
- **Backend:**
  - `User.accessLinkHash` (+`accessLinkCreatedAt`): se guarda SOLO el sha256 — el
    link en claro lo ve únicamente el admin al generarlo (un dump de la base no
    regala logins). Token: 24 bytes random base64url (192 bits).
  - `POST /api/admin/users/:userId/access-link` — **admin general y depositor**
    (decisión del owner: los depositors también dan de alta clientes;
    withdrawer/comunidad/publisher_admin NO). Regenerar pisa el hash → el anterior
    muere. Solo cuentas role 'user' no bloqueadas.
  - `POST /api/auth/access-link` (público + authLimiter): canje **single-use a
    prueba de carreras** — el findOneAndUpdate borra el hash y setea
    `mustChangePassword:true` + lastLogin en el MISMO paso; dos aperturas
    simultáneas → una sola gana. Emite el mismo JWT de 30d del login. Error
    genérico a propósito (no revela si el link existió).
- **PWA:** `VIP.auth.tryAccessLink()` corre PRIMERO en el arranque (app.js): lee
  `?acceso=`, LIMPIA la URL del historial antes de canjear, guarda el JWT y deja
  que `verifyToken()` complete la sesión — el flujo `mustChangePassword` existente
  abre solo el recuadro obligatorio de contraseña nueva.
- **Recuadro de contraseña — look WhatsApp** (claro y oscuro vía `body.wa-dark`):
  tarjeta blanca/#202c33, inputs pill #f0f2f5/#2a3942, botón verde #00a884.
  **Contraseña segura**: piso del FRONT subido a 8+ caracteres con letras y números
  (el server sigue aceptando ≥6 para no romper claves viejas en el login).
- **Panel:** al crear un usuario cliente (admin general) se genera el link solo y
  aparece un modal con el link + botón copiar; en la tabla de Usuarios hay un botón
  🔗 "Generar link de acceso" (= regenerar) por cliente.
- **Sin logout:** eliminado el botón "Cerrar sesión" del menú ☰ (llevaba oculto por
  default desde siempre; el listener de app.js queda inerte con su guard).
- **Validado:** `node --check` OK en los 5 JS. SW a **v70**. Back necesita redeploy.
  PROBAR tras deploy: crear un usuario desde el panel → copiar el link → abrirlo en
  incógnito (entra logueado + modal de contraseña estilo WhatsApp) → abrirlo de
  nuevo (rechazado, ya usado) → regenerar con 🔗 y repetir.

### 110. Wording: "Unite al canal de Telegram" → "Unite a la Comunidad de Telegram"
- Pedido del owner. Cambiado en el pill del header, el ítem del menú ☰ y el texto de
  ayuda del panel. Solo texto — misma config y mismos IDs. SW a **v69**.

### 109. FIX "Instalar App" roto en el menú + layout adaptable sin scroll ni recortes
- **Síntoma (captura del owner):** el ítem "Instalar App" del menú ☰ se veía diminuto
  y con otro estilo. **Causa:** conserva su clase histórica `.app-install-btn`, que
  tiene CSS propio en header.css (fondo verde con glow animado) y en responsive.css
  (`font-size: 7-9px !important` en mobile) → pisaba al estilo del menú.
  **Fix:** blindaje de `.main-menu .menu-item` con `!important` en todo (fondo,
  padding, font, animación) — cubre también .notification-btn/.settings-btn/
  .logout-btn que tienen overrides similares.
- **Scroll:** la página YA no scrollea nunca (body overflow:hidden de siempre). El
  riesgo real era el inverso: en pantallas bajas el contenido se RECORTABA invisible
  (homePanel no cedía espacio y chat-section corta con overflow:hidden). Ahora:
  - `#homePanel` con `flex:0 1 auto + min-height:0 + overflow-y:auto` → cede espacio
    y, si aun compactado no entra, scrollea ADENTRO (nunca se pierde contenido).
  - `.chat-container` con `min-height:170px` (140px en pantallas muy bajas) → el
    chat siempre queda visible aunque el dashboard esté desplegado.
- **Adaptación por tamaño:** media queries nuevas por ALTURA en responsive.css
  (`max-height:760px` y `max-height:640px`) que compactan dashboard, cabecera del
  chat y barra de escribir en celulares bajitos y notebooks. En monitores grandes
  no cambia nada (el dash ya estaba limitado a 680px centrado).
- **Validado:** SW del cliente a **v68**. PROBAR: el menú ☰ con "Instalar App" ahora
  uniforme; en un celular chico, desplegar todo el dashboard → el chat sigue visible
  y el panel scrollea internamente; en desktop todo igual.

### 108. PWA: tildes de leído estilo WhatsApp, oscuro por default, toggle a la vista, CBU con etiqueta, soporte Telegram y logo del chat configurables
- **Pedido del owner (6 puntos):**
  1. **"CBU" abajo de la tarjeta** de la barra del chat (`.wa-btn-label`, 8px) — para
     que se sepa que ese botón pide el CBU ACTIVO. `.wa-icon-btn` pasó a columna.
  2. **"Información de nuestro servicio" en el menú ☰** — dispara `infoBtn.click()`
     para no duplicar la lógica (diagnósticos + reseñas del handler real).
  3. **Soporte 24/7 con logo de TELEGRAM** (SVG del avioncito celeste). La URL sale
     de Comunidad → `supportUrl` (la misma del botón del dashboard); si no está
     configurada, el botón del menú aparece IGUAL con su href por defecto.
  4. **Logo del chat de soporte configurable**: campo nuevo "Logo del chat" en el
     panel (Comunidad) → `communityConfig.chatLogoUrl` → chat.js lo aplica a la
     cabecera (`#chatTopbarAvatar`). Vacío = ícono de VIPCARGAS. La CSP ya permite
     `img-src https:` → cualquier imagen HTTPS sirve.
  5. **Modo OSCURO por default** (el boot inline aplica `wa-dark` salvo
     `waDark==='0'` explícito) + **toggle a la vista**: botón 🌙/☀️ en la cabecera
     del chat (`#themeToggleBtn`), sincronizado con el switch de Configuración vía
     `applyWaDark` (app.js). El ícono muestra a qué modo se cambia.
  6. **Tildes estilo WhatsApp en los mensajes del cliente**: ✓✓ gris = enviado,
     ✓✓ CELESTE **#53bdeb** (el mismo tono del "leído" de WhatsApp) cuando un admin
     abre el chat. Estado inicial de `message.read` (los mensajes ya lo traían);
     el flip en vivo: `POST /api/messages/read/:userId` (lo llama el panel al abrir
     el chat) ahora TAMBIÉN emite `messages_read_by_admin` a `user_{id}` y
     socket.js pinta todos los `.msg-ticks`. Ticks en SVG (no emoji) para que se
     vean iguales en todos los OS.
- **Validado:** `node --check` OK (server.js, chat.js, socket.js, app.js, admin.js).
  SW del cliente a **v67**. Back necesita redeploy (evento nuevo + config extendida).
  PROBAR tras deploy: mandar un mensaje (✓✓ gris) y abrir el chat desde el panel
  (→ celeste en vivo); tocar 🌙/☀️; cargar un logo en el panel y ver la cabecera.

### 107. Canal de Telegram UNIFICADO con la Comunidad (una config, un botón)
- **Pedido del owner:** el canal de Telegram y la comunidad de Telegram son LO MISMO —
  dejar uno solo, sin botones duplicados.
- **Config única:** `communityConfig.channelUrl` (panel → "📣 Comunidad / Canal de
  Telegram"). El pill celeste del header y la opción del menú ☰ ahora leen
  `GET /api/config/community`. `GET /api/config/community` conserva fallback de
  lectura al `canalInformativoUrl` viejo (por si había quedado una URL cargada ahí).
- **ELIMINADO (con lápidas):** la sección "Canal de Telegram" del panel (creada en
  #106, duró un día), `loadCanalUrlConfig`/`saveCanalUrl` (admin.js), los endpoints
  `GET /api/config/canal-url` y `POST /api/admin/canal-url` (server.js), y el botón
  "Canal Exclusivo" del dashboard de la PWA (`communityChannelBtn`) que duplicaba el
  pill del header. El botón "Soporte Telegram" del dashboard QUEDA (es otra cosa).
- **Validado:** `node --check` OK (server.js, chat.js, admin.js). Grep: 0 referencias
  vivas a lo eliminado. SW del cliente a **v66**. Back necesita redeploy (endpoints
  eliminados). PROBAR tras deploy: cargar el canal en Comunidad → pill del header y
  opción del menú apuntan ahí; el dashboard muestra solo Soporte.

### 106. Botón "Unite al canal de Telegram" (header + menú ☰), configurable desde el panel
- **Pedido del owner** (con captura de referencia): botón celeste estilo Telegram para
  el canal, configurable desde el panel admin; achicar el recuadro de "Información de
  nuestro servicio" para hacerle lugar; y que también aparezca en el menú hamburguesa.
- **Se REUTILIZÓ la config existente** `canalInformativoUrl` (Config → sección del
  panel, endpoint `GET /api/config/canal-url` + `POST /api/admin/canal-url`): no se
  creó nada nuevo en el backend. La sección del panel se renombró a "📣 Canal de
  Telegram" con la explicación de dónde aparece el botón.
- **Header de la PWA:** ahora es [ℹ️ Info del servicio (compacto) | 📣 Unite al canal
  de Telegram (pill celeste con glow, flex:1) | ☰]. Sin URL configurada el pill no
  aparece y el ☰ queda pegado a la derecha (margin-left:auto).
- **Menú ☰:** la opción "Canal Informativo" pasó a "📣 Unite al canal de Telegram"
  (texto celeste). `chat.js loadCanalInformativoUrl` setea LOS DOS botones (header +
  menú) con la misma URL.
- **UPDATE (mismo día, pedido del owner):** el botón aparece **SIEMPRE**, aunque la
  URL esté vacía — en ese caso lleva a `https://vipcargas.com/canal-proximamente`
  (404 del dominio PROPIO a propósito: un t.me inventado lo podría registrar
  cualquiera y quedarse con los clicks de todos los clientes).
- **Validado:** `node --check` OK (chat.js). SW del cliente a **v65**. PROBAR tras
  deploy: sin URL en el panel el pill aparece igual (y da 404 al tocarlo); al cargar
  la URL real, los dos botones llevan al canal.

### 105. Descubribilidad del perfil: CTA en el recuadro USUARIO + "Mi Perfil" en el menú
- **Pedido del owner:** que se note que el recuadro del usuario (al lado de los
  reembolsos) se puede tocar para ver el nivel y los reembolsos, y que el perfil
  también esté en el menú hamburguesa.
- Recuadro USUARIO: pill dorado pulsante **"NIVEL Y REEMBOLSOS ▾"** debajo del nombre
  (`.dash-user-cta`, animación de opacidad suave). Sigue visible con "Ocultar menú"
  (el recuadro vive en `.dash-top`).
- Menú ☰: opción **"👤 Mi Perfil (nivel y reembolsos)"** como primera fila — abre el
  mismo `VIP.refunds.showProfileModal()` que el recuadro.
- SW del cliente a **v63**.

### 104. PWA: menú hamburguesa, barra de chat 100% WhatsApp, fueguito a la cabecera, info y referidos al día
- **Pedido del owner** (con foto de referencia de la barra de WhatsApp): (a) menú
  hamburguesa arriba a la derecha con todo adentro, (b) referidos más explicativo,
  (c) botón de soporte con logo de soporte, (d) "Información de nuestro servicio"
  estaba vieja, (e) barra de escribir idéntica a WhatsApp (claro y oscuro), con la
  cámara igual a la de WhatsApp y el CBU como ícono del mismo estilo, y (f) el
  fueguito FUERA de la barra.
- **Menú hamburguesa (☰):** el header queda [Información de nuestro servicio | ☰].
  Todo lo demás vive en el desplegable: Mis Referidos, Soporte 24/7 (con **auricular
  SVG**, el logo universal de soporte — antes era un 💬 anónimo), Notificaciones,
  Instalar App, Canal Informativo, Configuración y Cerrar sesión.
  ⚠️ **Los IDs de los botones NO cambiaron** (referralBtn, notificationBtn,
  appInstallBtn, settingsBtn, logoutBtn, canalInformativoBtn): el cableado de
  app.js/ui.js/el inline de FCM los busca por id y los encuentra igual dentro del
  menú. El inline de FCM REESCRIBE el innerHTML del botón de notificaciones
  ('🔔 NOTIS', '🔕', etc.) — la fila del menú lo tolera (muestra ese texto).
  El menú se ancla al header (va DENTRO del <header>, position:relative) y se
  cierra tocando afuera o al elegir una opción.
- **Barra de chat = réplica de la foto:** fondo beige (#f0ebe3), input pill blanco
  con placeholder "Mensaje", íconos SVG de **trazo fino sin fondo** (como WhatsApp,
  se ven iguales en todos los OS): tarjeta = pedir CBU (antes pill violeta "💳 CBU"),
  cámara idéntica a la de WhatsApp = enviar foto (antes 📸 en círculo blanco), send
  circular verde (ya estaba). Modo oscuro: íconos #aebac1 sobre la barra #1f2c33.
  Se quitó la clase `action-btn` de esos botones (nueva clase `wa-icon-btn`).
- **Fueguito:** salió de la barra → esquina DERECHA de la cabecera "Soporte
  VIPCARGAS" (`.fire-topbar-btn`, mismo id fireBtn + badge fireStreak). Se eligió la
  cabecera porque queda siempre visible sin ensuciar la barra estilo WhatsApp.
- **Referidos:** el modal ahora explica el sistema en 3 pasos numerados (compartir →
  amigo juega → cobrás el **8% mensual de la pérdida neta de tus referidos, de por
  vida**) con ejemplo concreto ($100.000 de pérdida → $8.000). El 8% verificado en
  `referralCalculationService`/`utils/referralRate` — es config
  (`GIROX_REFERRAL_COMMISSION_PCT`): si el owner lo cambia, actualizar el copy.
- **Información del servicio (infoModal + adServiceModal) actualizada:** afuera los
  20/10/5% viejos (eran de JUGAYGANA) → reembolsos por rango hasta 10%, niveles VIP
  + rakeback semanal, fueguito, ruleta, referidos 8%, bono de instalación = **100%
  en la próxima carga** (ya no "$5.000"), bonos hasta 30% y soporte 24/7. Los DOS
  modales dicen lo mismo (uno compacto) — mantenerlos a la par.
- **Validado:** tags balanceados, `node --check` N/A (HTML/CSS), sintaxis del script
  inline verificada aparte. SW del cliente a **v62**. PROBAR tras deploy: abrir/cerrar
  el menú (y que cada opción siga funcionando, en especial NOTIS e Instalar App),
  mandar foto y pedir CBU desde los íconos nuevos, fueguito desde la cabecera, y el
  modo oscuro de la barra.

### 103. On/off de los niveles VIP desde el panel (solo admin general) — reemplaza la env
- **Pedido del owner:** que los niveles se apaguen desde el administrador (solo admin
  general), en vez de la env `VIP_LEVELS_DISABLED` (que se eliminó).
- **Backend:** flag **`vip_levels_disabled` en Config** + `GET/POST /api/admin/vip-levels`
  (adminMiddleware + re-chequeo `role==='admin'` explícito, mismo patrón que
  refund-percents). Se guarda con `Config.set(..., req.user.username)` para que quede
  registrado QUIÉN lo cambió. `vipLevelService.isDisabled(Config)` ahora lee de la base
  **sin cache a propósito**: con multi-instancia en EB, un cache haría que el apagado
  tarde en llegar a las otras instancias (misma razón por la que getConfig no cachea,
  ver #91). Ante error de DB → se asume ENCENDIDO (mejor un tick de más que congelar
  los niveles por un hipo de conexión). Lo chequean el tick, el sweep,
  `/api/vip/status` y el claim de rakeback.
- **Panel:** card "👑 Niveles VIP" en la sección Config (junto a % de reembolso y
  fueguito), oculta para roles que no son admin general (mismo patrón: si el GET da
  403, se esconde). Muestra el estado (🟢 ACTIVADOS / 🔴 APAGADOS) y un botón con
  `confirm()` que explica las consecuencias antes de cambiar.
- **Qué pasa al apagar:** el motor no acumula ni paga, y la PWA oculta la sección
  (status responde `enabled:false`). **No se pierde nada**: al reactivar, el sweep
  recalcula los meses con $set y el acumulado se pone al día solo.
- **Validado:** `node --check` OK (server.js, vipLevelService.js, admin.js).
  PROBAR tras deploy: la card aparece SOLO al admin general, apagar → el perfil de la
  PWA deja de mostrar la sección VIP, encender → vuelve.

### 102. NIVELES VIP por apostado acumulado (réplica del programa de Stake) + rakeback semanal
- **Pedido del owner:** replicar el sistema de niveles de Stake ("fuera del cashback",
  o sea ADEMÁS de los reembolsos que ya existen). Decisiones tomadas por el owner:
  umbrales de Stake **convertidos a pesos a $1.500/USD** (configurable), bono de
  subida de nivel **automático**, **rakeback semanal desde la v1** y los reembolsos
  pasan a mostrar **solo el %** (los nombres Bronce/Plata/Oro quedan exclusivos del
  nivel VIP).
- **Cómo funciona (espejo de Stake):** se progresa por el **APOSTADO acumulado de por
  vida** (no pérdidas ni depósitos — cada apuesta suma, gane o pierda; el nivel NUNCA
  baja). Escalera en `src/utils/vipLevels.js` (14 niveles): Bronce $15M ARS, Plata
  $75M, Oro $150M, Platino I–VI $375M→$15.000M, Diamante I–V $37.500M→$750.000M.
  Cada nivel destraba: **bono one-time** al alcanzarlo (~0,07% del umbral, el ratio
  de Stake: Bronce $10.000 … Platino VI $10M) y **rakeback semanal** creciente
  (0,10% Bronce → 0,65% Diamante V, sobre el apostado de casino de la semana pasada).
  Todo editable en la tabla del archivo; la tasa USD→ARS con `VIP_USD_ARS_RATE`.
- **⚠️ Advertencia dada al owner (decisión suya igual):** con ×1500 el primer nivel
  pide $15M ARS apostados y 1girox arrancó hace días con todos en ~cero → va a pasar
  tiempo hasta la primera medalla. Si el enganche resulta lento, se bajan los números
  de la tabla y listo.
- **El acumulado (diseño anti-doble-conteo):** la Partner API no tiene "apostado
  histórico" (stats por rango, máx 92 días) → buckets mensuales **`VipWagerMonth`**
  (único por userId+monthKey) que el motor escribe SIEMPRE con `$set` (nunca `$inc`):
  recalcular es idempotente y multi-instancia-safe sin locks. `User.lifetimeWagered`
  es cache de la suma y sólo se actualiza con `$max` (un recálculo parcial no pisa un
  total mayor). `User.vipLevel` nunca baja (guard `$lt` al avanzar).
- **Motor (`src/services/vipLevelService.js` + cron en server.js):**
  - **tick cada 30 min**: refresca el mes corriente de los activos recientes
    (`VIP_ACTIVE_DAYS`=3) con el batch de stats (100 usuarios por request).
  - **sweep diario a las 05 ART**: TODOS los usuarios + cierra meses pasados
    faltantes desde `VIP_WAGER_EPOCH` (2026-07) → **el backfill es automático, no
    hay script aparte**. Instancia única por día vía claim atómico en Config
    (`vip_sweep_day`, el índice único de key es la barrera).
  - **Bono de nivel:** reference `vip-lvl-{userId}-{idx}` → idempotente PARA SIEMPRE.
    Orden: primero acreditar, después avanzar vipLevel — si el crédito falla se
    reintenta en el próximo sync con LA MISMA reference; `duplicate:true` = otra
    instancia ya pagó → no se re-notifica. Aviso al cliente por chat+push, editable
    en COMANDOS (**`/sys_vip_levelup`** nuevo, sembrado en initializeData).
  - Kill switch sin deploy: `VIP_LEVELS_DISABLED=1`. De paso el batch persiste
    `giroxUserId` gratis (mismo hábito que los reembolsos).
- **Rakeback semanal:** `GET /api/vip/status` + `POST /api/vip/rakeback/claim`.
  Mismo candado que los reembolsos (#96): reserva atómica con RefundClaim type
  **`rakeback`** (enum ampliado; periodKey `rake:{lunes}`) ANTES de acreditar,
  reference `vip-rake-{lunes}-{userId}`, si el crédito falla se borra la reserva.
  Semana = lunes-domingo pasado en hora ART (mismo `periodRanges` del reembolso
  semanal). Transaction types nuevos: `rakeback` y `vip_levelup` (NO son 'deposit'
  a propósito — la analítica de cargas reales no se contamina).
- **PWA (refunds.js + index.html, SW → v61):** el modal de perfil ahora muestra el
  nivel con barra de progreso, cuánto falta para el próximo (y su bono), el botón de
  reclamo del rakeback y la escalera completa (viene del backend, no se duplica).
  El recuadro USUARIO muestra la medalla del nivel. Las medallitas de los reembolsos
  pasaron de 🥉/🥈/🥇 a un pill con el % — pedido explícito para que las dos escalas
  no se confundan.
- **Panel:** medalla + nombre del nivel en la cabecera del chat y medalla en la tabla
  de Usuarios (`vipLevel lifetimeWagered` sumados a USERS_LIST_FIELDS; el backend
  manda `vipLevelInfo` resuelto para no duplicar la escalera en el front).
- **Docs:** ARCHITECTURE actualizado — además de lo nuevo, se corrigieron secciones
  que habían quedado STALE de la v1.9 (#101): §4.6 todavía describía el scraping del
  panel eliminado, §4.8 listaba las `GIROX_ADMIN_*` muertas y §5 decía que sin
  `giroxUserId` no había reembolso.
- **Validado:** `node --check` OK en los 10 archivos tocados. Cortes de la escalera
  verificados en frío ($14.999.999→sin nivel, $15.000.000→Bronce, tope Diamante V,
  override de tasa por env). **PROBAR tras deploy:** `GET /api/vip/status` con un
  usuario real, esperar un tick (30 min) y ver `lifetimeWagered` moverse, el sweep a
  las 05 ART en logs (`[vip] sweep`), y reclamar un rakeback el lunes.

## Sesión 2026-08-01 (sin entrada en su momento — reconstruida del git log)

- Commits `418cd88`/`ea8b942`/`bc5ee1f`/`fda8c0f`: look de WhatsApp en el chat del
  cliente (cabecera "Soporte en línea", botón enviar, modo oscuro, fondo con patrón
  de garabatos claro/oscuro + fix del fondo que se colaba entre el chat y la barra).
  SW del cliente quedó en **v60**. Commit `4fd0c49` ("test auth", 2026-08-03) es un
  commit VACÍO — prueba de autenticación de git, sin cambios.

## Sesión 2026-07-31

### 101. Partner API v1.9: se cae el scraping del panel — netwin, batch e ID por API
- **Contexto:** 1girox publicó las versiones **1.8 y 1.9** y dieron TODO lo que se les
  había pedido. Se eliminan de un saque los tres puntos frágiles que quedaban.
- **Lo que resolvieron:**
  | Novedad | Qué reemplaza |
  |---|---|
  | `GET /players/{username}/stats` | El netwin que sacábamos del PANEL con scraping |
  | `POST /players/stats/batch` (100 por request) | El batching artesanal de referidos |
  | `GET /players/{username}` ahora trae `id` | La búsqueda del ID en `/users/fetch` (body adivinado) |
  | `GET /config` | Adivinar qué feats/multiplicadores están habilitados |
  | `POST /players/{username}/bonus/claim` | Bonos que quedaban bloqueados sin reclamar |
- **🔥 `giroxReportsService.js` ELIMINADO.** Era el punto más frágil de toda la
  integración: pegaba contra `admin.1girox.com` con un Bearer de sesión auto-renovable,
  parseaba un payload base64+deflate, y resolvía el ID con un filtro que nunca pudimos
  confirmar. Todo eso desapareció. Con él se van `GIROX_ADMIN_USER`, `GIROX_ADMIN_PASS`,
  `GIROX_ADMIN_TOKEN`, `GIROX_ADMIN_BASE_URL` y `GIROX_AGENT_USER_ID`.
- **Reembolsos:** los 3 claims y el status pasan a `girox.getPlayerStats(username, ...)`.
  Se ELIMINÓ el gate "Tu cuenta no está vinculada a la plataforma" que abortaba si no
  había ID numérico: ya no aplica (el netwin va por username) y sólo servía para negarle
  el reembolso a alguien que sí podía cobrarlo. El ID igual se persiste **gratis**, con
  el que devuelve el propio `stats`.
- **Referidos:** `referralCalculationService` usa el batch. Para 59 referidos pasó de
  **59+ requests a 1**. Se eliminó `REVENUE_CONCURRENCY`.
  ⚠️ Efecto colateral a tener en cuenta: los referidos que antes quedaban en $0 por no
  tener `giroxUserId` ahora SÍ generan comisión. Si se recalcula un período viejo ya
  pagado, van a aparecer deltas a pagar.
- **FIX de huso horario en `getPeriodRange`** (`src/utils/periodKey.js`): armaba las
  fechas con `new Date(year, month-1, 1)`, o sea en la hora LOCAL DEL PROCESO. En
  producción el server corre en UTC → "1 de julio 00:00" era en realidad "30 de junio
  21:00" hora argentina: el período de comisiones arrancaba y terminaba 3 horas antes, y
  esas 3 horas se contaban en DOS meses. Ahora se anclan a -03:00 explícito. Verificado
  con el server en UTC, incluido febrero bisiesto.
- **`GET /api/admin/girox/health`** ya no reporta el panel; en su lugar muestra la
  configuración real de la plataforma (rollover, bonos, multiplicadores, límites).
- **Validado:** `node --check` OK en los 18 archivos. Grep: 0 consumidores del servicio
  eliminado.


### 100. El bono por instalar la app pasa a ser 100% en la próxima carga (lo aplica el agente)
- **Pedido del owner:** reemplazar los $5.000 que se acreditaban gratis por un **100% en
  la próxima carga**; que al reclamarlo le aparezca al agente que el cliente lo tiene
  pendiente, y que una vez marcado como usado no se pueda volver a reclamar. Una sola vez
  por usuario.
- **Cambio de fondo:** el reclamo **YA NO ACREDITA PLATA**. Antes `POST /api/install-bonus/claim`
  llamaba a la plataforma y depositaba $5.000. Ahora sólo deja el bono en estado `pending`;
  la plata se mueve recién cuando el cliente carga y el agente le duplica el monto a mano.
  Motivo del owner: el bono en efectivo se lo llevaban cuentas que no cargaban nunca.
- **Modelo (`User`):** `firstChargeBonusStatus` (`none`|`pending`|`used`, indexado),
  `firstChargeBonusUsedAt`, `firstChargeBonusUsedBy`. `installBonusClaimed` se conserva
  como el candado de "una vez por cuenta" (ya tenía las defensas anti-multicuenta:
  standalone + token FCM + teléfono verificado + dispositivo).
- **Aviso al agente:** al reclamar se emite una nota admin-only en el chat del cliente
  ("BONO 100% PENDIENTE"). Sin esto el agente sólo se enteraría si el cliente se acuerda
  de decírselo, y el bono quedaría colgado o se aplicaría dos veces.
- **`POST /api/admin/users/:userId/first-charge-bonus/use`** (adminMiddleware): marca
  `pending → used` de forma ATÓMICA (findOneAndUpdate con el estado en el filtro), así dos
  agentes tocando el botón a la vez no se pisan. Registra quién y cuándo, y deja otra nota
  admin-only para que cualquier agente posterior vea que ya se aplicó.
- **Panel:** banner verde en el chat cuando está pendiente, con botón "Marcar como usado"
  (con confirmación, porque es plata y no se deshace). Cuando ya se usó, banner gris con
  quién lo aplicó. Se limpia al cambiar de chat — si no, el agente vería el bono del
  cliente ANTERIOR y podría dárselo a quien no le corresponde.
- **PWA:** el cartel pasó de "Bono de $5.000" a "100% de bono en tu próxima carga";
  el botón, a "Reclamar mi 100%".
- **FIX del menú colapsable (#99):** el selector escondía los reembolsos. `.dash-top` NO
  es hijo directo de `#homePanel` — está dentro de `.home-dash`, así que
  `#homePanel.collapsed > *:not(.dash-top)` ocultaba `.home-dash` entera y se llevaba los
  reembolsos puestos. Ahora son dos reglas. El botón RETIRAR MI PREMIO ya estaba fuera del
  panel, así que sigue visible.
- **Validado:** `node --check` OK en los 6 archivos tocados. SW del cliente a **v56**.


### 99. Rangos de reembolso (Bronce/Plata/Oro) + perfil del jugador + menú colapsable
- **Pedido del owner:** sistema de niveles para los reembolsos, que al tocar el perfil se
  vea el detalle y cuánto falta para subir, y que "Ocultar menú" deje sólo los reembolsos.
- **RANGOS — `src/utils/refundTiers.js` (nuevo):**
  | Pérdida del período | Rango | Reembolso |
  |---|---|---|
  | hasta $30.000 | 🥉 Bronce | 3% |
  | $30.001 a $100.000 | 🥈 Plata | 6% |
  | más de $100.000 | 🥇 Oro | 10% |
- **⚠️ El rango se calcula sobre la pérdida DEL PERÍODO QUE SE RECLAMA**, no sobre un
  acumulado histórico (decisión del owner, se le ofrecieron las 3 opciones). Consecuencia:
  un mismo jugador puede ser Oro en el mensual y Bronce en el diario al mismo tiempo — son
  períodos distintos. La UI lo aclara para que nadie crea que "bajó de categoría".
- **Reemplaza a los porcentajes fijos** (eran 20/10/5 configurables desde el panel). El
  endpoint `/api/admin/refund-percents` se conserva para no romper el front pero ahora
  devuelve `enUso:false` + un aviso, así el admin no cree que cambiando eso cambia algo.
- **Aplicado en los 4 lugares**: `/api/refunds/status` (los 3 potenciales) y los 3
  `POST /api/refunds/claim/*` (que son los que pagan de verdad).
- **Front:** medallita del rango sobre cada botón de reembolso, y el recuadro USUARIO
  ahora es clickeable → modal de perfil con usuario, saldo, el rango de cada reembolso,
  cuánto falta para subir al siguiente, y la escala completa. La escala la manda el
  backend (`tiers`) para no duplicar los umbrales en el front.
- **"Ocultar menú"** ahora deja sólo la fila de reembolsos + perfil (`.dash-top`): oculta
  casino/saldo, comunidad, bono de instalación y —a pedido— el cartel de verificar
  teléfono, que vive FUERA del panel y lo esconde el JS recordando si estaba visible
  (si no, reaparecería en usuarios que ya verificaron).
- **Validado:** `node --check` OK. Cortes verificados: $30.000→Bronce, $30.001→Plata,
  $100.000→Plata, $100.001→Oro. SW del cliente a **v55**.


### 98. FIX post-migración: el alta del panel no creaba al jugador + red de seguridad en la carga
- **Síntoma reportado por el owner:** "creé un usuario en VIPCARGAS y no se creó en 1girox,
  y el botón CASINO no abre la sesión directo".
- **Causa raíz — hay DOS endpoints de alta y el panel usa el que nunca sincronizó:**
  `POST /api/users` (L5245) sí creaba el jugador en la plataforma, pero el panel llama a
  `POST /api/admin/users` (L13672), que **sólo creaba el usuario local**. Esto NO lo rompió
  la migración: venía de antes. No se notaba porque **JUGAYGANA creaba la cuenta sola
  dentro de `depositToUser`** (3 intentos de CREATEUSER + re-lookups), así que el jugador
  aparecía en la plataforma recién en la primera carga. **1girox no hace eso**: devuelve
  `player_not_found` y la carga falla → la cadena se cortó al migrar.
- **Fix en 3 capas:**
  1. `POST /api/admin/users` ahora **crea al jugador en la plataforma con await** y
     devuelve `platformWarning` si falla (antes, con el fire-and-forget de `/api/users`,
     un fallo no dejaba ni rastro: el agente veía "creado exitosamente", el estado quedaba
     en `pending` para siempre y el cliente terminaba sin cuenta sin que nadie se enterara).
     Ante error se persiste `giroxSyncStatus:'error'` + `giroxSyncError`.
  2. **Red de seguridad en `girox.depositToUser`:** si la plataforma responde
     `player_not_found`, se crea el jugador al vuelo y se reintenta UNA vez **con la misma
     reference** (sigue siendo idempotente). Replica lo que hacía JUGAYGANA y cubre a
     cualquier usuario que haya quedado sin cuenta (alta vieja, migración incompleta, caída
     momentánea de la API). Sin esto, un cliente que transfirió no se podía cargar.
  3. **Validación de username en los 3 puntos de alta** (`/api/users`, `/api/admin/users`,
     `check-username`): las reglas de VIPCARGAS son más permisivas (3-30 con punto y guion)
     que las de 1girox (3-18, sólo letras/números/_). Antes se podía crear `juan.perez`
     localmente y ese usuario **nunca** iba a poder existir en el casino.
- **Sync de contraseñas en el login: RE-ACTIVADO** (`GIROX_SYNC_PASSWORD_ON_LOGIN=0` lo
  apaga). Se había dejado apagado por el rate limit, pero ahora es necesario: los jugadores
  auto-creados (por la migración o por la red de seguridad de la carga) tienen contraseña
  random y sin este sync no podrían entrar nunca a 1girox.com por fuera del SSO. Corre una
  sola vez por usuario.
- **Nuevo `GET /api/admin/girox/health`** — diagnóstico en un solo lugar: qué env vars están
  presentes (nunca los valores), si la Partner API responde, si el panel de reportes
  autentica, y el estado de la base (cuántos usuarios sincronizados / pendientes / con error
  / con username inválido / sin ID de plataforma). Es lo primero a mirar ante cualquier
  "no funciona".
- **Auditados los 8 puntos de `User.create` del repo:** los 6 restantes están bien (registro
  sincroniza antes de crear; el auto-import del login viene DE la plataforma; los otros crean
  cuentas internas admin/publisher_admin, que no son jugadores).
- **⚠️ EL BLOQUEANTE SIGUE SIENDO `GIROX_API_URL`.** Mientras esa variable no esté cargada,
  `girox.isEnabled()` es false y NADA funciona: ni altas, ni cargas, ni retiros, ni el botón
  CASINO. Los síntomas reportados son exactamente eso. El endpoint de health lo dice explícito.

### 97. MIGRACIÓN COMPLETA de la plataforma externa: JUGAYGANA → 1girox
- **Pedido del owner:** reemplazar la plataforma de juego por **1girox** (nueva, hecha a
  medida para él), incluido el pedido explícito de que el botón **CASINO** entre a la
  plataforma **ya logueado** (antes el usuario copiaba y pegaba usuario y contraseña).
  Se trabaja contra un servidor aparte, así que se hizo un **reemplazo total** (sin flag
  de convivencia): cuando esté verificado, se activa para todos.
- **La API nueva es mucho mejor**: REST/JSON con `X-Api-Key` fija (adiós sesión
  renovable, mutex de login y manejo de HTML de Cloudflare), montos en **PESOS** (adiós
  ×100 de centavos) e **idempotencia por `reference`**. Un solo cliente reemplaza a los
  4 de JUGAYGANA.
- **Módulos nuevos:**
  - `src/services/giroxService.js` — Partner API v1.7 completa: altas, saldo, cargas,
    retiros, bonos, cambio de clave y **login único (SSO)**. Rate limit local (55/min,
    con margen sobre el tope de 60), reintentos 2s/5s/15s reusando SIEMPRE la misma
    reference, y traducción de los códigos de error de 1girox a mensajes en castellano.
  - `src/services/giroxReportsService.js` — netwin/GGR por jugador. ⚠️ **NO es la
    Partner API**: la Partner API NO expone reportes. Pega contra el panel
    `admin.1girox.com/api/config/reports/global` (capturado con F12 por el owner), con
    Bearer de sesión **auto-renovable** — el login devuelve un payload base64 +
    raw-deflate del que salen el token y el `user.id` del agente.
  - `src/services/giroxUserLinkService.js` — resuelve y cachea `User.giroxUserId`.
  - `src/services/giroxPublisherKeys.js` — alta con la API key del publicista.
  - `src/utils/periodRanges.js` — los rangos de fecha (puros) que vivían en jugaygana.js.
  - `scripts/migrate-users-to-girox.js` — migración masiva de usuarios.
- **IDEMPOTENCIA — lo más delicado de toda la migración.** Las firmas cambiaron de forma
  peligrosa: el 4º arg de `depositToUser` pasó de ser el `jugayganaUserId` a ser la
  **llave de idempotencia**, y el 3º de `creditUserBalance` lo mismo. Migrar a ciegas
  habría metido el ID del usuario como reference → **la segunda carga a ese usuario
  devolvería `duplicate:true` y no acreditaría nada** (el cliente transfiere y no recibe
  las fichas). Por eso cada flujo deriva su reference de una llave que ya es única Y
  estable entre reintentos:
  | Flujo | Reference | Por qué |
  |---|---|---|
  | Reembolsos | `vip-rf-{periodKey}-{userId}` | **NO** del id del RefundClaim: si el crédito falla el handler BORRA el claim y el reintento generaría un id nuevo → un fallo FALSO (timeout con la plata ya acreditada) pagaría dos veces. El período es estable para siempre. |
  | Auto-carga hgcash | `vip-hg-{coelsa/movementId}` | Identifica la transferencia bancaria; misma garantía que el candado local, ahora también del lado de la plataforma. |
  | Ruleta | `vip-roulette-{spinId}` | La MISMA que usa el reintento manual del panel → un premio ya acreditado no se paga de nuevo. |
  | Fueguito | `vip-fire-{userId}-d{día}-{fecha}` | Usuario+día solo no alcanza: el mismo hito se puede volver a alcanzar en una racha futura y sería un premio legítimo distinto. |
  | Bono instalación | `vip-install-{userId}` | Es uno por usuario para siempre. |
  | Retiros/devoluciones de payout | `vip-payout-{id}` / `vip-payoutref-{id}` | El payout es único por solicitud. |
  | Cargas/retiros/bonos manuales | `vip-dep-` / `vip-wd-` / `vip-bonus-{uuid}` | El uuid se genera ANTES de llamar y se guarda como `Transaction.id` → la fila local y la operación remota quedan atadas. |
  | Comisiones de referidos | `vip-refcom-{payoutId}` | Con reuso del payout `pending`/`failed` del mismo período para que el reintento mantenga la reference. |
- **Botón CASINO (SSO)** — lo que pidió el owner: `POST /api/platform/session` pide a
  1girox un link de acceso directo (código de UN SOLO USO que vence a los 60s) y el
  front redirige. Se reutilizó el endpoint huérfano `POST /api/auth/platform-login`, que
  existía sin que el front lo llamara nunca (un SSO que había quedado a medias).
  - ⚠️ **Pop-up blocker:** la pestaña se abre ANTES del fetch (dentro del gesto del
    usuario) y recién después se le cambia la URL. Si se abriera después, mobile la mata.
  - **Auto-reparación:** si el jugador no existe en 1girox, se crea al vuelo y se
    reintenta → nadie queda afuera aunque la migración masiva no lo haya alcanzado.
  - Cupo **por usuario, no por IP**: con el CGNAT de las telefónicas argentinas, limitar
    por IP dejaría barrios enteros compartiendo cupo.
  - El modal viejo (usuario + contraseña para copiar) queda sólo como **respaldo** si el
    SSO falla. Se eliminó el `jugayganaToken` del login: el front lo guardaba y no lo
    usaba en ningún lado.
- **Contraseñas:** las locales están en bcrypt y son **irrecuperables**, así que los
  usuarios migrados se crean en 1girox con clave random. No deja a nadie afuera (se entra
  por SSO) y la clave real se sincroniza **en el próximo login**, que es el único momento
  en que la tenemos en texto plano (`giroxPasswordSynced` evita repetirlo).
- **Decisiones del owner:** el reembolso se calcula **sólo sobre el netwin de CASINO**
  (sports queda afuera; `GIROX_NETWIN_SCOPE=total` lo incluiría) y la **comisión de
  referidos es 8%** — 1girox devuelve todos los `commission` en 0, así que la tasa dejó
  de venir del proveedor y ahora es nuestra (`GIROX_REFERRAL_COMMISSION_PCT`).
- **Publicistas:** el pool de sesiones por campaña se reemplazó por **una API key por
  publicista** (`Campaign.giroxApiKey`, select:false, + espejo booleano `hasGiroxKey`
  para el listado del panel). En 1girox la key define bajo qué cuenta caen los jugadores
  y de qué saldo salen las cargas.
- **Rollover:** el owner tiene el feat ACTIVO (verificado en su panel), así que los
  retiros ahora validan contra `wagering.available` y no contra `balance` — si no, la
  plataforma los rechazaría con `rollover_locked` y quedarían colgados.
- **Bonos "a reclamar" (v1.7, del mismo día):** un bono dado por `POST /players/{u}/bonus`
  ya NO se libera solo, queda esperando que el jugador lo reclame en el casino. Por eso
  reembolsos, ruleta, fueguito y bono de instalación se acreditan con **depósito libre**.
  Si se usara `/bonus`, el cliente vería "reembolso acreditado" y no la plata.
- **FIX de un bug latente:** `server.js` (ruleta) leía `credit.transactionId ||
  credit.transferId`, campos que el cliente nunca devolvió en la raíz → el `creditTxId`
  de **todos** los giros se guardó siempre en `null`. Ahora lee `credit.data.transfer_id`.
- **Front:** una sola URL hardcodeada en la PWA (`ui.js`), más los copys del backend
  (bienvenida, avisos de depósito/bono) y las plantillas `/sys_*`. ⚠️ **Las plantillas
  guardadas en la BASE todavía tienen la URL vieja** — hay que migrarlas por script o
  editarlas desde COMANDOS. Service workers: cliente **v51**, panel **v25**.
- **Validado:** `node --check` OK en los 15 archivos tocados. Grep: **0 consumidores**
  de los módulos viejos (sólo se referencian entre ellos). Los archivos de JUGAYGANA
  quedan en el repo para poder revertir; se borran cuando 1girox esté verificado.
- **PENDIENTE / BLOQUEANTE:** falta la **`GIROX_API_URL`** (Base URL de la Partner API).
  Se probaron 20 hosts y 8 rutas: `api-lbvip.com/api/v1` ES la Partner API (formato de
  error idéntico al del manual) pero **rechaza la key del owner con 401** → es la
  instalación de otra marca. Ningún `api-*.1girox.*` resuelve en DNS. Está pedido a
  1girox. Sin ese dato no se puede probar nada contra el servidor real.

## Sesión 2026-07-09

### 96. SEGURIDAD — 2 races de doble-cobro cerrados con reserva atómica ANTES de acreditar (fueguito + reembolsos)
- **Contexto:** auditoría de seguridad completa del repo (4 frentes: auth/roles, plata, inyección,
  secrets). De los hallazgos, el owner pidió corregir AHORA los 2 races de plata explotables; el
  resto queda anotado para tandas siguientes. **Los detalles del resto NO se documentan acá a
  propósito** (el repo es público en GitHub — no se publica el mapa de ataque de algo sin arreglar).
- **Fueguito `POST /api/fire/claim-reward` (server.js) — race de doble/N-cobro por el cliente:** el
  handler acreditaba el premio (`makeBonus`, con un `await` largo) y RECIÉN DESPUÉS ponía
  `pendingCashReward` en 0. N requests concurrentes del mismo cliente leían todos el flag >0 y
  cobraban el premio (hasta $200.000) N veces (TOCTOU). **Fix:** reserva atómica —
  `FireStreak.findOneAndUpdate({userId, pendingCashReward:{$gt:0}}, {$set:{...en 0}}, {new:false})`
  ANTES de acreditar. Solo un request "gana" el doc con el monto; los demás reciben null → abortan.
  Si `makeBonus` falla, se RESTAURA el premio (guard `pendingCashReward:0` para no pisar uno nuevo)
  y el cliente puede reintentar. `totalClaimed` pasó a `$inc` atómico. Mismo patrón que ya usaban
  la ruleta y el bono de instalación (que estaban bien).
- **Reembolsos `POST /api/refunds/claim/{daily|weekly|monthly}` (server.js) — doble pago si el lock
  Redis cae en multi-instancia:** el orden era acreditar (`creditUserBalance`) y DESPUÉS crear el
  `RefundClaim` con el `periodKey` único → el índice único solo evitaba la fila duplicada, no el
  doble pago (dos instancias con el lock Redis degradado acreditaban ambas y la segunda solo fallaba
  al escribir la fila, con la plata ya duplicada). **Fix:** invertido el orden en los 3 — se CREA el
  `RefundClaim` PRIMERO (el índice único `userId+type+periodKey` es ahora el candado atómico real);
  si choca (E11000) → se aborta SIN acreditar; recién si la reserva ganó se acredita; si el crédito
  falla se borra la reserva (`deleteOne`) para permitir reintentar; el `transactionId` se persiste
  con un update posterior. El `acquireRefundLock` (Redis+fallback memoria) queda como defensa en
  profundidad (evita el trabajo duplicado del cálculo), pero ya NO es la única barrera de plata.
- **Validado:** `node --check` OK (server.js). Sin migraciones (el índice único ya existía —
  `RefundClaim.js:88`). Back necesita redeploy. PROBAR tras deploy: reclamar un reembolso normal
  (debe seguir funcionando) y una recompensa de fueguito; el doble-reclamo concurrente ahora paga
  una sola vez.

### 95. Lectura integral del repo + docs vivos (ARCHITECTURE/CLAUDE/WORKLOG) + limpieza de código muerto
- **Pedido del owner:** leer TODO el repo de punta a punta para tener contexto completo, y que
  `docs/ARCHITECTURE.md` y `CLAUDE.md` se mantengan actualizados junto con `WORKLOG.md` a medida
  que se trabaja — así una sesión nueva en Tails arranca sabiendo todo sin re-analizar el repo.
- **Lectura integral hecha (2026-07-09):** server.js completo (15.7k líneas), los 4 clientes
  JUGAYGANA, config/database.js, los 28 modelos, models/refunds.js legacy, y (vía agentes
  lectores) la PWA completa, el panel admin completo y todo src/ (servicios/rutas/middlewares/
  utils/scripts). Todo lo aprendido quedó volcado en `docs/ARCHITECTURE.md`.
- **`docs/ARCHITECTURE.md` REESCRITO** (versión 2026-07-09): líneas corregidas (authMiddleware
  ~L2477, login ~L3341, Socket.IO ~L7325 — el doc viejo apuntaba a posiciones de hace meses),
  y secciones nuevas: tabla de los 4 clientes JUGAYGANA (con el gotcha de que
  jugaygana-movements.js NO multiplica ×100), flujo completo de auto-carga hgcash y de pagos
  deductAtPay, mapa del front (PWA VIP.* + panel), tabla de motores/crons con su estado
  (encuesta/inactividad/estrategia apagados) e idempotencia por índices únicos, y ~20 trampas.
- **`CLAUDE.md` actualizado:** la REGLA PERMANENTE ahora cubre los 3 docs vivos (WORKLOG +
  ARCHITECTURE + CLAUDE), datos corregidos (server.js ~15.7k líneas, líneas reales) y gotchas
  de primer nivel nuevos (4 clientes JUGAYGANA, bonos apagados por flags, multi-instancia,
  front frágil por onclick/USERS_LIST_FIELDS).
- **LIMPIEZA de código muerto (verificado por grep antes de borrar cada cosa):**
  - **Sección "Base de Datos" del panel ELIMINADA por completo**: era inalcanzable — no existía
    nav-item `data-section="database"` ni `<section id="databaseSection">` en el HTML (quedó
    huérfana desde #79). Borrado: branch en switchSection, `loadDatabaseUsers`,
    `renderDatabaseUsers`, `verifyDatabaseAccessFromModal`, `showDatabasePasswordModal`,
    `dbAccessGranted/dbStoredPassword` (admin.js), el modal `databasePasswordModal`
    (index.html) y en el BACKEND los endpoints `POST /api/admin/database/verify` y
    `POST /api/admin/database/users` (dumpeaba TODA la base sin paginar) + dbPasswordMiddleware
    + el chequeo fatal de `DB_PASSWORD` (la env queda sin uso; se puede sacar de SSM cuando se
    quiera). ⚠️ La nota de #93 que decía que la sección Base de Datos "usaba" ese endpoint era
    incorrecta: la sección ya era inalcanzable. `getRoleLabel` y `escapeCsvField` se CONSERVAN
    (los usan la tabla de usuarios y el export CSV vivo). Rollback: `git revert`.
  - **`_suspiciousOpenUser` (admin.js)**: eliminada la rama que llamaba a `openChatByUsername`,
    función que nunca existió (siempre caía al fallback). Comportamiento idéntico.
  - **FIX ruleta (roulette.js)**: tras ganar llamaba a `VIP.auth.refreshBalance`, que tampoco
    existió nunca → el saldo del header NO se refrescaba al ganar. Ahora llama a
    `VIP.ui.syncBalance()` (el mismo patrón que usan installbonus y withdraw).
  - **`window.setPasswordChangePending` fantasma**: eliminados los 2 llamados guardados
    (ui.js y auth.js) — la línea anterior ya seteaba `VIP.state.passwordChangePending` directo.
  - **NO borrado a propósito**: `_communityRecommendCard` (roulette.js) — es una feature pedida
    por el owner que nunca se conectó (lee `VIP.state.communityLink*` que nadie setea); quedó
    documentada en ARCHITECTURE §9 como mejora pendiente (reconectarla desde `loadCommunity()`),
    igual que `checkUsernameAvailability` en la PWA.
- **Validado:** `node --check` OK (server.js, admin.js, roulette.js, ui.js, auth.js). Grep: 0
  referencias vivas a lo eliminado (solo comentarios-lápida). Back necesita redeploy (endpoints
  eliminados); panel y PWA se actualizan al recargar (SW stale-while-revalidate para /js/).
  PROBAR tras deploy: panel Cuentas sospechosas → botón "Ver chat" (debe llevar a Usuarios con
  toast), y en la PWA ganar la ruleta debería refrescar el saldo del header.

## Sesión 2026-07-08

### 94. Fan-out del webhook hgcash → autoreembolsos.com (proyecto hermano, misma cuenta hgcash)
- **Pedido del owner:** hgcash permite UNA sola URL de webhook por cuenta; vipcargas la recibe.
  Reenviar cada webhook VÁLIDO a autoreembolsos.com (comparte la cuenta hgcash; cada proyecto
  matchea sus propios comprobantes → no hay doble carga). SIN tocar el procesamiento actual ni
  la URL configurada en hgcash.
- **Implementación (`_fanoutHgcashWebhook` en server.js, junto al webhook):**
  - Se dispara DESPUÉS de validar la firma (solo webhooks auténticos) y ANTES de los filtros
    locales → el destino recibe TODO (movimientos entrantes Y estados de pago TRANSACTION_REQUEST,
    que también necesita para sus propios cash-outs).
  - Reenvía el **body CRUDO** (`req.rawBody`, bytes exactos) + la firma original
    `X-HG-Webhook-Signature` → autoreembolsos valida el mismo HMAC con el secret compartido
    (⚠️ debe tener el MISMO `HGCASH_WEBHOOK_SECRET` configurado). Header `X-Forwarded-By: vipcargas`.
  - **Fire-and-forget** (sin await): jamás demora la respuesta 200 a hgcash ni afecta el
    procesamiento local. Timeout 8s + 1 reintento a los 15s; después desiste con log
    `[hgcash-fanout]`. `maxRedirects:0` a propósito (un redirect www↔apex rompería el POST y
    debe quedar visible en logs, no silenciado).
  - **URL configurable** por env/SSM `HGCASH_FANOUT_URL` (lectura lazy por el bootstrap SSM);
    default `https://www.autoreembolsos.com/api/hgcash/webhook` (confirmado por el owner).
    **Kill switch sin deploy:** setear `HGCASH_FANOUT_URL=off`.
- **OJO (lado autoreembolsos, no nuestro):** si autoreembolsos.com está detrás de Cloudflare,
  puede bloquear el POST server-to-server — mismo problema que tuvo vipcargas con su propio
  webhook (#66): necesitaría regla WAF "Skip" para su ruta /api/hgcash/webhook. Si en los logs
  aparece `[hgcash-fanout] ... 403` es eso.
- **Validado:** `node --check` OK (server.js). Back necesita redeploy. PROBAR: tras una carga real,
  buscar `[hgcash-fanout]` en los logs (ausencia de warns = entregas OK) y verificar que el
  movimiento apareció en autoreembolsos.

### 93. PERFORMANCE — Listados de usuarios: proyección campo por campo + 3 endpoints muertos eliminados
- **Hallazgo clave (mejor de lo esperado):** la sección Usuarios del panel YA estaba paginada
  (`GET /api/admin/users?page=…`, 20 por página, búsqueda server-side) — no hacía falta el
  refactor grande de paginación. Lo que quedaba: docs completos viajando al pedo y 3 endpoints
  muertos que dumpeaban la base entera.
- **Proyección verificada CAMPO POR CAMPO contra el panel:**
  - `GET /api/admin/users` (paginado, el que usa la sección Usuarios): `select('-password')`
    arrastraba fcmTokens/tagHistory/withdrawalAccount/acquisitionUtm/adminNotes de cada fila →
    ahora `USERS_LIST_FIELDS` (17 campos, enumerados leyendo `renderUsers` + `notifUsageCell` +
    los onclick de la tabla en admin.js). El detalle completo lo sigue trayendo
    `GET /api/users/:userId` (viewUser/loadUserInfo) — intacto. ⚠️ Columna nueva en la tabla del
    panel ⇒ sumar el campo al select.
  - `POST /api/admin/database/users` (sección Base de Datos): trae TODA la base (sin paginar) pero
    ahora solo las 8 columnas que `renderDatabaseUsers` muestra (username email phone role balance
    isActive lastLogin createdAt) — el payload baja ~20-50×.
- **ELIMINADOS 3 endpoints muertos** (0 callers, verificado en admin.js + ambos index.html con JS
  inline + public/js + scripts): `GET /api/users` (dump completo de la base con doc entero),
  `GET /api/admin/database` (ídem) y `POST /api/admin/database/export/csv` (botón borrado en #79).
  El export vivo (`GET /api/admin/users/export/csv`, ya proyectado) y los POST de database
  (verify/users) quedan. Rollback: `git revert`.
- **Validado:** `node --check` OK (server.js). Solo queda 1 `User.find()` sin filtro en el repo:
  el export CSV vivo (proyectado a 5 campos, es su función). PROBAR tras deploy: sección Usuarios
  (tabla completa con etiquetas, plan de notis, botones SMS/bloquear/clave), modal "Ver detalle",
  sección Base de Datos, export CSV de usuarios.

### 92. PERFORMANCE — Login/registro case-insensitive por índice (usernameLower) con red de seguridad
- **Problema:** TODAS las búsquedas de usuario case-insensitive usaban regex `^...$/i`, que NO puede
  usar el índice de `username` → COLLSCAN de la colección entera en cada login, cada chequeo de
  "usuario disponible" y cada verificación de unicidad al crear cuentas (10 lugares). Crece linealmente
  con la base; pega peor justo en ráfagas de registro por pauta.
- **Diseño (a prueba de dejar gente afuera):**
  - Nuevo campo **`usernameLower`** en User (copia en minúsculas, indexada). Lo mantiene un hook
    `pre('save')` (cubre TODAS las altas; verificado por grep que no hay renames de username por
    updateOne/findOneAndUpdate).
  - **Backfill en CADA arranque** (no one-shot): `updateMany({usernameLower:null},
    [{$set:{usernameLower:{$toLower:'$username'}}}])` — idempotente, barato cuando no hay nada que
    rellenar, y repara usuarios creados por instancias con código viejo durante un rolling deploy.
    Solo si terminó OK se habilita el modo rápido puro (`_usernameLowerReady`).
  - Helper único **`findUserByUsernameCI(username, {select,lean,critical})`**: busca por
    `usernameLower` (indexado); si no encuentra Y (`!_usernameLowerReady` O `critical`), cae al
    regex histórico (COLLSCAN) y si lo encuentra AUTO-REPARA el campo (fire-and-forget).
  - **El LOGIN usa `critical:true`** → fallback lento disponible SIEMPRE: es imposible que alguien
    quede afuera de su cuenta por este cambio (peor caso = comportamiento de hoy). El costo del
    fallback solo se paga con usernames inexistentes (tipeos), y el login está rate-limiteado.
- **Migrados los 10 call sites:** login (3316), check-username (2582), register (2913),
  register-quick (3150), verify-phone/registro con username (4184), admin create user (5103 y
  13242), influencer create (9820), asignar cuenta de campaña (10176), simulación ruleta (13804).
  Grep: 0 regex de username fuera del helper.
- **Validado:** `node --check` OK (server.js, User.js). Mongoose 8 (soporta pipeline updates).
  Back necesita redeploy (crea el índice + corre el backfill). PROBAR tras deploy: login con
  mayúsculas/minúsculas mezcladas, registro de usuario nuevo, "usuario ya existe" al intentar
  duplicado con otra capitalización.

### 91. PERFORMANCE — Batch B (subset seguro): endpoints muertos peligrosos + cache de campañas + render del panel
- **Contexto:** producción con gente activa (JUGAYGANA/backupviejo quedó como el repo vivo; Spingama
  NUNCA se deployó → cero problema de datos). Del Batch B se aplicó SOLO lo que no toca flujos de
  plata (nada de pagos, CBU, login ni depósitos). Cada cambio verificado a mano contra sus callers.
- **ELIMINADOS 3 endpoints muertos peligrosos** (server.js): `GET /api/admin/chats/:status`,
  `GET /api/admin/all-chats` y `GET /api/admin/chats/category/:category`. Verificado por grep:
  0 callers en panel/cliente/scripts (el panel usa `/api/admin/conversations`, aggregation con
  limit 100). Eran bombas de memoria: all-chats cargaba TODA la colección de mensajes + usuarios a
  RAM por request (con un token de admin bastaba para tumbar la instancia). Los POST de
  close/reopen/assign/category quedan intactos. Rollback: `git revert`.
- **Cache 30s de campañas activas para el vanity por slug** (`_getActiveCampaignsCached`): el
  branch de slug de `GET /:code` corre en CADA page-view SPA de un segmento (/register, /chat…) y
  traía TODAS las campañas activas de la DB por request. El matching por CODE exacto NO usa el
  cache (sigue directo a la DB, indexado) → una campaña nueva funciona por code al instante y por
  slug a los ≤30s.
- **Panel — render de la lista de chats:** (a) **delegación de eventos**: un solo listener en el
  contenedor (antes se re-adjuntaba un listener POR ITEM en cada render); (b) **coalescing por
  frame** (`requestAnimationFrame`): antes cada evento de socket (chat_updated/new_message/
  messages_read) disparaba un rebuild COMPLETO de la lista — en horas pico eran ~100 rebuilds/min.
  Ahora N eventos en el mismo frame = 1 render. El estado se actualiza igual al instante; con
  pestaña oculta el navegador pausa rAF y pinta al volver. Verificado: ningún caller lee el DOM
  inmediatamente después de renderConversations(); los otros forEach de `.conversation-item`
  (selectConversation/cerrar chat) solo togglean clases.
- **NO tocado a propósito (riesgo/plata):** `_pollPayingPayouts` sigue secuencial (toca PAGOS;
  con hgcash flaky, paralelizar es riesgo sin urgencia); cache de `getConfig` (multi-instancia:
  un cambio de CBU tardaría el TTL en verse en otras instancias — plata); login por regex
  (COLLSCAN pero tocarlo arriesga logins); paginación de /api/users (toca contrato con el front);
  mongoSanitize/xss por ruta; defer de scripts del panel (colisión de nombres); drop de índices
  redundantes (requiere explain() en Atlas).
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy; panel, recargar.
  PROBAR tras deploy: links de pauta (por code y por slug), y en el panel: click en conversaciones,
  buscador, badge de no leídos, cambio de pestañas.

### 90. PERFORMANCE — Batch A: optimización general de riesgo bajo (auditoría con 3 agentes)
- **Pedido del owner:** optimización general de rendimiento/velocidad SIN romper nada. Se auditó
  todo (queries Mongo, runtime Node/Express, frontend PWA+panel) con 3 agentes de solo-lectura y
  se verificó cada hallazgo a mano. Se aplicó el batch de riesgo cero/bajo; lo de riesgo medio
  queda anotado abajo (Batch B).
- **Backend (server.js):**
  - **Cache en memoria de assets con handler propio** (`readFileCached` + `_indexHtmlBase` +
    `_adminHtmlRendered`): antes CADA page-view hacía `fs.readFileSync` de index.html (242KB, + 3
    regex-replace sobre todo el string) y cada apertura del panel leía admin.js (~600KB) — I/O
    síncrona que bloqueaba el event loop. Ahora se lee 1 vez por proceso (los archivos solo cambian
    con redeploy); del index se precomputa pixel/base-url y por request solo se reemplaza el
    campaignCode. No cachea errores (null) → reintenta.
  - **authMiddleware con `.select()`** (`AUTH_USER_FIELDS`): corría en cada request autenticado
    hidratando el doc User COMPLETO (fcmTokens/tagHistory/etc.) para leer 8 campos. Ahora trae solo
    esos. El self-heal de admins pasó de `user.save()` a `updateOne` puntual.
    ⚠️ Si un chequeo futuro necesita otro campo del user: agregarlo al select.
  - **`_maybeSendPushFallback` con select+lean** (por mensaje de chat con fallback push; verificado
    que `sendPushIfOffline` solo usa `_id/id/username/fcmToken/fcmTokens` y limpia por updateOne).
  - **FIX fuga `connectedAdmins`:** authenticate mete admin/depositor/withdrawer/comunidad al Map,
    pero disconnect solo limpiaba `role==='admin'` → sockets muertos de los otros roles quedaban
    para siempre (fuga + emits a sockets desconectados en broadcastStats) y encima se notificaba
    `user_disconnected` como si fueran clientes. Ahora disconnect usa la misma lista de roles.
  - **CSP precomputada** (`CSP_HEADER_VALUE`): antes se armaba el array + join en CADA request.
- **Índices nuevos en User** (src/models/User.js): `{'fcmTokens.token':1}` (multikey — reclamo del
  bono instalación, fraud-check multicuenta y logout hacían COLLSCAN) y `{role:1, lastLogin:1}`
  (audiencias de recuperación/inactividad + cron de reglas cada 5 min). Mongoose los crea al
  deployar (autoIndex).
- **Logs por-request apagados tras flag** (`_dlog`, prender con `FCM_DEBUG_LOGS=1`):
  `notificationRoutes.js` tenía ~5 `console.log` por CADA registro de token FCM (cada carga de la
  PWA) y 2-3 por CADA request del panel (requireAdmin). Los `console.error` quedan.
- **PWA cliente:**
  - **Poll de mensajes = solo respaldo** (`socket.js`): antes cada usuario online pegaba
    `GET /api/messages` cada 30s AUNQUE el socket entregara todo en tiempo real (~120 req/h por
    usuario). Ahora el tick se saltea si el socket está conectado+autenticado (flag
    `VIP.state.socketAuthed`); si el socket cae, el poll de 30s sigue igual. El catch-up al
    reconectar ya existía (`loadMessages(true)` en authenticated/reconnect).
  - **Service worker v50 — stale-while-revalidate para `/js/` y `/css/`**: antes cache-first PURO
    sin revalidación → un deploy no llegaba a usuarios recurrentes hasta bumpear CACHE_VERSION a
    mano (causa raíz de los bugs "fantasma" #88/#89). Ahora responde del caché (rápido) y revalida
    en background → el deploy llega en la SIGUIENTE carga. **Ya no hace falta bumpear versión por
    cambios en js/css** (sí para cambios de estrategia del SW o purga forzada). Logs por-fetch del
    SW tras flag `SW_DEBUG` (const en el archivo).
- **Panel admin:** reconciliación de conversaciones 60s → 180s + skip con pestaña oculta (fetch
  grande + re-render completo; el socket cubre el tiempo real, esto es solo red de seguridad).
- **NO tocado — Batch B pendiente (riesgo medio, consultar):** `/api/admin/all-chats` y chats por
  status/categoría traen TODOS los mensajes a memoria (reescribir con aggregation como
  `/api/conversations`); paginación de `GET /api/users` (trae toda la colección; toca el front);
  cache TTL en `getConfig` (⚠️ multi-instancia: un cambio de CBU tardaría el TTL en verse en las
  otras instancias — decidir con el owner); login por regex case-insensitive no usa el índice de
  username (COLLSCAN por login; requiere collation o usernameLower); ruta vanity `/:code` hace
  `Campaign.find` de todas las campañas activas por page-view SPA (cachear con TTL corto);
  `_pollPayingPayouts` hace hasta 25 llamadas hgcash SECUENCIALES por tick (paralelizar);
  acotar mongoSanitize/xss a `/api/` (coordinar con seguridad); `defer` en scripts del head del
  panel (colisión de nombres a resolver); event delegation + coalescing en `renderConversations`
  (re-render total + N listeners por evento de socket); índices single-field redundantes en
  Message/User/Transaction (requiere `explain()` + drop en Atlas).
- **Verificado como YA-BIEN por la auditoría (no tocar):** compression() activo, timeouts en TODAS
  las llamadas externas (axios), FCM en lotes de 500 con logging por-lote, broadcastStats cacheado
  60s, Socket.IO sin broadcasts globales (todo a rooms), rate-limit Maps con cleanup, admin-sw.js
  ya network-first para admin.js/css, roulette.js con guarda de visibilidad (patrón modelo).
- **Validado:** `node --check` OK (server.js, User.js, notificationRoutes.js, socket.js,
  firebase-messaging-sw.js, admin.js). Back necesita redeploy (activa caches + crea índices);
  cliente recibe el SW v50 en la próxima recarga.

### 89. FIX bonos-fantasma 50%/100%: eliminados TODOS los caminos que seguían dando/prometiendo 50-100%
- **Síntoma (owner):** pidió eliminar los bonos automáticos del 50%/100% (bajados a 15/20/30%), pero
  a usuarios les SEGUÍAN apareciendo ofertas de 50/100% (y al aparecerles hay que respetarlas).
  Mismo fix que en el repo nuevo (VIPCARGASANTINO #99), pero auditado y aplicado ACÁ desde cero
  (pedido explícito del owner: no asumir que los dos repos están iguales).
- **Causa raíz (barrido completo de ESTE repo con 3 agentes):** los kill switches de #71
  (BONUS_STRATEGY_DISABLED / INACTIVIDAD_DISABLED / CHARGE_BONUSES_DISABLED) apagan la CREACIÓN en
  esos 3 motores, pero quedaron 5 fugas:
  1. **`_getActivePromoBonus` devolvía el `percent` CRUDO de Mongo sin tope** → cualquier PromoBonus
     viejo activo con 50/100 (vigencia hasta 720h) se seguía mostrando al usuario (banner
     `promobonus.js`) y al agente (banner del chat), que lo aplicaba a mano en la carga.
  2. **Plantillas push `bono_50`/`bono_100`** hardcodeadas en `notificationRoutes.js` + worker
     `_runDueSchedules` cada 60s → un `ScheduledNotif` daily/weekly viejo re-mandaba "¡Bono del
     100%!" para siempre.
  3. **Motor de encuesta**: `ENCUESTA_PLAN_DEFAULTS.bonoPercents [50,100]`, validación hasta 500%,
     `insertMany` sin cap. Hoy semi-apagado por `bDays=[]` (encuestaService), pero latente: revertir
     UNA línea revivía el 50/100. El panel además pre-rellenaba `50,100` si la config venía vacía →
     guardar sin tocar el campo RE-SEMBRABA los 50/100.
  4. **Copy hardcodeado en la PWA** (`index.html`): "Bonos del 50% y 100% en tus cargas" (infoModal
     1386 + adServiceModal 1440) y "Día 15: 100% en próxima carga" (menú estático del fueguito 1333
     — hito que YA NI EXISTE, los defaults son 10/20/30 cash).
  5. **Panel**: opciones "Bono 50%/100%" en programadas + input % de estrategia hasta 1000.
- **Fix aplicado (misma decisión owner que el repo nuevo: tope 30% solo en lo AUTOMÁTICO; los
  botones manuales +50/+100 del modal de depósito QUEDAN — herramienta del agente):**
  - `_getActivePromoBonus` (server.js): **cap de lectura `percent>30 → 30`** — cubre
    `/api/promo-bonus/mine` y `/api/admin/promo-bonus`. Basura vieja en DB nunca más se ve >30%.
  - **Migración one-shot `migration_kill_bonus_50_100_done`** (server.js, tras las existentes):
    vence PromoBonus activos `percent>30` + desactiva ScheduledNotif tipo bono_50/bono_100. El flag
    solo se setea si TODO salió bien (si falla, reintenta al próximo arranque).
  - **Plantillas**: bono_50/bono_100 ELIMINADAS de `NOTIF_TEMPLATE_DEFAULTS`, `NOTIF_TYPE_CATEGORY`
    y de los enums de `NotifTemplate`/`ScheduledNotif`. **Guard en `_runStrategyLaunch`** (tipo
    desconocido → error, NUNCA envía; sin esto un tipo sin categoría caía en la rama "sin tope" del
    reembolso y se mandaba a todo el plan) + `_runDueSchedules` auto-desactiva schedules de tipos
    eliminados (doble cinturón además de la migración).
  - **Encuesta**: defaults `[50,100]→[15,30]` (server.js + encuestaService), validación
    `_encNum(p,15,1,30)` (antes 1..500), cap `Math.min(30,…)` en el slot y en el `insertMany`.
  - **Panel**: sin opciones bono 50/100 en programadas; `TYPE_LABELS` los conserva como
    "(ELIMINADO)" para schedules viejos; pre-relleno encuesta `50,100→15,30`; input % estrategia
    max 1000→30 (el modelo ya capeaba a 30); comentario stale "50%->100%" corregido.
  - **PWA**: copy → "Bonos de hasta el 30%…" (index.html 1386/1440), línea "Día 15: 100%" BORRADA
    (hito inexistente), `CACHE_VERSION` v48→v49 (purga cachés viejos, patrón #88).
- **NO tocado (a propósito):** botones +50%/+100% del modal de depósito (manual, decisión owner);
  `/sys_recover_100` ("recuperá el 100% de lo que perdiste") — es texto de RECUPERACIÓN/Comunidad
  editable por COMANDOS, no bono de carga (si molesta, se edita desde el panel); ruleta (premios
  cash fijos, sin %); fueguito (ya en 30%, defaults 10/20/30 cash); `autoEditBonusPercent`
  (config manual del admin, max 1000 — lo setea el admin a mano).
- **Validado:** `node --check` OK (server.js, encuestaService, notificationRoutes, NotifTemplate,
  ScheduledNotif, admin.js, firebase-messaging-sw.js). Grep: 0 referencias vivas a bono_50/100
  fuera de comentarios/migración/label legacy; 0 "[50, 100]" ni "50% y 100%". Las rutas de
  plantillas/lanzamiento rechazan los tipos eliminados (validan contra NOTIF_TEMPLATE_TYPES).
  **Back necesita redeploy** para que corra la migración y aplique el cap de lectura.

## Sesión 2026-07-02

### 88. FIX "bienvenida-fantasma": mensaje de bienvenida viejo apareciendo como enviado por el cliente
- **Síntoma (owner):** tras cambiar los % de reembolso y editar `/sys_welcome`, la bienvenida a veces sale bien (por "Sistema", con % nuevos) pero en OTROS casos aparece como enviada por el PROPIO CLIENTE y con el texto/porcentajes VIEJOS.
- **Causa raíz:** el server actual crea la bienvenida como Sistema (`/api/messages/welcome`, con `renderSystemCommand('/sys_welcome')`). Pero **versiones VIEJAS cacheadas de la PWA** (service worker) todavía corren el código anterior, que mandaba la bienvenida vía `/api/messages/send` con el token del cliente → se registraba con `senderRole:'user'` y con el TEXTO HARDCODEADO viejo (20/10/5). El código actual del cliente (`ui.js` → `/api/messages/welcome`) está limpio; el problema son los dispositivos con caché vieja.
- **Fix (2 capas):**
  - **Servidor (inmediato, cubre a TODOS incluidos los cacheados):** guard `_isStaleClientWelcome(content)` en `/api/messages/send` (HTTP) y `send_message` (socket): si un usuario (`role==='user'`) manda un mensaje que ES la bienvenida (matchea "Bienvenido a la Sala de Juegos" + "Beneficios exclusivos"/"Reembolso DIARIO/SEMANAL/MENSUAL"), se descarta silenciosamente (no se guarda ni emite; HTTP devuelve `{success:true, ignored:true}`). Marcadores muy específicos → no toca mensajes reales.
  - **Service worker:** `CACHE_VERSION` v47 → v48 para que los clientes viejos actualicen a `ui.js` limpio (que ya usa `/api/messages/welcome`).
- **NO tocado (latente, no era la causa):** los textos de bienvenida HARDCODEADOS con % viejos en `server.js:4930` (fallback de `/api/messages/welcome`) y en el seed `/sys_welcome` (`$setOnInsert`) — son dormidos porque `/sys_welcome` está editado; solo reaparecerían si se borra el comando. Se puede limpiar si se quiere.
- **Validado:** `node --check` OK (server.js). `socket.role` confirmado seteado (L7389). Sin migraciones. Back redeploy; el efecto del SW se ve cuando los clientes recargan la PWA.

## Sesión 2026-06-30

### 87. Auto-carga hgcash/Urbana: NO cargar transferencias menores al mínimo ($2000)
- **Pedido del owner:** el casino tiene mínimo de carga $2000, pero la auto-carga acreditaba transferencias menores. Quiere que si el monto es < $2000 NO se cargue automático; que el comprobante igual se verifique y, si está correcto, se avise que está OK pero NO se cargó por estar bajo el mínimo, para que el agente le pida la diferencia al cliente.
- **Fix:** en `hgcashAutoCarga` (server.js), después del modo sombra y ANTES de cargar, si `movement.amount < minChargeARS` → NO carga: deja el movimiento y el comprobante en `needs_review` (estados ya existentes, sin enums nuevos) y emite aviso admin-only: "✅ Comprobante CORRECTO (…) — PERO el monto es menor al mínimo ($2.000). NO se cargó automático. 👉 Pedile al cliente que envíe la diferencia y cargá la suma a mano". El movimiento en `needs_review` lo consume la carga manual posterior (`hgcashConsumeOnManualDeposit` ya maneja `needs_review`) → no se pierde plata ni queda colgado.
- **Mínimo configurable:** nuevo `minChargeARS: 2000` en `HGCASH_DEFAULTS` (lo lee `getHgcashConfig`, default 2000 aunque no esté en la config guardada). Editable por DB si algún día cambia el mínimo; no se expuso campo en el panel (se puede agregar si lo piden).
- **Alcance:** solo afecta la AUTO-CARGA (modo auto). En modo sombra/manual no cambia nada (el agente decide). La verificación del comprobante (OCR) sigue igual.
- **Validado:** `node --check` OK (server.js). Sin migraciones. Back necesita redeploy.

### 86. FIX comprobantes: falso "YA UTILIZADO" por leer el CUIT como N° de operación
- **Síntoma (reportado por el owner, varias veces):** comprobantes NUEVOS y verificados salían como "duplicado", y a veces decían "COMPROBANTE YA UTILIZADO POR: @VIPpocha7" atribuyéndolo a un usuario que NO lo había mandado. Captura: vipPaulo427 manda un comprobante de $4.000 y salta "ya utilizado por @VIPpocha7 op. N°30-71876498-6".
- **Causa raíz:** `30-71876498-6` es un **CUIT**, no un N° de operación. La IA (`comprobanteAiService`) lo leía y lo devolvía como `numero_operacion`. La defensa anti-falso-duplicado de `analyzeComprobanteFromMessage` (server.js) descartaba la huella solo si coincidía con el CBU (22 díg) o era de 18+ dígitos → **el CUIT de 11 dígitos se colaba** como `dedupeKey`. Como el CUIT del destino (o procesador) se REPITE en todas las transferencias, cada comprobante nuevo chocaba con el primero que tuviera ese CUIT → falso "ya utilizado", atribuido al primero que lo mandó.
- **Fix (2 capas):**
  - **Servidor (determinístico):** la defensa ahora también descarta el `opKey` si parece CUIT/CUIL — 11 dígitos con prefijo válido (20/23/24/27/30/33/34), con o sin guiones (`/^(20|23|24|27|30|33|34)-?\d{8}-?\d$/`). Al descartarlo, cae al combo `monto|titularOrigen|cbuOrigen|fecha` (que SÍ distingue transferencias de distintas personas) o a `no_key` (verificá a mano) — nunca a un falso duplicado. Probado: agarra CUITs, no toca N° de operación normales (9-10 díg, alfanuméricos).
  - **Prompt IA (fuente):** se le aclara explícitamente que NO use el CUIT/CUIL (formato XX-XXXXXXXX-X) como número de operación, porque identifica a una persona y se repite entre transferencias.
- **Por qué es seguro:** el peor caso de descartar el CUIT es usar el combo de dedup (más débil pero correcto) o pedir verificación manual — JAMÁS marca un falso duplicado. No empeora ningún caso. Sin migración: los comprobantes viejos con CUIT como huella quedan en la DB pero los NUEVOS ya no generan esa huella, así que no vuelven a chocar.
- **Validado:** `node --check` OK (server.js, comprobanteAiService.js). Back necesita redeploy.

## Sesión 2026-06-26

### 85. Alerta de MULTICUENTA en el chat (en el momento, no a posteriori)
- **Pedido del owner:** la sección "Cuentas sospechosas" detecta multicuentas (por IP / dispositivo / teléfono) pero hay que entrar a revisarla a mano, y para cuando lo hacen el usuario ya se llevó el bono y retiró. Quería una ALERTA en el chat, al abrirlo, que avise y explique por qué, para detectar y bloquear en el momento.
- **Backend:** nuevo endpoint `GET /api/admin/users/:userId/fraud-check` (adminMiddleware): para el usuario dado, cuenta cuántas OTRAS cuentas (`role:'user'`, distinto id) comparten su **dispositivo** (token FCM, singular + array `fcmTokens.token`), su **teléfono** (`phoneKey` si existe, si no `phone`) y su **IP de registro** (`registrationIp`). Devuelve `{ suspicious, reasons:[{type,label,strong,count,accounts:[{id,username,isBlocked}]}] }` (hasta 8 nombres por motivo, +N más). `suspicious` = dispositivo/teléfono con 1+ (señal fuerte) **o** IP con 2+ otras cuentas (3+ en total; la IP sola es señal débil por wifi/datos compartidos — decisión owner). Queries con `.limit(50)`, anti-inyección (`String(req.params.userId)`).
- **Panel (`adminprivado2026`):** al abrir un chat, `loadUserInfo` dispara `renderFraudBanner(userId)` (fire-and-forget, con guarda de race por `activeConversationId`, try/catch — NUNCA frena ni rompe el chat). Si es sospechoso → banner ámbar/rojo en el header "⚠️ POSIBLE MULTICUENTA — tocá para ver por qué"; al tocarlo despliega el detalle (📱 dispositivo / ☎️ teléfono / 🌐 IP con qué cuentas, marcando 🚫 las ya bloqueadas) + botón "Bloquear este usuario" que **reusa el flujo existente** `openBlockModal` (modal con motivo). Banner nuevo `#chatFraudBanner` en el header; se oculta al cambiar de chat.
- **Impacto:** el agente ve la alerta JUSTO cuando atiende al cliente (carga/pago), incluido el withdrawer antes de pagar un retiro. Aplica a todos los roles de agente (adminMiddleware). Additivo: no cambia nada de lo existente.
- **Validado:** `node --check` OK (server.js, admin.js). Sin migraciones. Back necesita redeploy; panel, recargar. PROBAR en el panel: abrir el chat de un usuario que aparezca en "Cuentas sospechosas" y verificar que salga el banner. (Posible mejora futura: índice en `fcmTokens.token` si el fraud-check se nota lento con muchos usuarios; y badge en la lista de chats.)

### 84. Seguridad — Batch C: tope de longitud de texto en chat + saneo de filename (anti-DoS/storage)
- **Tope de texto:** el envío de mensajes (HTTP `/api/messages/send` y socket `send_message`) no limitaba la longitud del texto → se podía guardar un blob de varios MB como `type:'text'` (el límite de 5MB solo aplicaba a imagen/video). Ahora rechaza `type:'text'` con `content.length > 8000` (un mensaje de chat real es muy corto; 8000 es holgado). Cero impacto en mensajes legítimos.
- **Saneo de `filename`:** en `/api/upload/presigned-url` el `filename` se concatenaba crudo a la key de S3. Ahora se sanea (`[^\w.\-]→_`, máx 120 chars) antes de armar la key. BAJO, higiene.
- **Validado:** `node --check` OK (server.js). Sin migraciones.
- **NOTA sobre el "10/10":** con esto se cierra prácticamente toda la deuda de seguridad a NIVEL CÓDIGO de bajo riesgo. Los saltos restantes hacia 8-9 son: 2FA para el admin general (mayor valor), acortar la vida de los tokens de usuario (30-90d → afecta UX), sacar `'unsafe-inline'` de la CSP (refactor grande), y endurecer la INFRA (SSM/Atlas/Firebase rules/Cloudflare WAF/monitoreo) — esto último ya NO es código. El "10/10" no es un estado real alcanzable.

### 83. Seguridad — Batch B: endurecimientos de riesgo cero (defensa en profundidad)
- **Pedido:** seguir con la deuda de seguridad sin romper nada. Se hicieron los hallazgos BAJOS de la auditoría que son arreglos chicos y 100% seguros (no cambian comportamiento para flujos legítimos):
  - **JWT con algoritmo fijado:** `verifyAccessToken`/`verifyRefreshToken` en `src/middlewares/auth.js` (usados por las rutas de referidos, que mueven plata) ahora pasan `{ algorithms: ['HS256'] }` — consistente con los `jwt.verify` de server.js, evita confusión de algoritmos. Los tokens ya eran HS256 → sin impacto en sesiones válidas.
  - **`tokenVersion` normalizado:** 2 guards que usaban `user.tokenVersion && ...` (frágil con tokenVersion 0) pasados a `(decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)` — en `/api/admin/me` (L3640) y en la auth del socket (L7326), igual que el authMiddleware principal. Benigno hoy, pero saca la trampa.
  - **`X-XSS-Protection: 0`** (antes `1; mode=block`): recomendación moderna (el header viejo introdujo vulnerabilidades en navegadores antiguos; la CSP es la defensa real).
  - **`User.statics.findByUsername`** (código muerto): regex sin escapar → ahora escapa metacaracteres (anti-ReDoS / inyección de regex). Saca la trampa por si alguien lo usa a futuro.
- **NO hecho (las 3 "grandes" de la deuda, RIESGOSAS o de producto):**
  - **`'unsafe-inline'` en la CSP de scripts:** sacarlo requiere nonces/hashes + refactorizar TODOS los `onclick` inline del `index.html` (243 KB) a `addEventListener` → refactor enorme y riesgoso. Diferido.
  - **`xss-clean` (deprecado):** sacarlo reduciría defensa en profundidad sin ganar (la protección real es el escape en el output, que el front ya hace). No es vuln activa; es deuda para una eventual migración a Express 5. Se deja.
  - **Mínimo de contraseña (6):** subirlo es decisión de producto (fricción/soporte) más que seguridad pura; el brute-force ya está mitigado por rate-limit. A definir con el owner.
- **Validado:** `node --check` OK (server.js, auth.js, User.js). Sin migraciones. Back necesita redeploy.

### 82. Seguridad — rate-limit de login/sensibles (express-rate-limit) a Redis, con fallback a memoria
- **Continuación de #81:** ahora los limiters de `express-rate-limit` que protegen brute-force: `authLimiter` (10/min: login, register, check-username, change-password, login-otp…) y `sensitiveLimiter` (10/15min: reset password, verify-phone, OTP). También vivían en memoria por instancia → ~N× en multi-instancia.
- **Fix:** custom Store `RedisBackedRateStore` (server.js, sección rate limiting) que implementa la interfaz de express-rate-limit v7 (`init`/`increment`/`decrement`/`resetKey`) con backend Redis (`INCR`+`EXPIRE`, contador compartido entre instancias). Reusa `getRedisClient()` (node-redis v4) — sin dependencias nuevas. Se aplica vía `store: makeRateStore('auth'|'sensitive')`.
- **Diseño a prueba de roturas (clave, porque esto envuelve el LOGIN):**
  - El store DELEGA al `MemoryStore` de la propia librería como fallback. Ante NO-Redis o CUALQUIER error de Redis (`try/catch`), usa el MemoryStore → **comportamiento idéntico al de hoy** (memoria por instancia). Nunca crashea ni bloquea login por un problema de infra.
  - `makeRateStore` devuelve `undefined` si la lib no expusiera `MemoryStore` → el limiter usa su store por defecto (= comportamiento actual). Imposible romper el arranque.
  - `authLimiter` NO usa `skipSuccessfulRequests` (es contador simple) → no hay semántica especial que preservar.
- **Decisión de alcance (mínimo radio de impacto):** **`generalLimiter` (envuelve TODO `/api/`) NO se tocó** — no es un gate de brute-force (es DoS general, 300/min) y es el más riesgoso de tocar. Queda en memoria.
- **Limitación honesta:** en este entorno no se puede correr el server (sin node_modules) → `node --check` valida sintaxis pero NO el runtime. El diseño con fallback al MemoryStore de la lib hace que el peor caso sea = comportamiento actual, pero conviene mirar los logs tras el primer deploy (buscar `Redis rate-limit error` o 429 inesperados en login).
- **Validado:** `node --check` OK (server.js). Sin migraciones. Back necesita redeploy. Beneficio multi-instancia activo cuando `REDIS_URL`/`REDIS_HOST` esté seteado.

### 81. Seguridad — rate-limit de SMS/registro a Redis (anti-spam multi-instancia) con fallback a memoria
- **Problema (deuda de #80):** los limiters por IP de SMS/registro (`smsIpLimiter` 5/15min, `bulkSmsIpLimiter` 1/h, `registerIpLimiter` 3/h) vivían en un `Map` EN MEMORIA por instancia. En AWS EB multi-instancia, cada instancia contaba por su lado → el límite efectivo era ~N× → riesgo de **spam de SMS (cuesta plata real, AWS SNS)** y creación masiva de cuentas para abusar del bono.
- **Fix:** `createIpSmsLimiter` ahora usa un **contador compartido en Redis** (`INCR` + `EXPIRE`, ventana fija) cuando Redis está disponible → el límite se respeta entre TODAS las instancias. Reusa el mismo cliente node-redis v4 + `getRedisClient()` que ya usa `acquireRefundLock` (patrón probado).
- **Sin romper nada (clave):** si NO hay Redis (instancia única / Redis no configurado) o si Redis **falla en medio**, cae automáticamente a la lógica EN MEMORIA original (ventana deslizante) vía `try/catch` → comportamiento idéntico al de antes, nunca crashea ni bloquea a un usuario legítimo por un problema de infra. **Los 3 límites quedan idénticos** (5/15min, 1/h, 3/h), así que para el usuario legítimo no cambia nada.
- **Detalle:** clave Redis `rl:<prefijo>:<ip>` (prefijos `sms`/`bulksms`/`register`); `getRedisClient()` solo devuelve el cliente si está `isReady`; el `Map` de memoria se mantiene como fallback (y su cleanup interval sigue válido).
- **NO migrado (queda pendiente):** los limiters de `express-rate-limit` (`authLimiter` login, `generalLimiter`, `sensitiveLimiter`) siguen en memoria. Migrarlos necesita la dep `rate-limit-redis` + resolver el orden de arranque (Redis conecta en el bootstrap, después de crear los limiters) y `authLimiter` tiene `skipSuccessfulRequests` (semántica distinta) → se deja para una tanda dedicada con cuidado.
- **Validado:** `node --check` OK (server.js). Sin migraciones. Back necesita redeploy. (Si no hay Redis configurado en EB, el SMS sigue protegido como hoy por instancia; el beneficio multi-instancia aparece cuando `REDIS_URL`/`REDIS_HOST` esté seteado, que es lo que ya usa el adapter de Socket.IO.)

### 80. Seguridad — Batch A: cierre de escaladas de privilegio + huecos de plata (sin romper flujos legítimos)
- **Pedido del owner:** mejorar la seguridad en general sin romper nada. Se auditó todo (auth, inyección, endpoints públicos/webhooks, config/secrets) con agentes de solo-lectura y se verificó cada hallazgo a mano antes de tocar.
- **Patrón raíz detectado:** `adminMiddleware` deja pasar 4 roles (admin/depositor/withdrawer/comunidad); varios endpoints sensibles se olvidaron de re-chequear `role==='admin'`.
- **Arreglos aplicados (todos verificados como SEGUROS: el front legítimo no usa los 3 primeros, o el cambio solo restringe a quien no debería):**
  - **`/api/movements/deposit` (CRÍTICO):** solo tenía `authMiddleware` → cualquier usuario se autocargaba fichas reales (`jugaygana.depositToUser`) sin pago. El front NO lo usa (ruta legacy). Se gateó con `depositorMiddleware` + validación estricta de monto.
  - **`PUT /api/admin/config/cbu` (CRÍTICO):** sin recheck → un cajero podía cambiar el CBU adonde va la plata de los depósitos. El panel usa `/api/admin/cbu` (otro endpoint), no este. Se agregó guard `role==='admin'`.
  - **`/api/admin/users/:id/reset-password` (CRÍTICO):** sin recheck → un cajero podía resetear la clave del admin general (takeover total). El panel usa `/api/admin/change-password`. Se agregó guard `role==='admin'`.
  - **Degradación de rol no cortaba la sesión (ALTO):** `PUT /api/users/:id` cambia `role` (ya solo admin) pero NO subía `tokenVersion` → admin degradado seguía con poderes hasta vencer el token (30–90d). Ahora hace `$inc tokenVersion` cuando cambia el rol.
  - **`pendingAccessCode` (MEDIO):** código de acceso de 6 díg. generado con `Math.random()` (predecible) → cambiado a `crypto.randomInt`.
  - **Validación de monto débil (MEDIO):** `amount` string/NaN evadía el guard en `movements/deposit`, `admin/deposit`, `admin/withdrawal` → ahora `Number.isFinite(Number(amount))`.
  - **Webhook hgcash fail-open (CRÍTICO condicional):** si faltaba `HGCASH_WEBHOOK_SECRET` procesaba SIN validar firma. Ahora **fail-closed en producción** (rechaza con 503 + `logger.error`). ⚠️ **ACCIÓN OWNER ANTES DE DEPLOYAR:** confirmar que `HGCASH_WEBHOOK_SECRET` esté cargado en SSM, si no los webhooks de pago dejarían de procesarse.
  - **Endurecimiento CSP:** agregado `object-src 'none'`.
- **Decisión owner (NO restringido):** comandos `/sys_*`, `login-without-password`, `verify-phone` y `canal-url` siguen accesibles a cajeros (los usan en su laburo) — riesgo aceptado a cambio de no cambiarles el flujo.
- **NO aplicado (riesgo de romper):** `hpp` (aplastaría arrays legítimos en el body JSON: influencers, premios fueguito, acceptStatuses, pasos, usernames). Deuda pendiente RIESGOSA: reemplazar `xss-clean` (deprecado), quitar `'unsafe-inline'` de la CSP (requiere nonces, index.html con mucho JS inline), rate-limiters a Redis (multi-instancia → SMS spam), password mínimo >6.
- **Validado:** `node --check` OK en server.js. Sin migraciones. Back necesita redeploy (CONFIRMAR el secret de hgcash en SSM primero).

### 79. Optimización VISUAL + limpieza de código muerto (PWA cliente + panel admin) — SIN cambios de comportamiento
- **Pedido del owner:** optimizar vipcargas, arreglar bugs visuales y limpiar código de más, **garantizando que no se rompa ni se pierda ninguna funcionalidad**. Alcance: ambas superficies; profundidad: solo seguro (bugs visuales + limpieza). Se auditó todo el front con agentes de solo-lectura y se verificó cada hallazgo a mano antes de tocar.
- **Bugs visuales arreglados (cliente):**
  - **Ruleta:** los 3 selectores `#rouletteWinnersList .winner-row, ...` en `index.html` estaban mal agrupados (la coma dejaba el modificador `:last-child`/`.is-me` pegado solo al modal) → en el home TODAS las filas salían con fondo dorado de "ganaste vos" y sin separadores. Corregido (cada selector lleva su propio modificador).
  - **Botón notificaciones:** los estados `.active`/`.blocked`/`.compact` apuntaban a `.header-right` (estructura vieja); el botón vive en `.tb-right`. Se reanclaron en el `<style>` inline del toolbar (`.header-toolbar .notification-btn.active/.blocked`) → ahora cambia de color (verde activo / gris bloqueado) en la PWA instalada.
  - **Botón "Instalar app":** heredaba un glow verde pulsante de `.app-install-btn` sobre el botón violeta del toolbar → incoherente. Se neutralizó (`animation/box-shadow/text-shadow: none`) scopeado al toolbar; `.app-install-btn.show` (visibilidad) intacto.
  - **Toasts:** `z-index` 10000 → 26000 (`base.css`) para que no queden detrás de los modales de ruleta (25500)/plataforma (20000).
- **Bugs visuales arreglados (admin):**
  - **12 íconos en blanco** (`icon-edit/trash/gift/star/image/info/list/mobile/undo/balance/exclamation/spinner`): se usaban en el markup pero no tenían `content` en `admin.css`. Agregados los emoji.
  - **Sección Comandos** sin estilo de tarjeta: el JS renderiza `.command-card/.command-info/.command-response` pero el CSS solo tenía `.command-item` (viejo). Renombrado a `.command-card` + agregados `.command-info`/`.command-response`.
- **Limpieza de código muerto (verificada: 0 referencias en HTML/JS/onclick/window.\*):**
  - `header.css`: **−384 líneas**. Bloques de features muertas tras el rediseño del header: drawer móvil completo, promo-banner, fueguito viejo (`.fire-btn`/`fire-pulse`), `platform-section`/`jugaygana-btn`/`plataforma-btn`, `info-btn`/`support-btn`/`header-left`/`header-center`/`user-action-btns`. Se PRESERVÓ todo lo vivo: `.header` (el header actual es `class="header header-toolbar"`), `.header-right`, `#notificationBtn`/`#appInstallBtn` (media queries de visibilidad), `.app-install-btn`, `.refund-btn`, `golden-shimmer` y el `@media (max-width:768px)`.
  - `admin.js`: 6 funciones nunca llamadas (`verifyDatabaseAccess`, `exportDatabaseCSV`, `handleCommandKeydown`, `prefetchFrequentConversations`, `renderMessagesUltraFast`, `smsValidarTelefono`) + `escapeHtml` definido DOS veces (se borró la copia muerta de L4452; gana la de L8182 por hoisting) + bloque CSS de la sección database vieja + `@keyframes spin`/`icon-download` duplicados en `admin.css`.
  - Cliente: 2 stubs vacíos (`handleFindUserByPhone`, `handleResetPasswordByPhone` + exports) y 4 funciones huérfanas (`toggleDrawer` con DOM ya inexistente, `openWinners`, `renderAdSection`, `showPlatformPasswordInfo`/`copyPlatformPassword`) + limpieza de sus listas de export. Se PRESERVARON `copyText` y `showInstallInstructions` (vivas).
  - **94 `console.log` de debug** eliminados (cliente + admin). Se conservaron TODOS los `console.error`/`console.warn` (manejo de errores). Detección previa confirmó 0 casos de `console.log` como cuerpo de `if` sin llaves y 0 multilínea → borrado seguro de sentencias puras.
- **NO tocado a propósito (riesgo/valor):**
  - `responsive.css`: ~29 reglas muertas (mismos elementos inexistentes) PERO dispersas dentro de 20 media queries y una agrupada con una clase viva (`.user-name`). Son no-op (ajustan en breakpoints elementos que no existen) → se dejaron para no arriesgar romper la estructura de los `@media` por limpiar bytes muertos.
  - **A1 — sidebar del admin inaccesible en celular** (no hay botón ☰ que agregue `.sidebar.open`): bug funcional real en móvil, pero el owner pidió dejarlo por ahora.
  - `checkUsernameAvailability` (cliente): el chequeo de "usuario disponible" en el registro existe pero nunca se dispara → es una MEJORA pendiente (reconectarlo), no código muerto; se dejó intacto.
  - `syncPayout` (admin): función del botón "Sincronizar pago colgado" (banner revertido en #66); se dejó por ser útil e inofensiva.
- **Validado:** `node --check` OK en los 10 JS tocados; llaves balanceadas en `base.css`/`header.css`/`admin.css`. Net **−835 líneas** (46 ins / 881 del). Back NO necesita redeploy de lógica; es front → recargar la PWA y el panel (subir `CACHE_VERSION` del SW si se quiere forzar). Sin migraciones.

## Sesión 2026-06-25

### 78. JUGAYGANA lento → "Error de conexión": timeout corto + retry + mensaje claro
- **Causa (logs):** `ShowUsers timeout of 20000ms` 117× → al chequear saldo, JUGAYGANA tardaba 20s y colgaba al
  cliente → "Error de conexión" con el server arriba.
- **Fix:**
  - `lookupUserOrError` (ShowUsers) ahora usa **timeout 12s por-llamada** (antes el global de 20s). Es una LECTURA,
    debe fallar rápido. NO toca el global de login/createUser (que siguen en 20s).
  - El **retiro** (`/api/withdrawal/request`) ahora chequea saldo con `getUserBalanceWithRetry` (2 intentos) en vez
    de `getUserBalance` simple → el reintento entra la mayoría de las veces (JUGAYGANA es flaky).
  - Mensaje claro al cliente si falla: "La plataforma está demorada, esperá unos segundos" (HTTP 503), en vez de
    colgar y mostrar "Error de conexión".
- **No tocado:** los endpoints de DISPLAY de saldo (6436/6455/6919) — ya se benefician del timeout 12s; agregar
  retry ahí duplicaría la espera sin necesidad.
- **Validado:** `node --check` OK (server.js, jugaygana.js).

### 77. 2do bug igual al del retiro: install-bonus/claim `amountFmt is not defined` (376×) + análisis logs
- **Re-análisis de logs a fondo (a pedido del owner):** los 500 "Error del servidor" tenían DOS causas de código
  (mismo patrón: copiar la respuesta de un handler a otro y dejar una variable de otro scope):
  - `withdrawal/request: result is not defined` → **341×** (ya arreglado en #75).
  - `install-bonus/claim: amountFmt is not defined` → **376×** (ARREGLADO acá: usaba `amountFmt`, variable del
    handler de retiro; el correcto es `INSTALL_BONUS_AMOUNT`). El bono ES idempotente (reserva atómica antes de
    acreditar) → los 376 NO dieron bono doble; el usuario recibía el bono pero veía "error" → confusión, no pérdida.
- **"Error de conexión" random SIN deploy (lo aclaró el owner):** NO son reinicios (45 deploys ≈ 48 arranques, casi
  todos deploy). Es **JUGAYGANA lento**: `ShowUsers timeout of 20000ms` **117×** (~10/día) + `unable to verify the
  first certificate` (intermitente). Cuando una acción chequea saldo y JUGAYGANA tarda, el pedido se cuelga y el
  cliente corta → "Error de conexión" con el server arriba. PENDIENTE: bajar timeout + mensaje claro (a definir).
- **Validado:** `node --check` OK (server.js).

### 76. "Error de conexión" intermitente → diagnóstico por logs + graceful shutdown
- **Diagnóstico (logs EB Jun 14–25):** el server reinició **~48 veces en 11 días**. SIN crashes de código (0
  uncaughtException, sin stack traces), SIN errores de SMS/SNS. nginx: solo 6× 502 (durante reinicios). El
  `eb-engine.log` muestra muchísima actividad de deploy. Un deploy falló (Jun 23 19:48, `web.service exit-code 1`).
- **Causa:** los reinicios eran casi todos **deploys** (semana muy pesada de cambios). Como NO había **graceful
  shutdown**, EB mataba el proceso de golpe → los pedidos EN CURSO se cortaban → cliente veía "Error de conexión".
  No es bug de código ni de SMS.
- **Fix (código):** se agregó **apagado ordenado** en server.js (SIGTERM/SIGINT → `io.close()` + `server.close()`
  drena pedidos en curso, salida forzada a los 25s). Reduce muchísimo los "Error de conexión" en cada deploy.
- **Pendiente (config, lo hace el owner en consola EB):** activar **deploys rolling** (una instancia a la vez) para
  cero downtime. Y evitar deploys innecesarios. (Opción futura: reintento suave en el front para send-otp.)
- **Validado:** `node --check` OK (server.js).

### 75. FIX CRÍTICO retiro: 500 "Error del servidor" tras crear el pedido → solicitudes duplicadas + teléfono PY/AR
- **Incidente (moi1/moi2):** al solicitar retiro salía "Error del servidor" PERO la solicitud entraba (se creaba el
  PendingPayout + se mandaba "Recibimos tu solicitud"). El cliente reintentaba y se duplicaban las solicitudes
  (visto: el mismo $37.000 4 veces).
- **Causa (regresión #68):** la respuesta de `/api/withdrawal/request` todavía referenciaba `result.data` (el viejo
  `withdrawFromUser` que se eliminó al pasar a descontar-al-confirmar). `result` quedó undefined → ReferenceError →
  500, PERO DESPUÉS de crear el PendingPayout y mandar el mensaje. `node --check` no lo agarra (es runtime).
- **Fix:** se sacó la referencia a `result.data` de la respuesta. Además, **dedup**: si ya hay un retiro
  `pending_review` del MISMO monto creado hace <10 min, no se crea otro (devuelve éxito idempotente).
- **FIX teléfono PY/AR (mejora del #74):** `normalizePhoneKey` ahora saca el código de país + el "0" inicial
  (trunk PY/AR) + el "9" de móvil AR → el mismo número con 0 de Paraguay o 9 de Argentina cae en la MISMA clave
  (antes "últimos 10" no normalizaba el 0 → se colaba). Se actualizó también el chequeo de `verify-phone/send-otp`
  (faltaba, seguía por string exacto). Migración one-shot V2 (`migration_backfill_phonekey_v2_done`) que recalcula
  phoneKey de TODOS los verificados con la lógica nueva. Probado: PY con/sin 0 y AR con/sin 9 → misma clave.
- **PENDIENTE (#2 del owner):** "Error de conexión" intermitente al verificar teléfono / otras opciones → es un
  TIMEOUT (no un 500), probable lentitud de SMS (AWS SNS) o carga del server. Necesita logs para diagnosticar.
- **Validado:** `node --check` OK (server.js, security.js). Back necesita redeploy (corre la migración V2).

## Sesión 2026-06-24

### 74. Anti-multicuenta: email único + teléfono único robusto (clave normalizada)
- **Problema:** se creaban muchas cuentas con el MISMO email o el MISMO teléfono. Causa: (1) NUNCA se chequeaba
  email duplicado (ni en `register` ni en `register-quick`); (2) el SMS dejó de ser obligatorio al registrarse
  (commit "registro sin SMS") → el teléfono se verifica recién al retirar; y (3) el chequeo de teléfono era por
  STRING EXACTO → el mismo número en otro formato (+54.., 011.., con/sin 9) se colaba.
- **Decisión owner:** el registro queda SIN teléfono (se verifica al retirar, como ahora), PERO un número ya
  verificado por otro usuario NO se puede volver a verificar (números únicos por usuario) + bloquear emails duplicados.
- **Fix:**
  - **`phoneKey`** (nuevo campo en User): clave normalizada del teléfono = solo dígitos, últimos 10 (helper
    `normalizePhoneKey` en `security.js`). El MISMO número en distinto formato → misma clave.
  - Los 4 puntos que verifican teléfono (`register`, `change-password`, `change-password/pending`,
    `verify-phone/confirm`) ahora chequean unicidad por `phoneKey` (no por string exacto) y setean `phoneKey` al verificar.
  - **Email único:** `register` y `register-quick` ahora rechazan si el email (case-insensitive) ya está en otra
    cuenta. Solo valida si el cliente cargó email (es opcional). NO rompe las cuentas existentes que ya compartan email.
  - **Migración one-shot** `migration_backfill_phonekey_done`: rellena `phoneKey` en los usuarios con teléfono ya
    verificado, para que el chequeo funcione contra los existentes.
- **No tocado:** los lookups de login-por-teléfono / reset siguen por `phone` exacto (no son unicidad, y cambiarlos
  arriesgaba romper el login).
- **Validado:** `node --check` OK (server.js, User.js, security.js). Back necesita redeploy (corre la migración).

### 73. Reembolsos: ahora sobre el NETWIN/GGR REAL (no sobre cargas − retiros)
- **Hallazgo:** los reembolsos (diario/semanal/mensual) se calculaban sobre `cargas − retiros` (flujo de caja),
  NO sobre la pérdida real de juego. Pagaban de más (contaban como "pérdida" plata que el cliente tenía en saldo).
  Había un comentario "consultar NETWIN (misma fuente que referidos)" pero NUNCA se conectó: el `jugayganaUserId`
  se usaba solo para validar que la cuenta esté vinculada, y el cálculo seguía siendo depósitos − retiros locales.
- **Fix:** se conectó `referralRevenueService.getUserNetwinForDateRange(username, jgId, fromDate, toDate, label)`
  (ya existía, construida para reembolsos: consulta `royalty-statistics` de JUGAYGANA por rango de fechas y devuelve
  `totalGgr` = apostado − ganado). Ahora `netLoss = max(0, totalGgr)` = **pérdida REAL del juego** en el período.
  - **Status** (`/api/refunds/status`): 3 llamadas netwin en paralelo (daily/weekly/monthly). Si una falla → ese
    netLoss = 0 (no preview de más).
  - **Claims** (`/api/refunds/claim/{daily|weekly|monthly}`): usan netwin; si JUGAYGANA no responde → NO reembolsa
    (mensaje "no pudimos calcular tu pérdida, probá más tarde"), no paga a ciegas.
- **% sin cambios** (20/10/5 editables). El reembolso = % × netwin real.
- **Pendiente conocido (no pedido):** los períodos semanal y mensual se pueden SOLAPAR (semana pasada dentro del
  mes pasado) → doble reembolso (10%+5%) en esa franja. Se mencionó al owner; no se tocó.
- **Nota de carga:** el status ahora hace 3 consultas a JUGAYGANA (antes eran aggregates locales). El front NO
  pollea el status en loop (solo al abrir / tras reclamar / al vencer el contador), así que la carga es ocasional.
- **Validado:** `node --check` OK (server.js). Back necesita redeploy.

### 72. Premios del Fueguito EDITABLES desde el panel (Config['fireMilestones'])
- **Pedido:** poder armar/cambiar los premios del fueguito (días + montos + requisitos) sin tocar código.
- **Backend:** `FIRE_MILESTONES` pasó a ser editable: `getFireMilestones()` lee `Config['fireMilestones']`
  (normaliza/clampea/ordena/dedup por día; todos type:'cash'); si no hay config usa `FIRE_MILESTONES_DEFAULT`
  (10/20/30 días = $10k/$50k/$200k). Los 3 endpoints (status, claim, claim-reward) ahora hacen
  `await getFireMilestones()`. `nextReward` calculado del próximo hito (no hardcodeado).
  - Endpoints admin (solo admin general): `GET/POST /api/admin/fire-milestones`.
- **Panel:** card "🔥 Premios del Fueguito" en COMANDOS (al lado de reembolsos): tabla editable con día, premio $,
  requisito de carga $, en N días, descripción; botones agregar/quitar fila + guardar. `loadFireMilestones`/
  `addFireMilestoneRow`/`saveFireMilestones` en admin.js.
- **Nota:** todos los premios son EFECTIVO (se sacaron los bonos en #71). Requisito 0 = sin requisito de carga.
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy; panel, recargar.

### 71. Se SACARON todos los bonos automáticos (queda el 100% recuperación Comunidad) + ruleta solo activos
- **Decisión owner:** sacar TODOS los bonos automáticos. Se mantiene SOLO la oferta `/sys_recover_100` (100% de
  recuperación de Comunidad, post-carga). Se mantienen también: premios en efectivo del fueguito (día 10/20/30),
  reembolsos, bono por instalar app.
- **Apagados (kill switches en código, reversibles poniendo el flag en false):**
  - **Estrategia por voto:** `BONUS_STRATEGY_DISABLED = true`.
  - **Inactividad** (bono % + regalo ticket alto): `INACTIVIDAD_DISABLED = true` (early-return en `_runInactividadTick`).
  - **Bonos % de reglas de notificación:** `CHARGE_BONUSES_DISABLED = true` en `notificationRulesService.activateChargeBonuses`
    (las notis de enganche siguen saliendo, pero ya NO crean PromoBonus). La estrategia por voto también lo usaba → doble apagado.
  - **Fueguito día 15** (bono en próxima carga): hito SACADO de `FIRE_MILESTONES` (quedan solo los de efectivo).
    La migración #70 (`migration_clear_fire_nextload_done`) ya limpia los `pendingNextLoadBonus` que quedaron.
  - (encuesta ya estaba apagada desde #57).
- **Ruleta diaria — solo CLIENTES ACTIVOS:** activo = MÁS DE 10 cargas reales (deposits, sin regalos/devoluciones)
  en los últimos 30 días (`_rouletteIsActiveClient`, const `ROULETTE_MIN_CARGAS_30D=10`). El status devuelve
  `eligible=appOk && active` (la card se oculta si no califica) + `needsActive`; el spin bloquea con 403 si no es activo.
  Fail-open ante error de DB (no castiga por un fallo de lectura).
- **Resultado:** ningún motor crea PromoBonus automático. Lo único que "regala" automático es la oferta de Comunidad.
- **Validado:** `node --check` OK (server.js, notificationRulesService.js). Back necesita redeploy.

### 70. El "bono 100% a clientes activos" era el FUEGUITO (hito día 15) → bajado a 30%
- **Diagnóstico:** el owner reportaba bonos del 100% a clientes ACTIVOS. Verificado que NINGÚN motor de bonos los
  crea (inactividad/notificaciones/estrategia/encuesta TODOS capean a ≤30%). El 100% salía del **FUEGUITO**: el hito
  `day:15` (`FIRE_MILESTONES`) era `type:'next_load_bonus'` = "100% en próxima carga", que ganan los clientes que
  mantienen la racha 15 días (activos). El sistema marca `pendingNextLoadBonus` y el agente aplica el 100% a mano.
- **Cambio (decisión owner):** el hito día 15 baja de **100% → 30%**. Es solo texto (el flag es booleano; el agente
  aplica el % manualmente): se cambió el `desc` del milestone, el mensaje de claim (server.js), el banner + confirm
  del agente (admin.js) y los textos del cliente (fire.js). El `/sys_recover_100` (oferta de "100% de recuperación"
  post-carga) es OTRA cosa, no se tocó (es editable desde COMANDOS).
- **Limpieza de pendientes:** migración one-shot `migration_clear_fire_nextload_done` que pone `pendingNextLoadBonus:
  false` a TODOS los que lo tenían pendiente → no se les aplica el 100% viejo. Corre una vez en el próximo deploy.
- **Validado:** `node --check` OK (server.js, admin.js, fire.js). Back necesita redeploy; panel/cliente, recargar.

### 69. FIX "Limpiar pagos viejos": ahora incluye pending_review y descarta TODOS
- **Problema:** el botón "🧹 Limpiar pagos viejos colgados" solo tocaba `paying`/`failed` y NO los `pending_review`,
  que son justo los que aparecen en el banner del chat → "no funciona". Además dejaba sin tocar los PENDING/sin-tx.
- **Fix:** `POST /api/admin/payouts/cleanup-old` ahora barre **pending_review + paying + failed** más viejos que
  `hours` (default 2, `0` = todos) y los **DESCARTA** (`cancelled`/dismissed) — salvo los que tienen transacción
  hgcash confirmada DONE, que quedan `paid` (silencioso). NO mueve plata ni devuelve fichas. El botón refresca el
  banner del chat abierto y avisa el resumen. Script `hgcash-cleanup-old-payouts.js` actualizado igual.
- **Validado:** `node --check` OK (server.js, admin.js, script). Back necesita redeploy; panel, recargar.

### 68. REDISEÑO retiros: descontar fichas al CONFIRMAR el pago (no al solicitar)
- **Problema:** el self-retiro descontaba las fichas al SOLICITAR; al rechazar había que DEVOLVERLAS con la lógica
  bonus/comunes, que fallaba seguido (devolvía mal / acuñaba saldo).
- **Nuevo flujo (decidido con el owner):**
  - **Solicitar (`/api/withdrawal/request`):** ya NO descuenta nada. Crea el `PendingPayout` con `deductAtPay:true`
    (chequea saldo solo como validación de UX). El saldo del cliente NO baja todavía.
  - **Confirmar (`/api/admin/payouts/:id/pay`):** helper nuevo `_deductChipsAtConfirm` descuenta las fichas AHORA
    (lee saldo → `withdrawFromUser` → verifica anti-fantasma que el saldo bajó). Solo si el descuento se CONFIRMA
    sigue el cash-out. Registra la `Transaction` de retiro recién acá.
    - **Saldo insuficiente (se jugó las fichas):** NO se paga; se marca `cancelled`, se manda mensaje EDITABLE al
      cliente (`/sys_withdrawal_insufficient`, vars `${amount}`/`${balance}`) y se CIERRA el chat (si el cliente
      escribe se reabre en "Abiertos"; si pide otro retiro va a Pagos). Helper `_notifyInsufficientAndCloseChat`.
    - **Pago hgcash falla DESPUÉS de descontar:** NO se devuelven fichas; nota interna "las fichas YA se descontaron
      ($X), pagá manual / reintentá". Igual en el webhook de error (`handlePayoutStatusWebhook`) si `deductAtPay+confirmado`.
  - **Rechazar (`/cancel`) con flujo nuevo:** si todavía no se descontó → NO devuelve nada (se acabó el bug). Si ya
    se había descontado (debitConfirmed===true, ej. cash-out falló) → devuelve el monto COMPLETO como fichas
    (devolución SIMPLE, sin split bonus/comunes).
  - **Pagar con otro banco (`/pay-other-bank`) con flujo nuevo:** también descuenta al confirmar antes de marcar pagado.
- **Compatibilidad:** los pagos VIEJOS (creados antes, con fichas ya descontadas) tienen `deductAtPay` falsy →
  mantienen el comportamiento previo (pagar = solo cash-out; rechazar = lógica vieja con split). No se re-descuentan.
- **Modelo:** `PendingPayout.deductAtPay` (Boolean, default false). Comando sembrado `/sys_withdrawal_insufficient`.
- **Panel:** `payPayout`/`payOtherBank` manejan la respuesta `{insufficient:true}` (toast claro + ocultan banner).
- **Validado:** `node --check` OK (server.js, PendingPayout.js, admin.js). Back necesita redeploy; panel, recargar.

## Sesión 2026-06-23

### 67. Botón "Limpiar pagos viejos colgados" en el panel (sin terminal) + script
- **Pedido:** el owner no maneja terminal → necesita limpiar los pagos viejos colgados con un clic.
- **Endpoint `POST /api/admin/payouts/cleanup-old`** (solo admin general): resuelve los PendingPayout viejos
  (paying/failed más viejos que `hours`, default 2h, máx 500): consulta hgcash y marca DONE→`paid` (SILENCIOSO,
  no re-avisa ni re-paga), ERROR/CANCELLED→`cancelled`. Los que siguen realmente pendientes (o sin token/tx) NO se
  tocan (se reportan en `pendingLeft`). NUNCA mueve plata.
- **Panel:** botón **"🧹 Limpiar pagos viejos colgados"** en el header de Movimientos hgcash (sección Comandos,
  admin general). Confirmación + toast con el resumen (pagados/descartados/pendientes). Función `cleanupOldPayouts()`.
- **Script equivalente** (para terminal): `scripts/hgcash-cleanup-old-payouts.js` (dry-run por defecto, `--apply`,
  `--no-verify`, `--hours=N`).
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy; panel, recargar.

### 66. FIX URGENTE regresión de pagos: el banner resucitaba pagos viejos + pago no se confirmaba solo
- **Incidente:** tras #65, el banner de pago del chat pasó a mostrar pagos `paying`/`failed` (no solo
  `pending_review`). Resultado: aparecían pagos VIEJOS colgados (ej. "PAGO EN PROCESO $29.000") en el chat de un
  cliente, en cascada (al resolver uno aparecía otro viejo). Además el botón **"Reintentar pago"** en `failed`
  podía **RE-PAGAR un retiro viejo** (pérdida de plata). Y los pagos nuevos no se confirmaban solos: quedaban
  `paying` (el webhook de hgcash no llega — probable Cloudflare) y había que tocar "Sincronizar" a mano.
- **Fix:**
  - **Banner revertido a SOLO `pending_review`** (`loadPayoutBanner`): se quitó la rama paying/failed con los
    botones Sincronizar/Reintentar. El banner vuelve a mostrar únicamente el retiro actual a verificar, como antes.
    Elimina el riesgo de re-pago y la cascada de pagos viejos.
  - **Poller `_pollPayingPayouts` (server.js):** cada 45s (1er run a los 90s) consulta el estado real en hgcash
    (`getTransactionStatus`) de los pagos `paying` RECIENTES (últimas 2h) y, si están DONE, los confirma vía
    `handlePayoutStatusWebhook` (marca pagado + avisa + manda comprobante, TODO idempotente). Así los pagos se
    confirman SOLOS aunque no llegue el webhook, sin resucitar pagos viejos (>2h no se tocan).
  - **Re-chequeo rápido:** el endpoint `/payouts/:id/pay`, si el cash-out queda `paying`, dispara un poll a los 7s
    → el pago se confirma casi al instante sin esperar el poller.
- **OJO (acción del owner):** revisar si algún cliente recibió **doble pago** por el botón "Reintentar" (movimientos
  hgcash salientes duplicados al mismo CBU). "Sincronizar" NO movía plata (solo estado); "Reintentar" sí.
- **Causa de fondo (pendiente):** el webhook de estado de pago (`/api/hgcash/webhook` topic TRANSACTION_REQUEST) no
  llega → regla WAF "Skip" en Cloudflare para esa ruta. El poller es el respaldo mientras tanto.
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy; panel, recargar.

### 65. Panel hgcash en TIEMPO REAL: saldo en vivo + actualización por socket + destrabe de pagos
- **Pedido (paso 3):** control de transacciones hgcash en tiempo real dentro de VipCargas, para que el agente no
  entre más a hg.cash.
- **Saldo en vivo:** endpoint `GET /api/admin/hgcash/balance` (solo admin general, cache 15s) que usa `GET /accounts`
  de hgcash (`balance`/`netBalance`/`status`). Widget "💰 Saldo hgcash" arriba de la tabla de movimientos +
  `loadHgcashBalance()`.
- **Tiempo real:** `_emitHgcashUpdate()` (server) emite `notifyAdmins('hgcash_movement')` cuando entra un movimiento
  nuevo (webhook) o se concreta una auto-carga. El panel escucha `socket.on('hgcash_movement')` → `hgcashLiveRefresh()`
  (throttle 2.5s, solo si el panel está visible; refresca movimientos página 1 + saldo). Además auto-refresco cada 25s
  mientras el panel está abierto (`startHgcashLive`), sin resetear la vista si el agente paginó (`window._hgcashPage`).
- **Destrabe de pagos colgados:** `GET /transaction/{id}/status` (hgcash) vía `hgcashPay.getTransactionStatus`.
  Endpoint `POST /api/admin/payouts/:id/sync` (withdrawer) que consulta el estado real y REUSA
  `handlePayoutStatusWebhook` para mapear (DONE→paid+aviso+comprobante; ERROR/CANCELLED→failed). En el panel, el banner
  de pago del chat ahora también muestra pagos `paying`/`failed` con botones **🔄 Sincronizar estado** (+ Reintentar/
  Otro banco/Rechazar/Descartar según estado). Función `syncPayout()`.
- **Sin romper nada:** el flujo `pending_review` del banner queda igual; solo se agrega la rama paying/failed. El saldo
  cachea 15s. Endpoints admin-only.
- **Validado:** `node --check` OK (server.js, hgcashService.js, admin.js). Back necesita redeploy; panel, recargar.
- **Limitación conocida (API hgcash):** NO hay listado de movimientos ENTRANTES por API (solo webhook) → la
  reconciliación de cargas depende de la confiabilidad del webhook (regla WAF "Skip" en Cloudflare para
  `/api/hgcash/webhook`). El saldo y los pagos salientes sí se consultan por API.

### 64. Comprobante de pago enviado COMO FOTO (rasterizado del PDF) + link al PDF oficial
- **Pedido:** que el comprobante (#63) le llegue al cliente como **foto** en el chat, no solo como link.
- **Cómo:** se baja el PDF (`hgcashPay.fetchReceiptPdf`), se **rasteriza la 1ª página a PNG** y se manda como
  mensaje `type:'image'` (data URL base64). Después se manda el **link al PDF oficial** (#63) como segundo mensaje.
  Si la foto no se puede generar, se manda solo el link (fallback).
- **Dependencia (OPCIONAL, sin riesgo de romper el deploy):** `mupdf@^1.27.0` — WebAssembly, **sin binarios nativos**.
  - Va en `optionalDependencies` → si fallara la instalación en EB, `npm ci` NO se cae (lo saltea).
  - `src/services/pdfImageService.js`: `pdfBufferToPng(buffer)` carga mupdf **lazy** con `import()` dinámico (mupdf es
    ESM) dentro de try/catch; ante cualquier error devuelve `null` → el caller manda el link. Nunca tira.
  - Probado localmente: PDF real → PNG válido; buffer inválido → null (fallback) sin romper. `npm ci --dry-run` OK
    (lockfile en sync). `node_modules` queda gitignoreado.
- **`server.js` `maybeSendPayoutReceipt`:** intenta foto (cap 4MB) y siempre manda el link; `data:image/png;base64`
  se renderiza en el chat del cliente (`public/js/chat.js` ya soporta imágenes data URL).
- **Validado:** `node --check` OK (server.js, pdfImageService.js, hgcashService.js). Back necesita redeploy
  (corre `npm ci` → instala mupdf).

### 63. Comprobante PDF automático al pagar un retiro (API hgcash)
- **Pedido:** cuando se confirma un pago (cash-out hgcash), mandarle al cliente el **comprobante PDF** automáticamente.
- **API:** `GET /transactions/{txId}/receipt` → `{ signedUrl }` (PDF, **vence en 1h**). El `{txId}` es el id de la
  TRANSACCIÓN real (≠ id del REQUEST que devuelve `POST /transactions`). Se resuelve con
  `GET /transaction-requests/{reqId}/transaction-id` → `{ transactionId }`, o viene en el webhook `transaction_associated`.
- **Implementación:**
  - `src/services/hgcashService.js`: nuevas `getTransactionIdForRequest(reqId)` y `getReceiptUrl(txId)`.
  - `PendingPayout`: nuevos `hgTxId` (id de transacción real) y `receiptSentAt` (idempotencia). Aclarado que
    `hgTransactionId` guarda el id del REQUEST.
  - `server.js`:
    - `handlePayoutStatusWebhook`: captura `p.transactionId` → `hgTxId`; en `DONE` dispara `maybeSendPayoutReceipt`.
    - `resolvePayoutTxId(payout)`: devuelve `hgTxId` o lo pide a la API con el reqId y lo cachea.
    - `maybeSendPayoutReceipt(payout)`: resuelve el txId (3 reintentos x4s por si tarda en asociarse), reclama
      atómico `receiptSentAt` (no duplica entre webhook DONE + pago inmediato) y manda al cliente un mensaje con un
      **link PERMANENTE nuestro** `/api/payout-receipt/:id`.
    - Endpoint PÚBLICO `GET /api/payout-receipt/:payoutId` (sin auth, clave = payout.id UUID): en cada visita resuelve
      un **signedUrl fresco** de hgcash y redirige (302). Así el link nunca queda vencido (la URL firmada dura 1h).
    - También se dispara en el camino DONE-inmediato del endpoint `POST /api/admin/payouts/:id/pay`.
  - El link se auto-linkea en el chat del cliente (`public/js/chat.js`). Pago por "otro banco" NO manda PDF (no hay
    transacción hgcash).
- **Validado:** `node --check` OK (server.js, hgcashService.js, PendingPayout.js). Back necesita redeploy.
- **PENDIENTE (paso 3):** panel hgcash en tiempo real (saldo en vivo `GET /accounts` + entrantes/salientes en vivo por
  socket + badge de estados + destrabe de pagos colgados `GET /transaction/{id}/status`).

### 62. FIX CRÍTICO doble/triple carga hgcash: 1 transferencia se acreditaba 2-3 veces
- **Incidente (VipAnto591):** un comprobante de $35.000 generó **3 cargas** (1 manual del agente + 2 automáticas).
  Confirmado en JUGAYGANA (depósitos 13:13:57 manual, 13:16:59 auto, 13:17:51 auto). **No es aislado:** el barrido
  de logs (6 días) mostró ~99 pares sospechosos y al menos otro caso DURO (VipBelen037, $30.000 cargado 3 veces).
- **Causa raíz (2 fallas que se combinan):**
  1. **El claim atómico protege documentos, no la plata real.** El movimiento se reclama por `movementId` y el
     comprobante por su `id`. Eso evita cargar 2 veces el MISMO documento, pero NO la misma TRANSFERENCIA cuando hay
     (a) **varios `BankMovement` de una sola transferencia** (hgcash reenvía con otro `id`, mismo `coelsaCode` — el
     webhook dedupea solo por `movementId`), y/o (b) **varios `Comprobante` matcheables** del mismo recibo (un
     comprobante duplicado igual se guardaba con `bankMatchStatus:'none'` → seguía siendo candidato). Cada movimiento
     agarra un comprobante distinto → ambos cargan, sin disparar el guard de ambigüedad.
  2. **La carga manual antes de que llegue el movimiento no protegía.** `hgcashConsumeOnManualDeposit` sólo mira
     movimientos que YA existen. Cuando el agente carga a mano y el aviso del banco llega después, se auto-carga igual.
- **Fix (idempotencia anclada en `coelsaCode` = el "DNI" único de cada transferencia + red de seguridad):**
  - **Modelo nuevo `HgcashCharge`** (`src/models/HgcashCharge.js`): índice ÚNICO en `chargeKey`. Candado atómico entre
    instancias (AWS EB multi-instancia).
  - **`hgcashAutoCarga` (server.js):** antes de acreditar reclama `chargeKey = coelsaCode || externalId`. Si ya existe
    (11000) → **NO recarga**, marca el movimiento `duplicate` y avisa. Una transferencia = una carga. Si la carga falla
    en JUGAYGANA, el candado se BORRA (deleteOne) para permitir reintento legítimo.
  - **Red de seguridad (mismo `hgcashAutoCarga`):** si ya hubo una carga del MISMO monto a ese usuario hace pocos
    minutos (config `duplicateGuardMinutes`, default 8), **no carga sola → `needs_review`** + aviso "verificá si son 2
    transferencias reales y cargá a mano". Cubre el caso manual-y-después-webhook (VipAnto591) y duplicados sin coelsa.
  - **Comprobantes `duplicate` excluidos de candidatos** en `hgcashMatchFromMovement` (`status: { $ne:'duplicate' }`).
  - **`hgcashConsumeOnManualDeposit`** ahora también consume movimientos `needs_review` (al cargar a mano se limpian).
  - **Estados nuevos** `duplicate` y `needs_review` en `BankMovement.matchStatus` y `Comprobante.bankMatchStatus`;
    badges + filtros en el panel (`admin.js`/`index.html`).
- **Para el agente:** en el 95% NADA cambia (carga automática igual). Sólo aparece un aviso nuevo "⚠️ POSIBLE
  DUPLICADO — revisá y cargá a mano" cuando hay monto repetido en ventana corta. La atribución del usuario sale del
  chat; un movimiento frenado se limpia solo si el agente carga a mano ese monto.
- **Reporte de afectados (one-shot, SOLO LECTURA):** `scripts/hgcash-duplicates-report.js` — agrupa `BankMovement`
  por `coelsaCode` y lista DEFINITIVOS (mismo coelsa cargado 2+ veces, con sobrante total a descontar) vs PROBABLES
  (mismo usuario+monto en ventana, a revisar). Correr: `node scripts/hgcash-duplicates-report.js`.
- **Mitigación inmediata recomendada:** poner hgcash en modo SOMBRA desde el panel hasta desplegar este fix.
- **Validado:** `node --check` OK (server.js, HgcashCharge.js, BankMovement.js, Comprobante.js, admin.js, script).
  Back necesita redeploy; panel, recargar.
- **PENDIENTE (próximos pasos pactados):** (2) comprobante PDF automático al pagar un retiro (API hgcash
  `GET /transactions/{id}/receipt`); (3) panel hgcash en tiempo real (saldo en vivo `GET /accounts` + entrantes/
  salientes en vivo por socket + destrabe de pagos colgados `GET /transaction/{id}/status`). NOTA: la API hgcash NO
  tiene listado de movimientos entrantes (sólo webhook) → la confiabilidad del webhook (regla WAF "Skip" en Cloudflare)
  es clave. Opción de fondo a evaluar: `checkouts` (links de cobro por cliente) eliminaría el matcheo de comprobantes.

### 61. FIX CRÍTICO retiro fantasma: el rechazo dejaba de acuñar saldo que el cliente nunca tuvo
- **Incidente:** un cliente pidió pago automático de $565.000 (lo tenía, se le pagó). Después solicitó
  $200.000 y $92.000 **sin tener fondos** (saldo real $991). Esos retiros igual generaron `PendingPayout`,
  y al darles **"Rechazar"** se le **devolvieron** $200.000 y $92.000 en fichas (DEPOSIT en JUGAYGANA) que
  hubo que sacar a mano. Capturas: JUGAYGANA mostraba DEPOSIT 200k/92k (la devolución) + WITHDRAW 200k/92k
  (la corrección manual), saldo siempre 991 → **no hubo descuento original**.
- **Causa raíz:** tras el pago grande, el saldo del listado **ShowUsers** de JUGAYGANA quedó **desactualizado
  (alto)**. Entonces (1) el chequeo de saldo de `/api/withdrawal/request` pasó con el saldo viejo, y (2)
  `jugaygana.withdrawFromUser` devolvió **falso éxito** (`WithdrawMoney` no chequea saldo; éxito = `success`
  o `transfer_id`) sin descontar nada. Se creó el `PendingPayout` **sin descuento real**. El **cancel
  re-acreditaba el monto completo a ciegas** (`depositToUser`), confiando en "el self-retiro ya descontó" →
  acuñaba fichas.
- **Fix (defensa en ambas puntas + flag de revisión; decisión owner: permitir pero marcar, no bloquear):**
  - **Al solicitar (`/api/withdrawal/request`):** tras `withdrawFromUser`, se relee el saldo
    (`getUserBalanceWithRetry`) y se exige que haya **bajado al menos el monto** (`debitConfirmed`). Se guardan
    `balanceBefore/balanceAfter/debitConfirmed` en el `PendingPayout`. Si no se confirma, **igual se crea** el
    pago pero queda marcado y se deja **nota interna** al agente ("verificá el saldo real antes de pagar; si
    rechazás, no se devuelven fichas solas").
  - **Al rechazar (`/api/admin/payouts/:id/cancel`):** si `debitConfirmed===false` → **NO devuelve fichas**;
    cancela y deja nota para devolver a mano si corresponde (`skippedRefund:true`). Pagos viejos
    (`debitConfirmed` null/undefined) **siguen con el comportamiento previo** (compatibilidad).
  - **Modelo `PendingPayout`:** nuevos campos `balanceBefore`, `balanceAfter`, `debitConfirmed` (default null).
  - **Panel (`adminprivado2026`):** el banner del retiro se pinta **rojo** + cartel "⚠️ Descuento NO confirmado"
    cuando `debitConfirmed===false`; el `confirm()` y el toast del rechazo aclaran que puede no devolver fichas.
- **Nota:** sólo cambia el camino de **rechazo** ante descuento no confirmado; **pagar** un retiro flageado no
  se bloquea (el agente verifica el saldo real). El riesgo de falso flag (lectura lenta) sólo cuesta que, si se
  rechaza ese retiro, la devolución se haga a mano.
- **Validado:** `node --check` OK (server.js, PendingPayout.js, admin.js). Back necesita redeploy; panel, recargar.

## Sesión 2026-06-22

### 60. Estrategia por voto reactivada (≤30%) + regalo ticket alto $3.000 + tablero de reactivación
- **Estrategia por voto (BonusStrategyConfig):** reactivada (estaba apagada en #57). Ahora **escalonada y
  capeada a 30%** (defaults 15% → 30%) y vigencia ≤2h. `BONUS_STRATEGY_DISABLED=false`; validación del POST
  `_step` capea percent ≤30 y duración ≤120min; el GET clampea para mostrar (por si quedó un singleton viejo
  50/100); modelo `BonusStrategyConfig` con `stepSchema` max 30 y defaults 15/30. El runtime ya estaba protegido
  por el cap de `activateChargeBonuses` (#58).
- **Regalo de reactivación TICKET ALTO ($3.000):** nuevo, dentro de `inactividadService`. Para clientes de
  ticket alto (ticket promedio ≥ `minTicketARS`, default $30.000) que dejaron de cargar ≥ `dias` (default 14):
  un **regalo de monto fijo ≤$3.000**, **máximo 1 vez por mes** (fireKey con mes ART), vigencia configurable
  (default 48h, máx 7d). Se entrega por **push** ("reclamá con soporte") y se registra como `PromoBonus`
  (`sourceRuleCode:'regalo_ticket_alto'`, `montoFijoARS`, percent 0). Si un cliente califica para el regalo,
  ese tick recibe el regalo en lugar del bono %. La agregación de inactividad ahora trae también total+cantidad
  de cargas (para el ticket promedio). Config en `inactividadConfig.regaloTicketAlto` (defaults + caps en
  `mergeInactividadConfig`, tope `REGALO_TA_MAX_ARS=3000`). Apagado por defecto.
- **Banner de bono:** `_getActivePromoBonus` ahora filtra `percent > 0` → los regalos (percent 0) no aparecen
  como "0%" en el banner de "% en la carga"; se entregan por push/soporte y se trackean aparte.
- **Tablero de seguimiento de reactivación:** nuevo `GET /api/admin/reactivacion/stats?days=` (solo admin
  general) que agrega TODOS los `PromoBonus` por `sourceRuleCode` y por día: **enviados** (creados),
  **reclamados** (status used), tasa de reclamo, activos, e **ingreso** (cargaMonto de los reclamados). En el
  panel, sección **Inactivos** → card "📊 Seguimiento de estrategias de reactivación" (tarjetas + tabla por
  estrategia + serie por día). Los regalos se reclaman con soporte (no se marcan used solos) → para esos se
  mira "Enviados". La sección Inactivos ahora también tiene la card "💎 Regalo para clientes de ticket alto"
  para activar/configurar; el input de % de la escalera y la vigencia se capean en la UI (30% / 2h).
- **Validado:** `node --check` OK (server.js, inactividadService.js, BonusStrategyConfig.js, admin.js).
  Back necesita redeploy.

### 59. Analítica de historias de influencer: conversión, retención y ranking por score combinado
- **Pedido:** análisis más detallado de historias por influencer — conversión por historia, retención por
  historia, y un **ranking de influencers** (mejor→peor) según retención de clientes fieles, ticket promedio,
  ROAS promedio y costo por click. Clave: una historia de un influencer puede ser rentable y otra del MISMO
  influencer no, así que se necesita ver historia por historia + el influencer agregado + el ranking.
- **Backend (`publisherAnalyticsService.js`):**
  - `getInfluencerStoryAnalysis` enriquecido: por historia (y en totales) ahora calcula **conversión**
    (registros→clientes), **clientes fieles** (≥5 cargas, count + %), **clientes activos** (cargaron ≤7d,
    count + %), **ticket promedio**, **clicks** y **CPC** (costo/clicks). Trackea la última carga por usuario.
  - Clicks: `CampaignClick` es por campaña (no por influencer) y TTL 90d → se atribuyen por ventana horaria
    igual que los usuarios; en historias de +90d puede no haber dato. Aclarado en la UI.
  - Nuevo `getInfluencerStoriesRanking(campaignCode)` + helper `_influencerScore(totals)`: score 0-100
    **combinado balanceado** (decisión owner): ROAS 35% + retención de fieles 30% + ticket 20% + CPC 15%.
    Normaliza cada métrica con topes fijos (`INF_ROAS_CAP=2`, `INF_TICKET_CAP=50000`, `INF_CPC_CAP=2000`);
    CPC sin clicks → neutro 0.5 (no castiga historias viejas). Ordena por score desc (desempate por neto).
- **Endpoint:** `GET /api/admin/influencer-stories/ranking?campaign=CODE` (adminMiddleware).
- **Panel (`adminprivado2026`):**
  - Tabla de historias (modal 📖 Historias) ampliada con columnas Conv. / Fieles / Activos / Ticket / CPC,
    en filas, "antes de la 1ª historia" y total.
  - Pestaña "🎬 Por influencer" → botón **"🏆 Ranking por historias"** que abre `influencerRankingModal`:
    tabla **ordenable** por cualquier columna (score, ROAS, fieles, activos, ticket, CPC, conversión, clientes,
    neto, #historias), con medallas 🥇🥈🥉 y el desglose del score. Funciones `openInfluencerRanking`/
    `rankSortBy`/`renderInfluencerRankingTable`/`closeInfluencerRankingModal`.
- **Validado:** `node --check` OK (server.js, publisherAnalyticsService.js, admin.js). Back necesita redeploy.

## Sesión 2026-06-21

### 58. Reembolsos vueltos a 20/10/5 (editables) + tope global 30% en TODO bono + limpieza de bonos viejos
- **Reembolsos:** el owner pidió **volver a 20% diario / 10% semanal / 5% mensual** (revierte el 8/3/3 de la #56),
  PERO manteniendo la edición desde el panel. Solo se cambió `REFUND_PCT_DEFAULTS` a `{20,10,5}` en server.js
  (+ fallback en refunds.js y placeholders del HTML). El mecanismo de Config `refundPercents` + card del panel
  (solo admin general) queda igual: si el owner nunca toca el panel, rige 20/10/5.
- **Tope global de bono 30%/2h:** `notificationRulesService.activateChargeBonuses` (el 3er punto que crea
  PromoBonus, usado por reglas de notificación con chargeBonus) ahora clampea `percent ≤30` y `durationMinutes ≤120`.
  Con esto, los TRES puntos que crean bonos quedan capeados: inactividad (≤30/2h), encuesta (bono apagado),
  activateChargeBonuses (≤30/2h). No queda ningún motor que pueda dar >30%.
- **Limpieza de bonos viejos (one-shot):** migración en `initializeData` (flag `migration_clear_old_promobonus_done`)
  que VENCE todos los `PromoBonus` activos al arrancar. Como todos los PromoBonus son automáticos (los bonos
  manuales del agente van directo a JUGAYGANA), esto deja la pizarra limpia: se sacan los 50%/100% viejos de
  encuesta/estrategia y el motor capeado de inactividad los repuebla. Corre UNA sola vez; los bonos nuevos no se tocan.
- **Reactivación de gente:** el motor de Inactividad ES la herramienta de reactivación (push + bono al que no
  carga hace ≥7d), ya capeado a 30%/2h. No se agregó otro motor: el tope 30% aplica a cualquier bono automático.
- **Validado:** `node --check` OK (server.js, notificationRulesService.js, refunds.js). Back necesita redeploy.

### 57. Estrategia de bonos reordenada: bono SOLO a inactivos (no carga ≥7d), ≤30% y ≤2h
- **Pedido del owner:** hoy se da mucho bono automático a gente ACTIVA y los bonos duran "miles de minutos"
  (caso visto: 50% · vence en 3774 min · "regla inactividad"). Querían: gente ACTIVA (cargó hace <7d) NO recibe
  bono automático, solo notificaciones de enganche según su plan; gente INACTIVA (no carga hace ≥7d) sí, pero
  bono **≤30%** y reclamable **≤2h** (después desaparece el botón solo).
- **Decisiones (vía preguntas):** escalera **7d → 30%** y **14d → 30%** (sin regalo); **apagar** los bonos de
  los motores que apuntan a gente activa (encuesta + estrategia por voto).
- **Motor de inactividad (`src/services/inactividadService.js`) — reescrito:**
  - Segmenta por **última CARGA real** (Transaction type:'deposit', excluye regalos/devoluciones), NO por último
    ingreso (`lastLogin`) como antes. Inactivo = su última carga fue hace ≥ `minDias`. Una sola agregación.
  - **Topes duros en código:** bono `MAX_BONUS_PERCENT=30`, vigencia `MAX_VIGENCIA_HORAS=2` (clampea aunque la
    config diga más). `fireKey` ahora usa el día de la última carga (si vuelve a cargar y se ausenta, reinicia).
  - Recibe el modelo `Transaction` (server.js `_runInactividadTick` lo pasa). Mensajes cambiados a "hace X días
    que no cargás… dura 2 horas".
- **Defaults/caps de config (`server.js`):** `INACTIVIDAD_DEFAULTS` ahora 7d/14d a 30% y `bonoVigenciaHoras:2`.
  `mergeInactividadConfig` clampea `percent ≤30` y `bonoVigenciaHoras ≤2` (constantes `REFUND_INACT_MAX_PCT=30`,
  `REFUND_INACT_MAX_VIG_HORAS=2`). La card de stats de Inactivos ahora cuenta por **última carga** (coherente).
- **Apagados (bonos a gente activa):**
  - **Encuesta (`encuestaService.cohortWeek`):** se quitaron los slots de BONO (`bDays = []`). La encuesta ahora
    manda SOLO incentivos de enganche ("jugá, divertite, estamos cargando"). Reversible: volver a `bonusDays(bonoN)`.
  - **Estrategia de bonos por voto (`_runBonusStrategy`):** neutralizada con `BONUS_STRATEGY_DISABLED=true`
    (early-return). El panel/endpoints quedan; no dispara bonos.
- **Las "notificaciones normales por plan"** (reglas PLAN-ACTIVO/NORMAL/SUAVE en notificationRulesService) ya eran
  `bonus:none` (puro enganche) → se mantienen como están. No hay otro motor automático de bono.
- **OJO (config existente):** los topes (30%/2h) se aplican solos al leer la config aunque en producción haya
  quedado la vieja (50%/72h). Pero los **pasos** guardados (ej. si había un 3er paso de regalo $5.000 a 30d) se
  conservan hasta que el owner entre a la sección **Inactivos** y guarde, o se fuerce. Los bonos YA creados
  (ej. el de 50%/63h) siguen vigentes hasta vencer/usarse — los NUEVOS ya salen capeados.
- **Validado:** `node --check` OK (server.js, inactividadService.js, encuestaService.js). Back necesita redeploy.

### 56. Reembolsos: bajados a 8/3/3 + porcentajes EDITABLES desde el panel (solo admin general)
- **Pedido:** bajar los reembolsos (eran 20% diario / 10% semanal / 5% mensual) a **8% diario, 3% semanal,
  3% mensual**, y poder cambiarlos fácil desde el panel sin tocar código (solo el admin general).
- **Backend (`server.js`):** los % dejan de estar hardcodeados. Nuevo `Config['refundPercents']` con helper
  `getRefundPercents()` (defaults `{daily:8, weekly:3, monthly:3}`, clamp 0-100). Lo usan `/api/refunds/status`
  y los 3 claims (`/api/refunds/claim/{daily|weekly|monthly}`) → el monto y el campo `percentage` salen del
  config. Nuevos endpoints **`GET/POST /api/admin/refund-percents`** (authMiddleware+adminMiddleware **+ check
  explícito `role==='admin'`** → SOLO admin general; depositor/withdrawer/comunidad reciben 403).
- **Cliente (`public/js/refunds.js` + `index.html`):** los % del modal salen ahora de `status.percentage`
  (no hardcodeados). Se sacaron los "20%/10%/5%" estáticos de los tooltips y los botones del modal unificado
  ahora tienen `<span id="unified*Pct">` que `updateRefundLabels()` actualiza con el valor real.
- **Panel (`adminprivado2026`):** nueva card "🎁 Porcentajes de reembolso" en COMANDOS (se oculta si no sos
  admin general, igual que la card de hgcash). Funciones `loadRefundPercents()`/`saveRefundPercents()`.
- **Nota:** al estar en Config, el valor sobrevive a redeploys. Si nunca se setea, usa los defaults 8/3/3.
- **Validado:** `node --check` OK (server.js, admin.js, refunds.js). Back necesita redeploy; front, recargar.

### 55. FIX Comunidad: re-aviso cuando un cliente derivado vuelve a escribir
- **Síntoma:** al derivar a alguien a Comunidad llega el aviso + badge, pero si el agente lo atiende una vez y
  pasa a "Abiertos", cuando ese cliente responde NO vuelve a avisar → el chat se pierde y se generan demoras
  en Comunidad porque el agente está respondiendo en "Abiertos".
- **Fix backend (`server.js`):** nuevo helper `maybeNotifyComunidadActivity(userId, username)` — cuando un
  cliente cuyo `ChatStatus.status==='comunidad'` manda un mensaje (rama HTTP `/api/messages/send` y socket
  `send_message`), emite `notifyAdmins('comunidad_activity', {userId, username})`. Fire-and-forget, no frena
  la entrega del mensaje.
- **Fix panel (`admin.js`):** nuevo handler `socket.on('comunidad_activity')` → si el agente (admin/comunidad)
  NO está en la pestaña Comunidad, re-avisa (badge + sonido + toast). `bumpComunidadAlert(userId, kind)` ahora
  cuenta **chats distintos** (Set `_comunidadSeenUsers`, no infla con un cliente que escribe mucho) y tiene
  **throttle de 3s** en el aviso sonoro. La derivación pasa `(userId,'derive')`; la re-actividad `(userId,'activity')`.
  Al entrar a la pestaña Comunidad se limpia el set.
- **Validado:** `node --check` OK (server.js, admin.js). Back necesita redeploy; front, recargar el panel.

## Sesión 2026-06-20

### 54. FIX rol comunidad: se deslogueaba al dar F5 / recargar la página
- **Síntoma:** el Admin Comunidad perdía la sesión al refrescar (F5) o reiniciar la página y tenía que
  loguearse de nuevo. Con admin/depositor/withdrawer/publisher_admin NO pasaba (quedaban logueados).
- **Causa raíz:** la persistencia de sesión del panel va por la cookie httpOnly `admin_api_session`. Había
  DOS listas de roles que omitían `comunidad`:
  1. **Login** (server.js L3128 normal y L3870 por OTP): la cookie solo se seteaba para
     `['admin','depositor','withdrawer','publisher_admin']` → comunidad nunca recibía la cookie.
  2. **`GET /api/admin/me`** (L3299, el endpoint que rehidrata la sesión al cargar la página): rechazaba a
     `comunidad` (403) aunque tuviera cookie → logout igual.
- **Fix:** se agregó `'comunidad'` a las 3 listas (login, login-OTP, /api/admin/me). Ahora recibe la cookie
  al loguearse y `/api/admin/me` la acepta → la sesión sobrevive al F5 como el resto de los roles admin.
- **Validado:** `node --check` OK (server.js). Back necesita redeploy.

### 53. FIX pago automático hgcash: 403 "No tienes acceso a esta cuenta" al cambiar de cuenta/token
- **Síntoma:** tras cambiar de cuenta hgcash (token nuevo en `HGCASH_API_TOKEN`), el pago directo
  automático (cash-out) fallaba con `HTTP 403 {"error":"No tienes acceso a esta cuenta"}`.
- **Causa raíz:** el cash-out manda el `accountId` de NUESTRA cuenta a debitar, que vivía cacheado en
  `Config['hgcash'].accountId`. Ese valor era de la cuenta VIEJA y el token nuevo no tiene acceso a ella.
  Trampa que dejaba clavado: (1) `ensureHgcashAccountIdSaved` solo guardaba `if (!cfg.accountId)` → NUNCA
  sobreescribía el viejo, aunque entraran movimientos de la cuenta nueva; (2) el panel NO tiene campo para
  editar/limpiar el `accountId` (solo accountName/cbu/mode/window/enabled) → no se podía corregir desde la UI;
  (3) `resolveHgcashAccountId` priorizaba `cfg.accountId` (viejo) sobre los movimientos recientes.
- **Fix (fuente de verdad = el token):** se usa el endpoint `GET /accounts` de hgcash (lista las cuentas a
  las que el TOKEN actual tiene acceso) para resolver el `accountId`. Así, al cambiar de cuenta/token, se
  actualiza solo y nunca más salta el 403.
  - `src/services/hgcashService.js`: nueva función `getAccounts()` (GET /accounts, Bearer del token).
  - `server.js` `resolveHgcashAccountId({force})`: 1) pregunta a la API y elige la cuenta por moneda
    (`cfg.currency`, default ARS) + estado "Operativa", y la cachea en config; 2) fallback al `accountId`
    cacheado; 3) fallback al último `BankMovement`. `force:true` ignora el cache (para reintentar tras 403).
  - `server.js` `POST /api/admin/payouts/:id/pay`: auto-recuperación — si el cash-out devuelve **403**,
    fuerza re-resolver el accountId desde la API y reintenta UNA vez con la cuenta correcta. El `externalID`
    es el mismo (= payout.id) → idempotente, no paga dos veces aunque el primer intento hubiera entrado.
- **Nota:** no requiere acción manual del owner — con el token nuevo en SSM, el accountId correcto se
  resuelve solo en el próximo pago. (Opcional pendiente: exponer el accountId en el panel para visibilidad.)
- **Validado:** `node --check` OK (server.js, hgcashService.js). Back necesita redeploy.

## Sesión 2026-06-19

### 52. FIX CRÍTICO rol comunidad: faltaba en enum Message.senderRole (rompía responder/cerrar/etc.)
- **Síntoma:** el Admin Comunidad no podía responder mensajes ni operar; error "Validación: `comunidad` is not a
  valid enum value for path `senderRole`" y toasts "[object Object]".
- **Causa raíz:** `Message.senderRole` tenía enum `['user','admin','depositor','withdrawer','system']` SIN `comunidad`.
  Los mensajes se guardan con `senderRole: req.user.role` / `socket.role` (server.js L5340, L7157, L11337), así que
  cualquier acción del comunidad que cree un mensaje (responder por socket/HTTP, cerrar chat) fallaba la validación.
- **Fix:** agregado `'comunidad'` al enum `Message.senderRole`.
- **Auditoría completa (pedida por el owner):** se revisaron TODOS los enums de TODOS los modelos. Los únicos campos
  de ROL son `User.role` (ya con comunidad), `Message.senderRole` (corregido) y `Message.receiverRole`
  (`['user','admin']`: comunidad nunca es receptor → ok). `Transaction.adminRole` no tiene enum. Los 3 únicos
  guardados dinámicos de rol (L5340/L7157/L11337) quedan cubiertos. Verificado a mano cada acción del comunidad
  (responder socket/HTTP, depósito, bonus, cargar saldo/info, cargar mensajes, CBU, cerrar chat, derivar) → todas OK.
- **Validado:** `node --check` OK (server.js, Message.js).

### 51. FIX devolución de bonus suelto + retiro mínimo $4.999
- **Bug (devolución como fichas en vez de bonus):** si el cliente tenía un BONUS SUELTO (botón Bonus / fueguito,
  `type:'bonus'`) y lo quiso retirar, al rechazar volvía como fichas normales. Causa: la detección solo miraba la
  última CARGA (`type:'deposit'` con campo `bonus>0`); un bonus suelto es `type:'bonus'` y además se guarda **sin
  `userId`** (solo `username`).
  - **Fix:** la detección del "último crédito" ahora considera `type` ∈ `['deposit','bonus']` y busca por
    `userId` **O** `username`. Si el último crédito es `type:'bonus'` → todo ese monto es bonus; si es carga con
    bonus → el campo `bonus`. Capeado al monto del retiro. (server.js, endpoint `payouts/:id/cancel`.)
- **Retiro mínimo $4.999:** no se puede solicitar un retiro menor a $4.999.
  - Backend: `/api/withdrawal/request` y `/api/movements/withdraw` ahora exigen `>= 4999`.
  - Frontend (`withdraw.js` + `index.html`): validación del form a $4.999, `min` del input, y el cartel de saldo
    bajo ahora dice "El retiro mínimo es de $4.999". (La carga manual del agente NO tiene este límite.)
- **Nota:** el cliente del caso reportado ya recibió la devolución vieja (como fichas); el fix aplica de acá en más.
- **Validado:** `node --check` OK (server.js, withdraw.js).

### 50. FIX rol comunidad: "Error cargando mensajes" / no veía chats
- **Síntoma:** el Admin Comunidad veía la LISTA de chats pero al abrir uno daba "Error cargando mensajes" (cruz roja)
  y el tiempo real no funcionaba.
- **Causa:** varios chequeos de rol en server.js usaban el array literal `['admin','depositor','withdrawer']` SIN
  `comunidad` → 403 en cargar mensajes y al traer info del usuario, y el socket no lo trataba como agente.
- **Fix:** se reemplazaron TODAS las ocurrencias de `['admin','depositor','withdrawer']` por
  `['admin','depositor','withdrawer','comunidad']` en server.js. Cubre: `GET /api/messages/:userId` (L5171),
  `POST /api/messages/send` (L5326), `GET /api/users/:userId` (info del chat), cookie de panel, protección de
  borrado de admins, conteo de admins, y los 4 handlers de Socket.IO (authenticate/join_admin_room/join_chat_room/
  send_message). Ninguno da acceso a Pagos (eso sigue gateado por withdrawerMiddleware / checks de 'payments').
- **Validado:** `node --check` OK (server.js).

### 49. Oferta "100% recuperación" post-carga + etiqueta "NO Comunidad" + fix SLA auto-carga + fix UI pestañas
- **Mensaje de recuperación tras carga:** después de una carga (manual `/api/admin/deposit` o automática
  `hgcashAutoCarga`) se envía un mensaje ofreciendo el 100% de recuperación para que entre a la Comunidad.
  Editable desde COMANDOS: **`/sys_recover_100`** (si se vacía, no se envía). Helper `maybeSendRecoveryMessage(user)`.
  - **Anti-spam:** NO se envía si el cliente tiene la etiqueta `comunidad` (ya está) o `no comunidad` (ya dijo que no).
    En ese caso solo recibe el mensaje normal de depósito.
- **Etiqueta predefinida "NO Comunidad":** botón rápido **"+ NO Comunidad"** al lado de "+ Comunidad" en el chat,
  para marcar a quien no quiere entrar y dejar de ofrecerle. Chip gris en la lista (vs verde de 'comunidad').
- **Fix SLA (Demoras):** cuando un comprobante se auto-cargaba, el chat quedaba como "sin respuesta" con demoras
  largas (la carga es automática, no la tomaba como respuesta). Ahora `hgcashAutoCarga` llama a `delayClockResolve`
  (responded:true, via:'auto_carga') al acreditar → frena el reloj. La carga manual ya lo hacía (L6205).
- **Fix UI pestañas de Chats:** con 4 pestañas (Abiertos/Comunidad/Cerrados/Pagos) la última quedaba tapada y no se
  podía scrollear. CSS `.tabs` ahora tiene `overflow-x:auto` y `.tab-btn` `flex:0 0 auto` + `white-space:nowrap`
  (cada pestaña a su ancho, la fila scrollea horizontalmente).
- **Validado:** `node --check` OK (server.js, admin.js).

### 48. Botón "Descartar" para limpiar pagos pendientes viejos (sin avisar ni devolver)
- **Caso:** quedaron `PendingPayout` viejos en `pending_review` (de cuando el pago automático no andaba y se
  dio la orden de NO marcarlos). Ya se pagaron en su momento y el cliente siguió jugando. No sirve "Pagar con
  otro banco" (avisaría al cliente) ni "Rechazar" (devolvería fichas que no corresponden).
- **Solución:** botón **🗑️ Descartar** en el banner del retiro, **solo visible para el admin general**. Endpoint
  `POST /api/admin/payouts/:id/dismiss` (withdrawerMiddleware + check `role==='admin'`): marca el payout
  `cancelled` con `paidVia:'dismissed'`, `chipsReturned:false` y nota de auditoría. **NO** devuelve fichas, **NO**
  llama a hgcash, **NO** envía ningún mensaje al cliente. Reclamo atómico desde `pending_review`/`failed`.
- **Uso:** abrir el chat de cada cliente afectado → el banner del retiro muestra "🗑️ Descartar" (solo admin) →
  confirma → el cartel desaparece sin avisar nada. Es para limpieza puntual de pagos viejos ya resueltos.
- **Validado:** `node --check` OK (server.js, admin.js).

### 47. Sección de chat "Comunidad" + rol "comunidad" + etiquetas en la lista de chats
- **Rol nuevo `comunidad`:** clon de `depositor` (mismas funciones: cargas, bonus, fire-bonus) + ve la sección
  Comunidad − NO ve Pagos. Agregado a: enum `User.role`, `ADMIN_ROLES`, `adminMiddleware`, `depositorMiddleware`
  (NO `withdrawerMiddleware`), `validRoles` (x3: crear/editar usuarios), `isAgent` (User.js), y al `<select>` de crear
  admin (index.html). Labels y detección de "rol admin" en el panel (`getMessageType`, `isAdminUser`, `getRoleLabel`).
- **Sección "Comunidad":** nuevo valor `status:'comunidad'` en `ChatStatus`. Pestaña al lado de Abiertos, visible solo
  para `admin` y `comunidad` (`setupRoleBasedUI`). Endpoint `POST /api/admin/send-to-community` (clon de send-to-payments):
  setea `status:'comunidad'`, manda mensaje editable `/sys_community` al cliente, emite `chat_moved → to:'comunidad'`.
  Botón "Derivar a Comunidad" (verde) en Abiertos para admin/depositor/comunidad; en la pestaña Comunidad el botón
  pasa a "Enviar a Abiertos" (sendToOpen).
- **Visibilidad backend** (`GET /api/admin/conversations`): depositor bloqueado de `payments` Y `comunidad`;
  comunidad bloqueado de `payments`; withdrawer solo `payments`. El pipeline ya soporta cualquier status.
- **Alerta visible:** al derivar a Comunidad, el agente comunidad (y admin) recibe sonido + toast + notificación del
  navegador + **badge rojo con contador en la pestaña Comunidad** (se limpia al entrar a la pestaña). Helpers
  `bumpComunidadAlert`/`renderComunidadBadge`/`clearComunidadAlert`. La alerta NO molesta a depositor/withdrawer.
- **Bloqueo de re-derivación:** si el cliente YA tiene la etiqueta `comunidad`, `send-to-community` devuelve 400 (decisión:
  la etiqueta se pone SOLO a mano con "+Comunidad"; derivar NO la agrega).
- **Etiquetas en la lista de chats (#6):** `GET /api/admin/conversations` ahora proyecta `tags`; `renderConversations`
  pinta los chips de etiqueta en cada tarjeta (verde si es 'comunidad', dorado el resto) — sin entrar al chat.
- **Mensaje editable `/sys_community`:** sembrado en `systemCmds` (si se vacía, no se envía, vía renderSystemCommand).
- **Sin romper nada:** un chat en Comunidad NO se reabre solo cuando el cliente escribe (el reopen solo aplica a `closed`);
  `send-to-open` lo devuelve bien a Abiertos. SLA: los chats de comunidad se tratan como cola 'cargas' y NO aparecen en
  "esperando ahora" (no se agregó al `$in`), sin romper el tracking existente.
- **Validado:** `node --check` OK (server.js, ChatStatus.js, User.js, admin.js).
- **Pendiente tuyo:** crear una cuenta con rol "Admin Comunidad" desde el panel; redeploy del back (siembra `/sys_community`
  y activa el endpoint); recargar el panel.



### 44. Movimientos hgcash: mostrar CBU origen + destino + usuario del pago
- **Pedido:** en la tabla de "Movimientos del banco" (sección Comandos/Config), al hacer un pago
  saliente sólo se veía el CBU de origen. Se quería ver origen Y destino, y a qué usuario se le pagó.
- **Back (`GET /api/admin/hgcash/movements`):** los `BankMovement` salientes (`direction:'Outbound'`)
  se enriquecen con el `PendingPayout` correspondiente (match por `externalId == payout.id` o por
  `hgTransactionId`) → se adjunta `payoutUsername` y, si faltan, `toCBU`/`toName` desde el payout.
- **Front (`loadHgcashMovements` + tabla en index.html):** nuevas columnas **Destino** y **CBU destino**;
  la columna **Usuario** ahora usa `matchedUsername` (cargas entrantes) o `payoutUsername` (pagos salientes).
  Tabla pasó de 8 a 10 columnas (colspans y min-width actualizados).

### 43. Comandos vacíos = NO enviar ese mensaje automático
- **Pedido:** hoy los comandos `/sys_*` (mensajes automáticos) sólo se podían editar; ahora, si se
  deja el comando VACÍO desde el panel, ese mensaje no debe enviarse.
- **Antes:** `renderSystemCommand` con respuesta vacía → caía al **fallback hardcodeado** (lo opuesto a lo pedido).
- **Ahora:** `renderSystemCommand(name, fallback, vars)` devuelve **`null`** si el comando EXISTE (activo)
  pero su `response` está vacío → el caller no crea ni emite el mensaje. Si el comando NO existe (instalación
  nueva pre-seed) sigue usando el fallback. Helper gemelo `resolveSysContent(cmd, fallback)` para los flujos
  que hacían `Command.findOne` directo.
- **Cubre:** `/sys_deposit`, `/sys_deposit_bonus`, `/sys_reminder`, `/sys_install_app`, `/sys_withdrawal`,
  `/sys_bonus`, `/sys_cbu` (omite el descriptivo, igual manda el CBU para copiar), `/sys_welcome`,
  `/sys_withdrawal_request` (igual mueve el chat a Pagos), `/sys_install_bonus`, `/sys_payout_paid`, y la
  carga automática hgcash (`/sys_deposit`). El CRUD ya guardaba `response: ''` sin problema.
- **Nota:** desactivar el toggle (isActive:false) sigue cayendo al fallback; lo que apaga el envío es DEJARLO VACÍO.

### 42. Mensaje "pago enviado" automático en el pago por API (hgcash) — editable /sys_payout_paid
- **Pedido:** que el pago automático por hgcash mande el mensaje de "pago enviado" (hoy se mandaba a mano con `/5`).
- **Cómo:** nuevo comando del sistema **`/sys_payout_paid`** (sembrado en `systemCmds`, editable desde Comandos).
  `notifyPayoutPaid` ahora renderiza ese comando (var `${amount}`); si se vacía, no envía nada.
- **Se dispara en:** webhook hgcash `DONE` (`handlePayoutStatusWebhook`), el caso en que el cash-out vuelve
  `DONE` en el acto desde `POST /payouts/:id/pay` (antes NO avisaba), y "Pagar con otro banco" (#41).
- **Migrá tu texto de `/5` a `/sys_payout_paid`** una vez (copiá el contenido en Comandos).

### 41. Rechazar pago = devolver fichas + botón "Pagar con otro banco"
- **Pedido:** al RECHAZAR un pago desde el panel, devolver al cliente las fichas que se le habían
  descontado (el self-retiro ya descuenta en JUGAYGANA). Y, como a veces se paga desde otro banco,
  agregar esa opción aparte (sin devolver fichas).
- **`POST /payouts/:id/cancel` (Rechazar):** reclamo atómico `pending_review|failed → cancelled` (anti doble
  devolución), luego re-acredita el monto en JUGAYGANA (`jugaygana.depositToUser` con `jugayganaUserId`),
  registra `Transaction` (`metadata.source:'payout_refund'`), emite `balance_updated` y nota admin-only. Si la
  devolución falla, deja nota "devolvé el saldo a mano" (no re-intenta para no duplicar). Devuelve `chipsReturned`.
- **`POST /payouts/:id/pay-other-bank` (NUEVO):** marca `paid` con `paidVia:'other_bank'`, SIN tocar hgcash y
  SIN devolver fichas; manda el aviso `/sys_payout_paid`. Botón "🏦 Pagar con otro banco" en el banner del chat.
- **Modelo `PendingPayout`:** nuevos campos `paidVia` ('hgcash'|'other_bank'), `chipsReturned` (bool), `refundTxId`.
- **Panel:** banner de pago ahora tiene 3 acciones: **💸 Pagar** (auto hgcash) · **🏦 Pagar con otro banco** ·
  **↩️ Rechazar (devolver fichas)**. Confirmaciones y toasts actualizados.

### 40. Etiqueta rápida "Comunidad" (1 clic) en el chat del panel
- Botón **"+ Comunidad"** al lado de "Agregar" en la barra de etiquetas del chat → `quickAddChatTag('Comunidad')`
  (carga el input y reusa `addChatTag`). Se normaliza a minúsculas en el back (queda `comunidad`), como el resto.

### 45. Devolución de fichas (#41) NO cuenta como ingreso/carga en reportes
- La devolución por retiro rechazado registra `Transaction type:'deposit'` con `metadata.source:'payout_refund'`
  (para auditoría). Para que esa plata —que nunca entró— no infle los reportes, se excluye `payout_refund` de:
  `publisherAnalyticsService` (agregado a `GIFT_SOURCES`), **Central → Ingresos** (`/api/admin/central/ingresos`)
  y **Estadísticas** (`/api/admin/datos`). El resto de queries de depósitos (reembolsos/fueguito) no se tocó.

### 46. Devolución de fichas dividida: bonus de la última carga vuelve como BONUS
- **Pedido:** al devolver las fichas (rechazo de pago), si la ÚLTIMA carga del cliente incluyó bonus,
  devolver esa porción como BONUS y el resto como fichas comunes.
- **Regla (acordada):** `bonusPart = min(bonus_de_la_última_carga, monto_retiro)` (capeado), `chipsPart = resto`.
  La parte fichas va por `jugaygana.depositToUser`; la parte bonus por `jugaygana.creditUserBalance`
  (mismo camino que un bonus normal → mantiene tratamiento de bonus en JUGAYGANA).
- **Seguridad del monto:** el TOTAL siempre = monto del retiro (no devuelve de más ni de menos).
  Dato del bonus: `Transaction.bonus` de la última `Transaction type:'deposit'` (refleja lo realmente acreditado).
- **Falla parcial (2 llamadas a JUGAYGANA):** cada parte con sus reintentos; si una falla, NO se reintenta a
  ciegas (no duplica) y queda **nota interna admin-only** detallando qué falta devolver a mano. `chipsReturned`
  sólo queda `true` si entraron AMBAS partes.
- **Reportes:** ambas partes se registran como `Transaction type:'deposit'` con `metadata.source:'payout_refund'`
  (+ `refundKind:'bonus'|'chips'`), así siguen excluidas de Ingresos/Estadísticas/analítica (#45).
- **Nota interna al agente:** en éxito detalla el split ("$X como BONUS + $Y en fichas"); en parcial, qué faltó.

- **Validado:** `node --check` OK (server.js, admin.js, PendingPayout.js, publisherAnalyticsService.js).
- **Para activar el pago automático real seguís necesitando `HGCASH_API_TOKEN` en SSM (sin cambios).**
- **Acordate de migrar el texto de tu comando `/5` a `/sys_payout_paid` desde Comandos.**

## Sesión 2026-06-17

### 38. Pago AUTOMÁTICO de retiros (cash-out hgcash), confirmado por el agente
- **Pedido:** que el retiro se pague automático al CBU del cliente, pero SIEMPRE verificado y
  confirmado antes por un agente. El agente confirma → se paga solo.
- **Flujo:** el self-retiro (ya descuenta JUGAYGANA) ahora crea un `PendingPayout` (status
  `pending_review`) con monto + titular + CBU/alias. En el chat del cliente aparece un banner
  "💸 RETIRO PENDIENTE: $X · titular · CBU/alias" con botones **Pagar** / **Rechazar**. Al confirmar:
  resuelve el CBU/CVU de 22 díg. (si vino alias, lo busca con `/alias-lookup`), llama a hgcash
  `POST /transactions` (cash-out) con `externalID = payout.id` (idempotencia) y `webhookUrl`. Estado:
  `paying` → webhook `DONE` → `paid` + aviso al cliente; `ERROR/CANCELLED` → `failed` + aviso admin.
- **Componentes:** `src/services/hgcashService.js` (createCashOut + lookupAlias, axios + Bearer
  `HGCASH_API_TOKEN`), `src/models/PendingPayout.js`, endpoints `GET /api/admin/payouts`,
  `POST /api/admin/payouts/:id/pay`, `/cancel` (withdrawerMiddleware), rama TRANSACTION_REQUEST en
  el webhook `/api/hgcash/webhook` (`handlePayoutStatusWebhook`), auto-captura del `accountId` desde
  los movimientos. Banner + funciones `payPayout`/`cancelPayout` en el panel.
- **Para activar:** cargar `HGCASH_API_TOKEN` (token `cash_...` del dashboard hgcash) en SSM. Sin él,
  el botón avisa "pago automático no configurado, pagá manual" (dormido, no rompe nada). El accountId
  se auto-captura del primer movimiento entrante (o se setea en config).
- **Seguridad:** el AGENTE es el filtro (verifica y confirma cada pago); reclamo atómico
  pending_review→paying (no doble pago); idempotencia por externalID. El saldo en JUGAYGANA ya se
  descontó en el self-retiro.
- **Validado:** `node --check` OK (server.js, hgcashService.js, PendingPayout.js, admin.js).

### 37. hgcash: match por N° de transacción == coelsa (funciona con CUALQUIER banco)
- **Problema:** comprobantes de otros bancos (ej. BNA) no auto-cargaban. Causa: muchos comprobantes
  muestran el DESTINATARIO pero NO el nombre del que ENVÍA → el match por "nombre de origen" fallaba.
  Además la cuenta destino real ("LA DELFI S.R.L." / alias URBANATRADE) no coincidía con la config vieja.
- **Hallazgo clave:** el comprobante trae "Número de transacción" y el movimiento del banco trae el
  MISMO valor en `coelsaCode` (ej. `3D5W612E6Z8WR04Q2GXYWR`). Es un match DEFINITIVO.
- **Fix:** nuevo `_comprobanteMatchesMovement(comprobante, movement, cfg)` con 2 criterios (además del
  monto): (1) **N° de transacción del comprobante == coelsaCode/externalID del movimiento** (definitivo,
  no necesita el nombre del remitente ni la config de cuenta → sirve para cualquier banco); (2) fallback
  por **nombre de origen + destino consistente** (el destino se valida contra el `toName`/`toCBU` REAL del
  movimiento, no contra la config → funciona con cualquier cuenta hgcash). Ambos matchers (desde
  comprobante y desde movimiento) usan este helper. Se quitó la dependencia de la config `accountName`.
- **Limitación:** si un comprobante NO muestra ni el N° de transacción ni el nombre del remitente, queda
  manual (no hay clave común confiable). Cubre la gran mayoría de transferencias por CBU/CVU (traen coelsa).
- **Validado:** `node --check` OK. Para probar: transferencia NUEVA + comprobante (la vieja $174.000 que
  quedó pendiente, cargala manual: reenviar el comprobante lo detecta como duplicado, correctamente).

### 36. Causa raíz de "auto-carga falla pero manual funciona": el lookup flaky
- **Diagnóstico:** el error "JUGAYGANA está respondiendo intermitente — el usuario existe pero no
  podemos confirmarlo" sale en `jugaygana.js:843-850`, en el **lookup** (ShowUsers) que `depositToUser`
  hace ANTES del DepositMoney. O sea: el depósito NUNCA se intentó → reintentar es seguro para ese caso.
  La carga manual usaba el mismo camino; funcionó por timing (JUGAYGANA es intermitente).
- **Fix de raíz:** `depositToUser(username, amount, description, jugayganaUserId=null)` ahora acepta el
  ID guardado y, si está, **saltea el lookup** y va derecho al DepositMoney (igual que ya hacía
  `creditUserBalance`). Auto-carga (hgcash) y carga manual (`/api/admin/deposit`) ahora pasan
  `user.jugayganaUserId` → muchísimas menos fallas por el lookup. Backward-compatible: si no hay ID,
  cae al lookup de siempre.
- **Sobre el re-envío del comprobante:** la dedup (hash de imagen) lo detecta como "ya usado" — eso es
  CORRECTO (anti-fraude). Por eso reenviar NO reintenta. La recuperación ante fallo es **carga manual**
  (que consume el movimiento, #35). Se ajustó el mensaje de fallo para indicar carga manual (sin sugerir
  reenviar el comprobante).
- **Validado:** `node --check` OK (server.js, jugaygana.js).

### 35. hgcash: carga manual consume el movimiento (anti doble-carga si JUGAYGANA falló)
- **Pedido:** si JUGAYGANA falla la auto-carga, el operador carga manual a ese usuario; al hacerlo,
  esa transferencia/foto debe quedar marcada como CARGADA, para que cuando JUGAYGANA se recupere NO
  se auto-cargue de nuevo (evitar doble carga).
- **Cómo:**
  - En `hgcashAutoCarga` ahora se registra en el movimiento `matchedUserId/Username/ComprobanteId`
    apenas matchea (antes solo en éxito/sombra) → el fallo recuerda a quién era.
  - Nuevo `hgcashConsumeOnManualDeposit(userId, username, amount)`: busca un movimiento matcheado a
    ese usuario, en `pending`/`error`, con el MISMO monto; lo marca atómicamente `manual_charged` +
    marca el comprobante `autoCharged`. Enganchado en `POST /api/admin/deposit` (carga manual del
    operador), fire-and-forget.
  - Estado nuevo `manual_charged` en BankMovement y Comprobante; badge en el panel ("Cargado manual ✓").
- **Resultado:** carga manual del mismo monto al mismo usuario → la transferencia hgcash queda
  consumida → la foto no vuelve a auto-cargar. (Requiere monto igual; si el operador carga otro monto,
  no consume — es a propósito, para no marcar mal.)
- **Validado:** `node --check` OK.

### 34. hgcash: fallo de auto-carga REINTENTABLE (no queda trabado en error)
- **Síntoma:** si JUGAYGANA falla al auto-cargar, el movimiento quedaba en `error` para siempre →
  reenviar el comprobante real no podía reintentar (el matcher solo mira `pending`).
- **Aclaración importante:** el matcheo NO usa la hora impresa en el comprobante (sólo monto + nombre
  de origen + cuándo llegó al sistema). El error fue 100% de JUGAYGANA, no del horario.
- **Fix:** helper `hgcashHandleChargeFailure` — ante un fallo de carga cuenta el intento
  (`BankMovement.chargeAttempts`) y, si no superó el tope (`HGCASH_MAX_CHARGE_ATTEMPTS=3`), devuelve el
  movimiento a `pending` (reintentable con el próximo comprobante) y el comprobante a `pending`. Pasado
  el tope → `error` (carga manual). Bandera `charged`: si la excepción ocurre DESPUÉS de acreditar
  (paso local posterior), NO se reintenta (evita doble carga).
- Movimientos viejos ya en `error` (pre-fix) no se auto-recuperan → cargar manual.
- **Validado:** `node --check` OK.

### 33. Dedup de comprobantes robusto: hash de imagen (re-envío detectado 100%)
- **Síntoma:** un comprobante reenviado al día siguiente NO se detectó como duplicado.
- **Causas:** (1) la huella de dedup dependía del N° de operación leído por la IA, y la lectura
  OCR puede VARIAR entre envíos (especialmente códigos largos tipo UUID) → huella distinta → no
  matchea; (2) posible base de datos distinta entre entornos (Render de prueba vs producción).
  **No hay TTL en `Comprobante`** — la verificación NO expira (es permanente).
- **Fix:** nuevo campo `Comprobante.imageHash` (SHA-256 de la imagen base64). El chequeo de
  duplicado ahora busca por **imageHash O dedupeKey** (`$or`), y se hace ANTES de la rama "sin N°
  de operación". Así, reenviar **la misma imagen** se detecta como duplicado al 100%, sin depender
  del OCR. (Sólo para imágenes `data:` base64 — capturas; para URLs https queda null.)
- Si no hay ni dedupeKey ni imageHash → status `no_key` + aviso "verificá a mano".
- **Nota auto-carga (confirmado):** el matcheo desde el comprobante usa `windowMinutes` (default 60):
  si la transferencia (movimiento del banco) tiene más de 60 min, NO matchea → no se auto-carga →
  queda para verificación manual del agente. Configurable.
- **Validado:** `node --check` OK.

## Sesión 2026-06-16

### 30. Fixes hgcash tras prueba real (matcheo por nombre + falso-duplicado + diagnóstico 403)
- **Contexto:** al probar, el comprobante se detectaba pero no cargaba. Los logs de webhook de
  hgcash + el payload real revelaron 3 cosas:
  1. **Webhook 403:** el webhook apuntaba a `vipcargas.com` (producción EB detrás de **Cloudflare**),
     que bloquea el POST del banco antes de llegar a Node. Además el código nuevo estaba en **Render**
     (otra URL). **Redis NO interviene.** → Para probar en Render: apuntar el webhook a la URL de Render
     + setear `HGCASH_WEBHOOK_SECRET`/`ANTHROPIC_API_KEY` en Environment de Render. En EB/producción:
     volver a vipcargas.com + cargar secrets en SSM + **regla WAF "Skip" en Cloudflare para
     `/api/hgcash/webhook`** (si no, 403).
  2. **El payload real de hgcash NO trae CBUs** (solo `fromName`/`toName`/`amount`/`status:"done"`/
     `externalID`/`id`/`direction`). El match por CBU jamás podía funcionar.
  3. **Falso "duplicado":** sin N° de operación, la IA usaba el CBU como N° → el CBU se repite → falsos
     duplicados.
- **Fixes (código):**
  - Dedup: el prompt de la IA aclara que `numero_operacion` NO es el CBU; la huella **ignora** un N° que
    sea un CBU (== CBU origen/destino o ≥18 díg.) y usa fallback `monto|nombre_origen|cbu|fecha`.
  - Matchers hgcash reescritos: match por **monto + NOMBRE de origen + ventana** con **guard de
    ambigüedad** (>1 candidato = no carga, manual) y sólo si el movimiento está **acreditado**
    (`status:"done"`, configurable). Destino confirmado por **nombre de cuenta** (o CBU si está).
    Helpers `_normName`/`_nameMatch`/`_statusAccredited`/`_comprobanteToOurBank`.
  - Config `hgcash`: nuevos `accountName` (toName de tu cuenta, para confirmar destino sin CBU) y
    `acceptStatuses` (default `['done']`). Panel: campo "Nombre de tu cuenta hgcash"; CBU pasa a opcional.
- **Validado:** `node --check` OK. Recomendado: probar en **modo sombra** hasta validar matches, después auto.

### 31. hgcash: match aunque el comprobante no muestre destino + logs de diagnóstico
- **Síntoma (prueba en Render):** webhook llega OK (HTTP 200), el movimiento se guarda pero queda
  "Pendiente" (sin match) → no carga. Causa probable: los comprobantes no traían datos de DESTINO
  (o fueron procesados por código viejo), y el match exigía confirmar el destino.
- **Fix:** nuevo helper `_destOkOrUnknown` — el match acepta cuando el destino confirma nuestra cuenta
  **o cuando el comprobante no muestra destino** (el webhook de hgcash ya prueba que la plata entró a
  NUESTRA cuenta; con monto + nombre de origen + ventana + guard de ambigüedad el riesgo es mínimo).
  Aplicado en ambos matchers. El comprobante-side ya no mal-etiqueta `toApiBank` cuando el destino es
  desconocido.
- **Logs nuevos** `[hgcash] movimiento SIN match...` / `comprobante SIN movimiento aún...` con resumen
  de candidatos (montos/nombres) para diagnosticar en los logs de Render.
- **Nota de entorno:** se prueba en Render (`vipcargasantino.onrender.com`), HTTPS válido y sin
  Cloudflare. La URL cruda de EB daba "fetch failed" (sin HTTPS en el 443). Producción seguirá en
  vipcargas.com + regla WAF "Skip" en Cloudflare.
- **Validado:** `node --check` OK.

### 32. hgcash: el COMPROBANTE es el disparador (no la transferencia sola)
- **Problema reportado:** tras una carga automática, una transferencia nueva cargaba **sin que el
  cliente mande comprobante** — el webhook agarraba un comprobante **viejo/sobrante** (mismo monto+
  nombre, dentro de los 60 min) y cargaba. Riesgo: cargar contra el comprobante de otro momento/usuario.
- **Fix:** el matcheo DESDE el comprobante (`hgcashMatchFromComprobante`) sigue con ventana completa
  (`windowMinutes`, default 60) y es el **disparador principal**. El matcheo DESDE la transferencia
  (`hgcashMatchFromMovement`) pasa a ser solo **red de seguridad** para el caso raro en que el
  comprobante llega segundos ANTES que el webhook: usa una ventana CORTA `raceWindowMinutes`
  (default 10, configurable, máx 120). Así una transferencia nueva NO carga contra comprobantes viejos.
- En la práctica el webhook llega antes que el comprobante (el cliente transfiere → saca captura →
  manda), así que el camino normal es el del comprobante. La carga ocurre cuando el cliente manda el
  comprobante y hay una transferencia pendiente que coincide.
- **Validado:** `node --check` OK.


### 29. Carga AUTOMÁTICA por banco con API (hgcash / Urbana) — NUEVO
- **Caso:** un banco (hgcash) tiene API; cuando un cliente transfiere a ese CBU y manda
  el comprobante, que la carga se haga sola. El otro banco (sin API) sigue manual.
- **API hgcash** (https://docs.hg.cash): webhook `account-movement` (push) firmado con
  HMAC-SHA256 en header `X-HG-Webhook-Signature: sha256=<hex>` sobre el body crudo, secreto
  configurable en el dashboard. Base URL `https://hg.cash/api/v1`, auth `Bearer cash_...`
  (sólo para consultas; el webhook no necesita token). Campos del movimiento: direction
  (Inbound/Outbound), amount, currency, fromCBU/fromCUIT/fromName, toCBU, coelsaCode, date, id.
- **Decisiones (owner):** matcheo por **monto + CBU origen + ventana 60 min**; arranca
  **apagado** y en **modo sombra** (detecta y avisa al admin SIN cargar) hasta habilitar auto.
- **Cómo funciona:**
  - Webhook `POST /api/hgcash/webhook` (sin authMiddleware): valida firma HMAC sobre el body
    crudo (se agregó `verify` en express.json → `req.rawBody`), guarda el movimiento en la
    colección nueva **`BankMovement`** (dedupe por `movementId`), responde 2xx rápido y matchea
    en segundo plano.
  - **Matcheo en cualquier orden:** desde el movimiento (`hgcashMatchFromMovement`) busca el
    comprobante; desde el comprobante (`hgcashMatchFromComprobante`, enganchado en
    `analyzeComprobanteFromMessage`) busca el movimiento. Match exacto = monto en centavos
    igual + `fromCBU`==`cbu_origen` (normalizado a dígitos, ≥18) + dentro de la ventana.
  - **Anti-doble-carga:** se reclama atómicamente el movimiento (pending→claiming) Y el
    comprobante antes de cargar.
  - **Carga (`hgcashAutoCarga`):** modo sombra → mensaje adminOnly "MATCH listo para cargar".
    Modo auto → `jugaygana.depositToUser` + Transaction (metadata.source 'auto_hgcash') +
    mensaje al cliente (/sys_deposit) + emit balance + aviso admin. Si falla, queda manual.
- **Config** en `Config['hgcash']` `{ enabled, cbu, accountId, mode, windowMinutes, currency }`.
  Endpoints admin (solo admin general): `GET/POST /api/admin/hgcash/config`,
  `GET /api/admin/hgcash/movements`. Panel: card "🏦 Banco automático (hgcash)" en la sección
  "Comandos y Configuración CBU" (CBU + modo sombra/auto + ventana + activar; muestra estado de
  firma/IA y la URL del webhook) + **tabla de movimientos del banco** (filtro por estado +
  paginación + badge de estado de match: pendiente/match-sombra/cargado/error) — solo admin general.
- **Para activarlo:** (1) en el dashboard de hgcash: setear webhook URL
  `https://vipcargas.com/api/hgcash/webhook` + generar secreto de firma; (2) cargar
  `HGCASH_WEBHOOK_SECRET` en SSM; (3) en el panel: cargar el CBU de hgcash + activar (arranca
  en sombra) → pasar a auto cuando confíe. Requiere también la IA de comprobantes activa
  (`ANTHROPIC_API_KEY`) porque el matcheo usa el comprobante. **Apagado por defecto: no carga
  nada hasta habilitarlo.**
- **Limitación:** sólo auto-carga si el comprobante muestra un CBU de origen legible (22 díg.).
  Si sólo muestra alias → queda manual (aviso al operador). Movimientos sin comprobante que
  matchee quedan `pending` para reconciliación manual.
- **Validado:** `node --check` OK (server.js, admin.js, modelos). Back necesita redeploy.

### 28. Lectura del CBU/titular de DESTINO en el comprobante (IA)
- La IA del comprobante ahora también extrae `cbu_destino`/`titular_destino` (campos
  `destCbu`/`destHolder` en Comprobante). Necesario para distinguir banco con API vs sin API
  en la carga automática (#28). Cambio aditivo, sin romper lo existente.

### 27. Registro de comprobantes con IA (anti-reutilización/estafa) — NUEVO
- **Caso:** clientes que reusan un comprobante ya usado por otro usuario (el user1
  pasa comprobante y carga; user2 —sin relación aparente— pide cargar con el MISMO
  comprobante). Se quería detectarlo automáticamente.
- **Cómo funciona:** cuando un cliente manda una IMAGEN por el chat, en segundo plano
  (fire-and-forget, cero impacto en la velocidad del chat) se manda a **Claude vision**
  que decide si es comprobante y extrae datos (N° operación, monto, CBU/alias origen,
  banco, fecha). Se guarda en la colección nueva **`Comprobante`** (permanente, sin TTL)
  y se busca duplicado por **huella** (`dedupeKey` = N° operación normalizado; si no hay,
  combo monto|cbu|fecha).
  - Duplicado de OTRO usuario → mensaje **adminOnly** en el chat: `🚨 COMPROBANTE YA
    UTILIZADO POR: @usuario …`. Duplicado del mismo cliente → aviso más suave.
  - No duplicado → aviso adminOnly `✅ Comprobante verificado — no es duplicado`.
  - No es comprobante (captura de error, foto cualquiera) → se registra liviano, SIN avisar.
  - Sin N° de operación legible → aviso "verificá a mano".
- **Modelo de IA:** `claude-haiku-4-5` (default, ~US$0,003 por comprobante). Configurable
  con env `COMPROBANTE_AI_MODEL`. Cliente vía **axios** (mismo patrón que JUGAYGANA, sin
  sumar dependencias nuevas).
- **Activación:** lee `ANTHROPIC_API_KEY` desde `process.env` (cargada por SSM en el
  bootstrap, igual que JWT_SECRET). **Si la key NO está, queda DORMIDO** (no analiza, no
  crea registros, no rompe nada). → Para activarlo: cargar `ANTHROPIC_API_KEY` en el
  SSM_PATH (AWS Parameter Store) y redeploy/restart.
- **Archivos:** `src/models/Comprobante.js` (nuevo), `src/services/comprobanteAiService.js`
  (nuevo), enganches en server.js (helper `analyzeComprobanteFromMessage` + 2 hooks: socket
  `send_message` y HTTP `/api/messages/send`, sólo `senderRole==='user'` && `type==='image'`).
- **Alcance:** sólo cubre imágenes que pasan por el chat de la app. Si el comprobante llega
  por otro canal (WhatsApp directo) no se ve. Pendiente ofrecido: verificación del lado del
  operador en el panel (subir imagen antes de cargar) — NO hecho aún (el owner eligió "solo chat").
- **Validado:** `node --check` OK. Back necesita redeploy + cargar la API key en SSM.

### 26. Etiquetas + notas internas en usuarios (panel admin)
- **Pedido:** poder etiquetar/anotar clientes (ej: `comprobante-duplicado`, `sospechoso`,
  `confiable`, `VIP`), filtrar usuarios por etiqueta y mandar difusiones push por etiqueta.
- **Modelo (`User`):** `tags: [String]` (indexado), `adminNotes` (texto), `tagHistory`
  (auditoría liviana: quién agregó/quitó qué y cuándo). Las etiquetas se normalizan en el
  backend (minúsculas, trim, espacios colapsados, máx 40 chars) para que guardado y filtro coincidan.
- **Backend (server.js):** filtro `?tag=` en `GET /api/admin/users`; `GET /api/admin/tags`
  (lista de etiquetas en uso); `POST /api/admin/users/:userId/tags` (action add|remove,
  atómico con `$addToSet`/`$pull`); `POST /api/admin/users/:userId/notes`. Helper `normalizeTag`.
  `GET /api/users/:userId` ya devuelve tags+adminNotes (full user). Todos con `adminMiddleware`.
- **Difusión por etiqueta (`notificationRoutes.js`):** `POST /api/notifications/send-to-tag`
  → resuelve usernames por etiqueta y reusa `sendNotificationToUsernames`. **Solo admin
  general** (chequeo `req.user.role==='admin'`, no cajeros).
- **Panel (`adminprivado2026`):** barra de etiquetas + nota en el chat del usuario (chips
  con quitar, input con autocompletado, textarea de nota); chips de etiqueta bajo el nombre
  en la tabla de Usuarios; filtro por etiqueta en la sección Usuarios; card "📣 Difusión por
  etiqueta" en Notificaciones. Reusa `authFetch`/`escapeHtml`.
- **Validado:** `node --check` OK (server.js, admin.js, notificationRoutes.js, User.js).
  Back necesita redeploy; front, recargar el panel.

### 25. Fix bug Fueguito: el "100% próxima carga" (día 15) nunca se limpiaba
- **Bug:** el flag `pendingNextLoadBonus` se ponía en `true` al llegar al día 15 pero NUNCA
  se volvía a poner en `false` en ningún lado → el cartel "🎁 Tenés un 100% en tu próxima
  carga" quedaba visible para siempre y era un **bono 100% infinito** explotable (el cliente
  podía pedirlo a un operador en cada carga). (Reportado como "aparece para reclamar el bono"
  estando en día 26; por la captura era el premio del día 15, no el de día 20.)
- **Fix (ambas cosas, como pidió el owner):**
  - **Auto-limpieza:** en `POST /api/admin/deposit`, si la carga incluyó un bonus que se
    acreditó OK, se limpia el flag de forma atómica (`FireStreak.updateOne({userId, pendingNextLoadBonus:true},{false})`).
  - **Botón manual:** `GET /api/users/:userId` ahora expone `fireNextLoadBonus` para el panel;
    nuevo `POST /api/admin/users/:userId/fire-next-load-bonus/apply` (depositorMiddleware) lo
    marca como aplicado. En el chat del panel aparece un cartel "🔥 FUEGUITO: 100% próxima carga"
    con botón "✓ Marcar aplicado".
  - **Front cliente:** `showFireModal` ahora SIEMPRE refresca el estado al abrir (antes usaba
    estado cacheado → podía mostrar un botón de reclamo viejo de un premio ya expirado/consumido).
- **Nota:** el premio en efectivo (días 10/20/30) ya auto-expira el mismo día (sin cambios).
- **Validado:** `node --check` OK (server.js, admin.js, fire.js). Back redeploy; front recargar.

## Sesión 2026-06-10

### 24. Segundos en mensajes del chat + separar Demoras por cola (cargas/pagos)
- **Segundos en el chat:** los timestamps de los mensajes (enviados/recibidos/
  sistema) ahora muestran HH:mm:ss. Se creó `formatChatTime` (con segundos) y se usa
  SOLO en los 3 puntos de render de mensajes (`addMessageToChat`,
  `createMessageElement` regular + sistema). `formatDateTime` (sin segundos) se
  mantiene en la tabla de Transacciones.
- **Demoras separadas por cola cargas/pagos:** pagos tolera demoras largas
  esperadas (~30 min para pagar), cargas no debería pasar de 2 min. Ahora:
  - `ChatDelay.category` ('cargas'|'pagos'). La cola se deriva al resolver el reloj:
    `status==='payments' || category==='pagos'` → pagos. Los cierres resuelven la
    demora ANTES de poner status:'closed' (sino se perdía la cola real).
  - **Umbrales separados y configurables:** `chatDelayThresholdSeconds` (cargas,
    default 2 min) y `chatDelayThresholdPagosSeconds` (pagos, default 30 min). Cada
    demora se registra solo si supera el umbral de SU cola.
  - **Endpoint:** GET acepta `?category=`; "esperando ahora" ahora incluye chats
    open Y payments y compara cada uno contra su umbral; devuelve ambos umbrales.
    POST config acepta ambos.
  - **Panel:** dos inputs de umbral (Cargas/Pagos), filtro de Cola (Todas/Cargas/
    Pagos), columna "Cola" con badge en ambas tablas. Hint muestra los dos umbrales.
  - Nota: registros viejos de ChatDelay (pre-cambio) no tienen `category`.
- **Validado:** `node --check` OK. Back necesita redeploy; front, recargar el panel.

### 24c. Tracking de demoras fire-and-forget (cero impacto en velocidad del chat)
- Las llamadas al tracking en los caminos de mensaje en TIEMPO REAL (socket
  `send_message` normal + comando, HTTP `/api/messages/send` + comando) pasaron de
  `await` a **fire-and-forget** (`.catch(()=>{})`): corren en segundo plano y NO
  frenan la entrega del mensaje. La latencia de enviar/recibir vuelve a ser idéntica
  a antes de la feature (el único `await` pre-emit que queda es el `lastMessageAt` de
  ChatStatus, que ya existía).
- Siguen `await` solo donde NO importa la latencia de chat: CBU/cerrar chat (botón)
  y carga/retiro/bonus (que ya esperan a JUGAYGANA segundos).
- Los helpers ya capturan sus errores internamente; el `.catch` es defensa extra.

### 24b. Ajuste de la cola: señales más fuertes + registros viejos no mienten
- **Problema reportado:** un chat que estaba en pagos aparecía como "Cargas". Causa:
  esos registros eran ANTERIORES al deploy del cambio (sin campo `category`), y el
  badge los mostraba como "Cargas" por default.
- **Fix UI:** registros sin `category` ahora muestran "—" (no "Cargas").
- **Mejora de precisión (back):** `delayClockResolve` acepta `queueHint`. Lógica final
  (confirmada con el flujo del owner): **gana "pagos" si hay CUALQUIER señal de pagos** →
  `queue = (queueHint==='pagos' || deriveChatQueue(cs)==='pagos') ? 'pagos' : 'cargas'`.
  Señales de pagos: chat en `status:'payments'` (pestaña Pagos), operación de retiro,
  o agente `withdrawer`. Señales de cargas (depositor / carga / bonus / CBU) caen a
  cargas por defecto. Helper `roleQueueHint(role)`.
- **Flujo real del owner:** cargas las contesta un admin `depositor` en chat abierto;
  el chat pasa a Pagos cuando el cliente toca "Retirar" (auto) o el depositor toca
  "Enviar a pagos" → `status:'payments'`; ahí se manda el comprobante y se cierra.
  Con la regla "pagos gana", todo lo que pasa en la sección Pagos queda etiquetado pagos.

### 23. Renombrar influencer (con migración de usuarios) + borrar campaña definitivamente
- **Pedido:** poder corregir el nombre de un influencer cargado mal, y poder
  borrar campañas/publicistas definitivamente (además de desactivar, que ya existía).
- **Renombrar influencer:**
  - La analítica por influencer se calcula EN VIVO desde `User.acquisitionInfluencer`,
    así que renombrar SIN migrar los usuarios partiría las stats. Por eso el rename
    arrastra los usuarios del nombre viejo al nuevo.
  - **Front (editor de campaña):** botón ✏️ por influencer → `prompt` de nuevo nombre;
    queda pendiente con indicador "✎ antes: X" y se aplica al **Guardar**. Al cargar
    la campaña se taguea `orig` (nombre original) para detectar renombrados.
  - **Back (`PUT /api/admin/campaigns/:code`):** acepta `renames: [{from,to}]` y hace
    `User.updateMany({acquisitionCampaign, acquisitionInfluencer: /^from$/i}, {to})`
    antes de reemplazar la lista. Devuelve `renamedUsers` (se muestra en el toast).
- **Borrar campaña definitivamente** (lo que faltaba; el "DELETE" viejo era soft =
  isActive:false, igual que "Desactivar"):
  - **Back:** nuevo `DELETE /api/admin/campaigns/:code/permanent` (solo admin general):
    `Campaign.deleteOne` + `InfluencerStory.deleteMany` de esa campaña + invalida la
    sesión del pool. Los usuarios captados se CONSERVAN (quedan sin ref al publicista).
    Devuelve `attributedUsers`/`storiesDeleted`.
  - **Front:** botón "🗑️ Borrar definitivamente" en cada card de campaña, con doble
    confirmación. "Desactivar" (soft) se mantiene como estaba.
- **Pendiente/ofrecido:** las "Cuentas Publicistas" (publisher_admin) ya tienen
  activar/desactivar; si se quiere borrado definitivo de esas cuentas, se agrega aparte.
- **Validado:** `node --check` OK. El back necesita redeploy; el front, recargar el panel.

### 22. Fix 429 con MUCHOS admins a la vez (cupo por admin + no recargar fuera de Chats)
- **Síntoma:** con varios agentes trabajando en simultáneo, aparecía de nuevo
  "Demasiadas solicitudes" (429); ej: un admin en la sección Demoras veía
  "Error cargando closed" mientras otro agente contestaba en Chats.
- **Causa 1 (de fondo):** `generalLimiter` (300 req/min) estaba keyeado por **IP**.
  Varios agentes detrás de la misma IP (oficina/NAT) **comparten el cupo** → se
  429-ean entre todos. El fix anterior (#19) bajó el volumen por-admin pero no
  resuelve el pool compartido por IP con N admins.
- **Causa 2 (desperdicio):** estando en otra sección (Demoras, etc.), el panel
  igual recargaba la lista de conversaciones en background por cada mensaje de
  otros agentes (vía `scheduleConversationsRefresh` disparado por sockets).
- **Fix server (`server.js`):** `generalLimiter` ahora usa `keyGenerator` por
  **cookie de sesión** (`admin_api_session`) → cada admin logueado tiene su PROPIO
  cupo de 300/min, sin importar la IP compartida. Los clientes de la PWA (auth por
  header Bearer, sin esa cookie) siguen limitados por IP. `validate:
  { keyGeneratorIpFallback:false }` para no chocar con la validación IPv6 de la lib.
- **Fix cliente (`admin.js`):** `scheduleConversationsRefresh` corta temprano si la
  sección Chats no está activa (no recarga conversaciones cuando no las estás
  viendo). Al volver a Chats, `switchSection('chats')` recarga la lista una vez.
- **Validado:** `node --check` OK. El fix del cupo por admin requiere redeploy del
  server; el del cliente, recargar el panel.

### 21. Hora de envío visible en los mensajes automáticos (naranja) del chat admin
- **Pedido:** los mensajes automáticos del sistema (naranjas) no mostraban la hora;
  el owner quiere verla para corroborar demoras / horario de envío.
- **Causa:** `createMessageElement` (panel) renderizaba `type==='system'` sin la
  línea `.message-time` (a diferencia de los mensajes normales). En tiempo real,
  `addMessageToChat` los pintaba como burbuja normal (inconsistente).
- **Fix (solo `adminprivado2026/`):** la rama de sistema de `createMessageElement`
  ahora incluye `formatDateTime(timestamp)` (mismo formato "Hoy HH:mm" que el resto);
  `addMessageToChat` delega en `createMessageElement` para `type==='system'` →
  historial y tiempo real quedan idénticos (naranja + hora). CSS menor en `admin.css`.

### 20. Control de demoras de respuesta en chats (SLA de atención)
- **Pedido:** poder controlar cuánto tarda la atención. Si un cliente manda un
  mensaje y se tarda > umbral (default 2 min) en responderle, que quede registrado
  en algún lado con los minutos de demora y el mensaje que esperó.
- **Decisión clave por el TTL:** `Message` se borra a los 3 días, así que el reporte
  NO puede apoyarse en el historial de mensajes. Se creó una colección PERMANENTE
  nueva `ChatDelay` (sin TTL, como Transaction) que guarda un SNAPSHOT del texto.
- **Decisiones de negocio (confirmadas con el owner):** umbral CONFIGURABLE desde el
  panel (default 2 min, en Config `chatDelayThresholdSeconds`) · registrar demoras
  respondidas Y mostrar las "sin responder" · los comandos (/cbu, etc.) cuentan como
  respuesta. Ampliación de exactitud: cargas/retiros/bonus/CBU también cuentan como
  respuesta (atender al cliente sin escribir igual frena el reloj).
- **Modelo del "reloj":** vive en `ChatStatus` (`pendingSince`/`pendingPreview`/
  `pendingType`), en MongoDB → multi-instancia sin estado en memoria.
  - Cliente escribe → si no hay reloj corriendo, se setea `pendingSince` (se mide
    desde el PRIMER mensaje sin responder, no el último).
  - Agente responde (mensaje/comando/carga/retiro/bonus/CBU) → `delayClockResolve`
    limpia el reloj de forma ATÓMICA (findOneAndUpdate con doc previo, sin doble
    conteo si responden dos agentes a la vez) y registra `ChatDelay` si superó el umbral.
  - Chat cerrado con espera en curso → se registra como `unanswered`.
  - Helpers `delayClockOnUserMessage`/`delayClockResolve`/`delayClockClear` van todos
    envueltos en try/catch: una falla acá NUNCA rompe la entrega del mensaje.
- **Enganches:** socket `send_message` (user/agent/comando), HTTP `/api/messages/send`
  (idem), `chats/:userId/close` y `close-chat`, y los endpoints `deposit`/`withdrawal`/
  `bonus`/`send-cbu`. Los mensajes automáticos del sistema (bienvenida, etc.) NO cuentan
  (se crean por otro camino).
- **Endpoints (solo admin general, role==='admin'):**
  - `GET /api/admin/chat-delays?from&to&agent&status&minDelay&page` → `{ thresholdSeconds,
    waiting[] (esperando ahora, en vivo desde ChatStatus, solo status:open), delays[]
    (historial paginado), summary, pagination }`.
  - `POST /api/admin/chat-delays/config` `{ thresholdSeconds }` (10s–24h).
- **Panel:** sección nueva "⏱️ Demoras" (sidebar, oculta salvo admin general). Tarjetas
  de resumen (esperando ahora / cantidad / promedio / peor / sin responder), tabla
  "Esperando ahora", historial con filtros (fecha/estado/agente/demora mín.) + paginación,
  input de umbral en minutos, badge en el nav. Click en una fila abre el chat del cliente.
  Reusa clases existentes (sin CSS nuevo).
- **Sin migración:** colección nueva + campos opcionales nuevos en ChatStatus. Los chats
  abiertos viejos no tienen `pendingSince` hasta el próximo mensaje del cliente (correcto).
- **Validado:** `node --check` OK en server.js, admin.js y los modelos. (No se puede
  correr el server en Tails; sólo syntax check.)

## Sesión 2026-06-08

### 19. Fix 429 "Demasiadas solicitudes" en chats del admin con muchos chats activos
- **Síntoma:** con muchos chats activos, el panel admin tiraba "Demasiadas
  solicitudes. Intenta más tarde." (429) al cargar la lista de chats y al
  enviar mensajes; partes del panel dejaban de funcionar.
- **Causa raíz (confirmada, no corazonada):** el admin está en la sala `admins`
  y el backend hace `notifyAdmins('new_message', …)` por CADA mensaje del
  sistema entero (todos los usuarios, incl. automáticos de Fueguito/reembolso/
  depósito/bono). En el cliente, cada evento de socket disparaba requests SIN
  throttle:
  - mensaje de chat fuera del tab actual → `updateConversationInList` →
    `loadConversations(true)` = **4 requests** (reload forzado que saltea cache
    + 3 prefetch).
  - mensaje del chat seleccionado → `markMessagesAsRead` → `loadStats()` = 2 req.
  Con más chats activos = más throughput de mensajes en TODO el sistema = el
  panel se autobombardeaba hasta agotar el límite global de **300 req/min por
  IP** (`server.js:84`, `app.use('/api/', generalLimiter)`) → 429 en todo.
- **Fix (100% cliente, `public/adminprivado2026/admin.js`):** se eliminó la
  amplificación sin tocar el límite del server (subirlo habría enmascarado el bug):
  - `scheduleConversationsRefresh()`: throttle con **leading edge** — si hace
    >=4s que no hubo recarga refresca al instante (cero lag en uso normal);
    solo bajo ráfaga se limita a 1 cada 4s con recarga trailing (sin starvation).
    Ruteados a él: `updateConversationInList`, handler `chat_updated` (path no
    listado) y `conversation_updated`. Los chats que YA están en la lista se
    actualizan instantáneo en memoria (sin pasar por acá).
  - `loadConversations(force, {prefetch})`: en refrescos de fondo se omite el
    prefetch de mensajes (los 3 fetch extra).
  - `loadStatsThrottled()`: `loadStats()` a **máx 1 cada 5s** en los paths
    disparados por mensajes (`markMessagesAsRead`, handler `messages_read`).
    La insignia de no leídos ya se actualiza optimista + por evento `stats` del
    socket, así que no se pierde exactitud visible.
- **Qué NO cambió:** los updates en vivo de chats que YA están en la lista
  siguen instantáneos (path en memoria, sin HTTP). Solo chats nuevos/no listados
  esperan el refresh coalescido (≤4s). Recargas de baja frecuencia
  (`chat_closed`, `chat_moved`, `reconnect`) quedaron inmediatas.
- **Validado:** `node --check` OK. Sin cambios de backend ni de modelo.

## Sesión 2026-06-06

### 18. Ver usuarios por influencer + reasignar influencer (corregir errores del agente)
- **Caso:** a veces el agente crea un usuario y le asigna el influencer equivocado;
  se dan cuenta después al hacer el conteo (no en el momento, por eso no borran el
  usuario). Querían poder ver los usuarios de cada influencer y reasignarlos.
- **Clave de diseño:** la analítica por influencer/historia se calcula EN VIVO desde
  `User.acquisitionInfluencer`. Con sólo cambiar ese campo, las cargas/retiros/
  conteos del usuario se mueven solos al influencer correcto (no hay contadores
  denormalizados que arreglar).
- **Backend:**
  - `publisherAnalyticsService.getInfluencerUsers(campaign, influencer, page)`:
    lista paginada (20/pág) de los usuarios de ese influencer con sus stats
    (cargas/retiros/neto) + la lista de influencers de la campaña (para el desplegable).
  - `GET /api/admin/influencer-users?campaign=&influencer=&page=`.
  - `POST /api/admin/users/:userId/change-influencer` body `{influencer}`: valida
    que el nuevo influencer exista en la campaña del usuario (vacío = quitar),
    setea `acquisitionInfluencer`. **Sólo admin general** (role==='admin').
- **Frontend (pestaña "Por influencer"):** botón **👥 Usuarios** por fila → modal con
  la lista (username, registrado, cargas, retiros, neto) + **✏️ Cambiar** por fila →
  modal con desplegable de influencers de la campaña (+ "Sin influencer"). Al guardar,
  recarga la lista y refresca el breakdown. Botones de la tabla pasados a índice
  (`openInfluencerStoriesIdx`/`openInfluencerUsersIdx`) para no romper con nombres
  que tengan comillas.

### 17. Formato de fecha unificado a DD/MM/YYYY en todo el panel admin
- Helpers canónicos nuevos en `admin.js`: `fmtFechaAR(d)` → **DD/MM/YYYY** y
  `fmtFechaHoraAR(d)` → **DD/MM/YYYY HH:mm** (ambos en hora ART, día/mes con 2
  dígitos, año con 4). Expuestos en `window`.
- `formatDate`/`formatTime`/`formatDateTime` y los helpers locales `fmtDate` y
  `_centDate` ahora enrutan a los canónicos. Se reemplazaron ~15 usos sueltos que
  mostraban año de 2 dígitos (DD/MM/YY) o sin padding (6/6/2026).
- Las etiquetas relativas "Hoy/Ayer" del chat y los separadores por día de semana
  se mantienen (no son formato de fecha numérica).
- Sólo afecta el panel `adminprivado2026`. La PWA del cliente (`public/js`) no se tocó.

### 16. Performance: paginación server-side en Transacciones y Usuarios
- **Problema:** el panel se trababa al entrar a Transacciones (traía TODO desde el
  inicio de los tiempos, sin límite, y renderizaba todas las filas) y a Usuarios
  (traía TODOS los usuarios y filtraba/renderizaba en el navegador).
- **Transacciones** (`GET /api/admin/transactions`):
  - Ahora pagina (`page`, `limit` default 50). El **resumen de tarjetas** se calcula
    por AGGREGATION sobre el rango (fecha+usuario, TODOS los tipos) → sigue mostrando
    el desglose completo aunque haya un filtro de tipo activo. La **tabla** se filtra
    por tipo+fecha+usuario en el BACKEND (antes el tipo se filtraba en el cliente).
  - Se agregó `referrals` al resumen (antes la tarjeta "Referidos" quedaba en $0).
  - Front: default **HOY** la primera vez que se entra (flag `window._txDefaultsSet`);
    el filtro de tipo recarga server-side; controles de paginación bajo la tabla.
- **Usuarios** (`GET /api/admin/users`):
  - Ahora pagina (`page`, `limit` default 20) + **búsqueda server-side** (`search`)
    sobre username/email/phone/id/accountNumber (mismo criterio que el filtro
    client-side viejo). `allUsersCache` ahora guarda sólo la página actual.
  - Front: el buscador (debounced 300ms) recarga desde el backend; controles de
    paginación bajo la tabla. Columna "ID Cuenta" ahora usa `accountNumber`.
- **Sin cambios de modelo** (los índices de Transaction/User ya cubrían timestamp/
  type/username/role). **No rompe nada**: todas las acciones que recargaban listas
  siguen llamando `loadUsers()`/`loadTransactions()` (vuelven a página 1).
- **Pendiente (otros puntos pesados detectados, NO tocados):** `GET /api/admin/all-chats`
  trae TODOS los mensajes+usuarios+chatStatus; `/api/admin/campaigns` sin límite.
  Optimizar si el owner lo pide.

## Sesión 2026-06-05

### 15. Seguimiento de HISTORIAS por influencer (costo / ROAS por publicación)
- **Caso:** el influencer cobra POR HISTORIA (arranca ~20hs). El owner quiere
  cargar el precio de cada historia y ver cuántos registros/cargas trajo, CPA,
  ROAS, y si conviene repetir; comparar historia 1 vs 2, etc. Solo admin general.
- **Modelo nuevo `InfluencerStory`** (`src/models/InfluencerStory.js`): `{ campaignCode,
  influencer, postedAt (fecha+hora), cost, label }`. Registrado en `src/models/index.js`
  y requerido en server.js. Colección nueva, sin migración.
- **Atribución por VENTANA HORARIA** (no se persiste el vínculo, se calcula a
  demanda): las historias se ordenan por `postedAt` asc y cada una se queda con
  los usuarios (acquisitionCampaign+acquisitionInfluencer) cuyo `createdAt` cae en
  [postedAt_i, postedAt_{i+1}). La última agarra todo hasta ahora. Los usuarios
  creados ANTES de la 1ra historia van a un bucket `before` aparte.
- **Métricas por historia** (`publisherAnalyticsService.getInfluencerStoryAnalysis`):
  registros, clientes (cargaron ≥1), cargas (BRUTO lifetime de la cohorte, sin
  regalos), retiros, neto, FTD; CPA = costo/registros (y costo/cliente), ROAS =
  neto/costo (y bruto/costo). Devuelve filas por historia numeradas + `before` + totales.
- **Umbrales de "rentable" en el FRONT** (ajustables en vivo, no recalcula): ROAS
  objetivo (default 1) Ó CPA objetivo (default $10.000). Verdict 🟢/🔴 por historia.
  - Nota: la cohorte usa cargas LIFETIME, así que el ROAS de una historia sube con
    el tiempo (una historia puede volverse rentable más adelante).
- **Endpoints** (admin): `GET /api/admin/influencer-stories?campaign=&influencer=`
  (lista + métricas), `POST` (crear), `PUT /:id`, `DELETE /:id`.
  `getInfluencerBreakdown` ahora devuelve `campaignCode` por fila (la UI lo necesita).
- **UI:** en la pestaña "Por influencer" del análisis, botón **📖 Historias** por
  fila → modal `influencerStoriesModal`: form de carga (fecha + hora default 20:00 +
  costo + nota), inputs de umbral ROAS/CPA en vivo, tabla de historias (#1, #2…)
  con CPA/ROAS/veredicto + editar/borrar, fila TOTAL y "Antes de la 1ª historia".
  La hora se manda como instante absoluto (ISO) construido en la TZ del navegador.

### 14. Sub-atribución por INFLUENCER dentro de un publicista
- **Caso:** un publicista trabaja con varios influencers y quiere medir cuál
  rinde, sin crear una cuenta/campaña por cada uno. Solución: el influencer es una
  **sub-etiqueta** del publicista (lista fija gestionada), sólo para analítica.
  NO tiene link propio ni creds JUGAYGANA (decisión acordada con el owner).
- **Modelo:**
  - `Campaign.influencers: [{ name, isActive }]` — lista fija por campaña,
    gestionada por el admin general. `name` único case-insensitive (se dedup al
    normalizar en el backend).
  - `User.acquisitionInfluencer` (string, indexado) — guarda el NOMBRE del
    influencer elegido al crear el usuario (lista gestionada → sin typos).
- **Flujo:** el publisher_admin, al crear un usuario, elige un influencer de un
  desplegable. Si la campaña tiene influencers activos → **obligatorio**; si no
  tiene ninguno → el selector se oculta y crea sin influencer (idéntico a antes).
- **Backend:**
  - Helper `normalizeInfluencers(raw)` (server.js) — valida/dedup el array;
    usado por POST y PUT `/api/admin/campaigns` (PUT reemplaza la lista entera).
  - `create-user` valida el influencer contra la lista activa (match
    case-insensitive, guarda el nombre canónico) y lo setea en `acquisitionInfluencer`.
  - `GET /api/admin/publisher-admin/influencers` — lista activa para el desplegable.
  - `GET /api/admin/publisher-admin/users` ahora devuelve `acquisitionInfluencer`
    + acepta `?influencer=` para filtrar.
  - `publisherAnalyticsService.getInfluencerBreakdown(publisher)` — agrupa los
    usuarios del publicista por `acquisitionInfluencer` (bucket "Sin influencer"
    para los no asignados) y calcula las mismas métricas que el análisis general.
    Endpoint `GET /api/admin/publishers/:publisher/influencers`.
- **Frontend (adminprivado2026):**
  - Modal de campaña ("Publicidad"): editor de influencers (input + Agregar →
    chips con toggle activo y borrar). Se manda el array completo al guardar.
  - Panel publisher_admin: desplegable de influencer en crear-usuario + badge
    🎬 en "Mis usuarios".
  - Modal "Dashboard Publicistas": nueva pestaña **🎬 Por influencer** (tabla con
    clientes/cargas/neto/ticket/retención por influencer; se trae a demanda).
- **Nota / pendiente:** si renombrás un influencer, los usuarios viejos quedan con
  el nombre anterior (no hay migración de rename). Agregar si el owner lo pide.

## Features grandes construidas (sesión 2026-05-27 / 28)

### 1. Rol `publisher_admin` + atribución por publicista
- Cuenta dedicada por publicista, atada a una Campaign (`User.publisherCampaignCode`).
  Panel limitado: sólo crea usuarios + ve sus stats. No carga/retira/chatea.
- Usuarios creados quedan atribuidos: `acquisitionCampaign`, `acquisitionSource:'manual'`,
  `createdByEmployeeId/Username`.
- Lockdown en authMiddleware via `PUBLISHER_ADMIN_ALLOWED_PATHS`.
- Panel: sección "Cuentas Publicistas" (CRUD) + "Dashboard Publicistas" (totales).

### 2. Credenciales JUGAYGANA por publicista
- Campaign puede tener `jugayganaUsername` + `jugayganaPassword` (sub-agente). Si están,
  los usuarios que crea su publisher_admin se crean bajo esa cuenta JUGAYGANA (separa la
  venta/comisión). Pool: `src/services/jugayganaPublisherSessions.js`.
- **DECISIÓN:** password en TEXTO PLANO (campo `select:false`), SIN encriptación. Se
  quitó la master key `JUGAYGANA_CREDS_KEY` porque complicaba al owner. Trade-off aceptado.
- Cargas/retiros siguen por la cuenta master (tiene permiso sobre todos los subs).

### 3. Welcome de bienvenida por link de publicista
- Modal pre-auth de 2 pasos (explicación + beneficios + checkbox obligatorio → "Iniciar
  sesión"). Sólo si el visitante llegó por vanity URL (`/CODE` o `/publisher-slug`) o
  `?p=CODE`. localStorage evita repetir. `public/js/publisherwelcome.js`.
- Vanity URL matchea por código O por slug del publisher name.
- **Link genérico `/BIENVENIDO`**: el owner creó una Campaign "BIENVENIDO" y comparte ese
  link a todos los publicistas. Funciona porque la atribución la fija el publisher_admin
  al crear la cuenta (el login NO cambia atribución).
- Login customizado para visitantes de publicista: botón "⚡ Entrá YA y enviá tu
  comprobante", oculta "Registrarse", error pide credenciales de WhatsApp si faltan.
- Referido (`?ref=`) tiene PRIORIDAD: si viene por referido, no se aplica welcome/lockdown
  del publicista (sino no podría registrarse).

### 4. Fixes JUGAYGANA / depósitos
- `lookupUserOrError`: cualquier no-2xx (incl. 4xx) = error, no "not_found" → evita
  CREATEUSER sobre usuarios existentes ("user already existing").
- deposit/withdraw: si CREATEUSER dice "already existing", re-busca en vez de fallar.
- Mensajes "IP bloqueada" → "JUGAYGANA temporalmente no disponible (HTML/Cloudflare)".
- **Bug bonus**: `creditUserBalance` no reintentaba → a veces el bonus no entraba (la carga
  sí). Fix: 3 reintentos + pausa 700ms entre carga y bonus + usar `jugayganaUserId` guardado
  (evita el lookup que fallaba por paginación/sub-agente). Mensaje al cliente refleja
  outcome real; si falla, alerta admin-only en chat + toast al agente.

### 5. mustChangePassword por "asd123": REMOVIDO
- Usuarios con la contraseña default de JUGAYGANA ya NO son forzados a cambiarla.
  Migración one-shot limpió el backlog. Se mantiene el force SÓLO en reset manual de admin.

### 6. Mensajes automáticos como mensajes de ADMIN + editables
- Bienvenida server-side (`POST /api/messages/welcome`) como mensaje de sistema (antes
  salía del lado del usuario). Throttle 24h server-side.
- ChatStatus se crea recién cuando el usuario INGRESA o manda mensaje (no al crear la
  cuenta) → no más chats vacíos. Migración one-shot purgó los vacíos.
- Helper `renderSystemCommand(name, fallback, vars)`. Comandos `/sys_*` editables sembrados:
  deposit, deposit_bonus, bonus, withdrawal, reminder, install_app, welcome, cbu,
  withdrawal_request, install_bonus.

### 7. Fix referidos preview/calcular
- Daba "JSON.parse: unexpected character" = timeout (N llamadas secuenciales a JUGAYGANA,
  1 por referido). Fix: pre-fetch en paralelo (concurrencia 5). Frontend muestra mensaje
  claro si hay timeout.

### 8. Analítica de clientes por publicista (`src/services/publisherAnalyticsService.js`)
- Segmenta por última carga (Transaction): Activo ≤7d · En riesgo 8-21d · Perdido +21d ·
  Nunca cargó · Nuevo ≤7d.
- **UMBRALES ACORDADOS:** ticket alto = promedio ≥ $30.000; fiel = ≥5 cargas.
- Score 0-100 = 40% retención + 30% conversión a carga + 30% fuerza de ticket.
- Endpoints: `GET /api/admin/publishers/ranking`, `/:publisher/analysis`,
  `POST /:publisher/recover` (push a un segmento, solo admin general).
- Panel "Dashboard Publicistas": ranking con score + modal de análisis con segmentos +
  botón "Recuperar" (push FCM a en-riesgo/perdidos).

### 9. Análisis DIARIO por publicista (FTD / ROAS / recargas mismo día)
- `getDailyBreakdown(publisher, from, to)` en publisherAnalyticsService. Por día ART:
  - **FTD** (primera carga histórica de cada cliente): count + monto → para ROAS diario.
  - Total de cargas: count + monto.
  - **Clientes nuevos que recargaron el MISMO día** (ej: cargó 15hs y volvió 20hs):
    count de clientes + count de recargas (2da en adelante) + monto de recargas.
- Endpoint `GET /api/admin/publishers/:publisher/daily?from=&to=` (default últimos 30 días).

### 13. Fix lookup demasiado estricto ("API respondió sin formato esperado")
- En commit 596bf0f endurecí lookupUserOrError: si la respuesta era 2xx + JSON
  pero SIN array `users`/`data` → devolvía error directo. Eso rompía el caso
  legítimo donde JUGAYGANA responde algo tipo `{success:true}` SIN el campo
  `users` cuando la búsqueda no encuentra match.
- Fix: si 2xx + JSON sin array → asumir lista VACÍA → not_found. El caller
  (deposit/withdraw) tiene su propio recovery (CREATEUSER + manejo de
  "already existing"). Mantengo el rechazo a 4xx/5xx y a HTML — esos sí eran
  el bug original que quería evitar. Agregado log con preview de la respuesta
  cuando se cae a este caso, para investigar si pasa seguido.
- También se acepta ahora `data.result[]` además de `users[]`/`data[]`.

### 12. Fix bug "cambié creds JUGAYGANA pero los usuarios siguen yendo al sub-agente viejo"
- Causa: el pool de sesiones JUGAYGANA por publicista (`jugayganaPublisherSessions.js`)
  cachea las sesiones en memoria por 20 min. En deploys multi-instancia (AWS EB
  con auto-scaling), la invalidación tras editar la campaña corría solo en la
  instancia que recibió el PUT — las otras instancias seguían reusando la sesión
  vieja (token del sub-agente anterior) hasta que expirara.
- Fix: en `_ensureSession`, antes de reutilizar la sesión cacheada, cargamos las
  creds actuales de la DB y comparamos `credsSignature` (sha1 sobre user|pass)
  contra la firma que se guardó al loguear. Si cambiaron → descartar la sesión
  y re-loguear con las nuevas. MongoDB es la fuente de verdad compartida entre
  todas las instancias. Costo: 1 query chica por createUser.

### 11. Publisher_admin: buscador + paginación + cambiar contraseña
- Reemplazada la sección "Últimos usuarios creados" por "📋 Mis usuarios" con:
  - Buscador (substring case-insensitive sobre username, Enter o botón Buscar).
  - Tabla paginada: **10 usuarios por página**, orden por createdAt desc (más
    recientes primero), controles Anterior / Página X de N / Siguiente.
  - Botón 🔑 Cambiar contraseña por fila (sólo de usuarios que ÉL creó).
- Endpoints nuevos:
  - `GET /api/admin/publisher-admin/users?page=&search=` (10 por página, sort
    desc, filtra por createdByEmployeeId=mi.id + acquisitionSource=manual).
  - `POST /api/admin/publisher-admin/users/:userId/change-password` con doble
    check de seguridad (target.createdByEmployeeId === mi.id Y role==='user'),
    bumpea tokenVersion (invalida sesiones del cliente), sincroniza la nueva
    contraseña a JUGAYGANA en background vía syncPasswordToJugaygana.
- Refresh automático de la lista tras crear un usuario.

### 10. "Cliente" = sólo los que cargaron + modal de análisis en 3 pestañas
- **DECISIÓN:** un "cliente" ahora es SÓLO quien cargó al menos 1 vez. Los que nunca
  cargaron NO cuentan como clientes (antes "CLIENTES 11" con 5 sin cargar; ahora "6").
  El métrico expone `clients` (depositores), `registered` (todos), `neverDeposited`.
  conversionRate = clients/registered (registrado→cliente).
- Modal de análisis reorganizado en 3 pestañas (más claro/elegante):
  - **✨ Usuarios nuevos**: FTD diario (count+monto para ROAS) + nuevos que recargaron mismo día.
  - **💰 Cargas totales**: total cargado/retirado/neto + tabla diaria de cargas + 💎 ticket alto + 👑 fieles.
  - **🔄 Retención**: activos/en riesgo/perdidos + botón Recuperar (push). Los "nunca cargaron"
    aparecen sólo como nota ("X registrados sin cargar"), no como clientes.
- Ranking: columna Clientes = depositores (muestra "+N sin cargar" en gris).

## Pendientes / ideas mencionadas (NO hechas)
- Mensaje de fueguito editable: hoy se arma del lado del cliente (fire.js →
  sendSystemMessage). Requiere mover la generación al backend.
- Push de recuperación AUTOMÁTICO (cron que detecte clientes que pasan a "en riesgo").
- Gráfico de evolución mes a mes por publicista.
- Bases de referidos MUY grandes: el preview podría seguir acercándose al timeout → subir
  idle timeout del ALB (config AWS) o calcular por referidor específico (ya soportado via
  `referrerUserId`).
- Mensajes operativos NO editables a propósito (alerta bonus fallido, error sync password,
  "comando no encontrado", "chat movido a pagos", "chat cerrado", "contraseña cambiada por
  admin"). Pasar a editables si el owner lo pide.

## Notas operativas
- Reiniciar el server tras deploy → corren las migraciones de startup y se siembran los
  comandos `/sys_*`.
- No hay `node_modules` en el entorno local del owner (Tails) → sólo se puede validar con
  `node --check` (syntax), no correr el server.
