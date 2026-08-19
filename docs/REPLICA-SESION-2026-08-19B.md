# RÉPLICA sesión 2026-08-19 (tanda B) — guía para implementar en la repo gemela

> **Cómo usar esto:** copiá TODO este documento como prompt inicial en una sesión
> del asistente parada en la OTRA repo (que ya aplicó completa la guía
> `REPLICA-SESION-2026-08-19-CONSOLIDADA.md`, o sea que está al día hasta la
> entrada #193 del WORKLOG del original). Cubre las entradas **#194-#200**:
> 3 features de código + contexto nuevo de la Partner API que conviene conocer.

---

## INSTRUCCIONES PARA EL ASISTENTE QUE IMPLEMENTA

1. **NO copies líneas a ciegas.** Verificá con grep cada nombre de
   función/archivo citado antes de tocar; las repos pueden haber divergido.
2. Un commit por feature, con `node --check` en cada archivo JS tocado (no hay
   node_modules local: solo syntax check).
3. **Convenciones del proyecto** (ver CLAUDE.md local): bump del SW en cada
   cambio de front (PWA: `public/firebase-messaging-sw.js`; panel:
   `public/admin-sw.js`) — con esta guía alcanza UN bump de cada uno;
   actualizar WORKLOG.md; commit+push a main.
4. Verificá cada feature con su "PROBAR". Todo esto es SOLO FRONT (deploy de
   estáticos, sin cambios de backend).

---

## FEATURE 1 — Botón CASINO: fix de la CAUSA RAÍZ del "carga y falla" + reintento automático del link SSO + timeout

**Síntoma reportado:** el jugador toca el botón del casino ("PÁGINA CASINO
AQUÍ" / equivalente), empieza a cargar, "algo falla y vuelve al chat", y a la
segunda quizás entra. **Tres causas, todas en `public/js/ui.js`:**

**1-A. LA CAUSA RAÍZ (verificada en vivo — implementar PRIMERO):** el reset y
el cierre del recuadro del casino "limpiaban" el iframe con **`frame.src =
''`** — y un src VACÍO no deja el iframe vacío: **lo navega a la URL BASE, o
sea a la propia PWA**. Como la PWA se sirve con `X-Frame-Options: DENY` +
`frame-ancestors 'none'`, el navegador bloquea ese contenido PERO el evento
`load` dispara igual; el guard del listener (`if (!frame.src) return`) no lo
filtraba (la PROPIEDAD `.src` con atributo `''` devuelve la URL resuelta,
truthy) → se escondía el "🎰 Entrando al casino…" y quedaba un recuadro
vacío/bloqueado ANTES de que llegara el link SSO. Es una CARRERA: la emisión
del link tarda 2-4 s y esa carga espuria <1 s; si el link pierde, pantalla
rota; a la 2ª el link llega antes (conexión caliente) y entra. **Fix:**

- En el RESET al abrir (`_showCasinoFrame`) y en el CIERRE
  (`closeCasinoFrame`): `frame.src = 'about:blank'` — NUNCA `''` (about:blank
  no navega a la app y no genera request). Dejar comentario advirtiéndolo.
- En el listener de `load` del iframe: el guard pasa a leer el ATRIBUTO:
  `const src = frame.getAttribute('src'); if (!src || src === 'about:blank')
  return;` — solo cuenta el load del casino real.

**1-B.** El pedido del link SSO (`POST /api/platform/session`) NO reintentaba:
ante una falla transitoria (saturación momentánea del carril de la plataforma,
parpadeo de red móvil) mostraba el error y el "reintento" era el jugador.

**1-C.** El fetch NO tenía timeout: colgado en 4G, el flag anti doble-click
(`_casinoOpening` o equivalente) quedaba en `true` por minutos → en ese lapso
tocar el botón no hacía NADA.

**Fix de 1-B y 1-C (estado final):**

- Helper nuevo `VIP.ui._fetchCasinoSession(timeoutMs)`:
  - hace el `POST /api/platform/session` con `AbortController` y timeout
    (default 20000 ms; guard `typeof AbortController !== 'undefined'`);
  - `response.json().catch(() => ({}))` para no explotar con body no-JSON;
  - devuelve `{ok:true, url}` si `response.ok && data.success &&
    data.redirectUrl`;
  - si no: `{ok:false, error: data.error||null, retryable: response.status >=
    500}` — **solo 5xx es reintentable** (4xx = bloqueado / límite de
    intentos: reintentar no cambia nada);
  - el catch (timeout o red caída) devuelve `{ok:false, error:null,
    retryable:true}`.
- `enterCasino` (el flujo del casino embebido): loop de hasta **3 intentos**.
  Entre intentos: actualizar el texto del status del overlay a
  `"🔄 Reintentando… (n/3)"` y esperar 1500 ms (antes del 2º) / 3000 ms
  (antes del 3º). Cortes de seguridad:
  - si el jugador salió del casino mientras cargaba
    (`!VIP.ui._casinoOpen`) → return silencioso (chequear al inicio de cada
    vuelta Y después de cada espera);
  - corta el loop si `ok` o si el error no es `retryable`;
  - **tras el éxito, chequear de nuevo `_casinoOpen` ANTES de setear
    `frame.src`** — si cerró el overlay durante el fetch, no arrancar el
    casino oculto (quedaría sonando de fondo).
  - El resto igual: watchdog de 15 s, `_casinoFrameError` con el error (o
    "No pudimos abrirte el casino. Revisá tu internet y tocá Reintentar.").
  - `_casinoOpening = false` va en `finally` (ya estaba).
- `openCasinoInTab` (abrir en pestaña aparte, el fallback del vigilante):
  usa el mismo helper con **1 reintento** si `retryable` (la pestaña
  placeholder ya está abierta dentro del gesto del usuario, así que reintentar
  el fetch no molesta al pop-up blocker); entre intentos, escribir
  "🔄 Reintentando…" en el body de la pestaña placeholder (con try/catch) y
  esperar 1500 ms. El resto del flujo (popup bloqueado → navegar en la misma
  pestaña, cerrar el placeholder ante error) queda igual.

Bump del SW de la PWA. **PROBAR:** tocar el botón CASINO repetidas veces,
incluso con red mala/lenta → el "Entrando al casino…" queda visible hasta que
el casino REAL carga (nunca más recuadro vacío ni "vuelta al chat"); ante
fallas reales se ve "Reintentando…" y entra solo; con el back caído → error
con botón Reintentar (el botón nunca queda muerto).

---

## FEATURE 2 — iPhone PWA instalada: la "línea blanca" de abajo era el fondo del `<html>`

**Síntoma (probado en iPhone real):** con la app instalada, franja blanca
"vacía" abajo (zona del home indicator), aunque los overlays ya compensen el
safe-area.

**Causa:** el fondo oscuro de la app está en `body`; el `<html>` quedó SIN
fondo → **blanco por defecto**. En standalone (`viewport-fit=cover`) iOS pinta
la franja del home indicator y el rebote del scroll con el fondo del documento
RAÍZ (html), no con el del body.

**Fix (1 regla en el CSS base, ANTES de la regla de `body`):**

```css
/* iPhone con la PWA INSTALADA (viewport-fit=cover): la franja del home
   indicator (abajo) y el rebote del scroll los pinta iOS con el fondo del
   documento raíz (<html>), no con el del <body>. Sin esto, <html> queda
   blanco por defecto → "línea blanca" abajo con la app instalada. */
html {
    background: #0a0015;
}
```

⚠️ Usar el color BASE del degradé de `body` DE LA GEMELA (en el original es
`#0a0015`; verificá el suyo con grep en su CSS base). Mismo bump de SW que la
FEATURE 1. **PROBAR** (iPhone, app instalada, cerrar/abrir 2 veces): abajo ya
no hay franja blanca — la zona del home indicator queda del color del fondo,
en la app y en el casino.

---

## FEATURE 3 — Panel admin: mensajes de sistema INTERNOS en VERDE con etiqueta "🔒 INTERNO"

**Pedido:** en el chat del panel, TODOS los mensajes de sistema se veían
naranjas iguales — imposible distinguir a simple vista cuáles le LLEGARON al
cliente (automáticos) y cuáles son solo internos del equipo.

**La distinción ya existe en los datos:** los internos viajan con
**`adminOnly: true`** (el cliente nunca los recibe: cierre de chat, alertas de
bonus para el agente, sync de clave fallido, comprobante repetido, etc.). El
flag ya viene en el historial (`GET` de mensajes lo selecciona) y en los
payloads de socket. Es solo cuestión de PINTARLO — no tocar backend.

**Cambio (panel `admin.js` + `admin.css`):**

- En el render de mensajes (`createMessageElement`), rama `type === 'system'`:
  - `const isInternal = message.adminOnly === true;`
  - clase: `'message system' + (isInternal ? ' internal' : '')`
  - si es interno: agregar ANTES del contenido
    `<div class="internal-badge">🔒 INTERNO — el cliente NO lo ve</div>` y
    SIN ícono en el contenido;
  - si NO es interno (automático que sí recibió el cliente): ícono **🤖**
    delante del contenido (reemplaza al 🔒 que se usaba antes ahí — el candado
    era engañoso: parecían internos y el cliente los había visto). Si el panel
    usa clases de ícono tipo `.icon-lock::before{content:"🔒"}`, agregar
    `.icon-robot::before { content: "🤖"; }`.
  - La hora de envío se mantiene igual en ambos.
- CSS (junto a la regla existente de `.message.system`, que queda naranja):

```css
/* Mensaje de sistema INTERNO (adminOnly): el cliente NO lo recibe. VERDE para
   distinguirlo al toque de los automáticos (naranja), con etiqueta explícita. */
.message.system.internal {
    background: rgba(37, 211, 102, 0.14);
    border-color: #25d366;
    color: #9ff5c0;
}
.message.system.internal .internal-badge {
    color: #2ee06f;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}
```

- Verificar que el camino EN VIVO (socket → addMessageToChat) use el mismo
  `createMessageElement` para `type:'system'` (en el original ya era así); si
  la gemela tuviera un render duplicado para el vivo, aplicarle la misma
  lógica.

Bump del **admin-sw**. **PROBAR:** abrir un chat con historial → "Chat cerrado
por..." y las alertas internas en VERDE con la etiqueta "🔒 INTERNO"; los
"¡Felicitaciones... bono acreditado!" que el cliente sí recibió, en naranja
con 🤖.

---

## CONTEXTO NUEVO — Partner API v1.11 (no es código, pero guardalo)

La plataforma publicó el manual **v1.11** (2026-08-13). Si la gemela tiene el
PDF propio, guardarlo en `docs/` (en el original: `docs/PARTNER-APIv1.11.pdf`
— el repo original lo tiene commiteado por si hace falta consultarlo).
Hallazgos que aplican igual a la gemela (mismo software de plataforma):

1. **v1.11 — `agent_id` en `POST /players` + `GET /agents`:** la key de la
   cuenta raíz puede CREAR un jugador colgado de un sub-agente de su red
   (`agent_id`), y `GET /agents` lista el subárbol (sirve como diagnóstico
   para saber de qué cuenta es una key: una de publicista devuelve lista
   vacía). **PROBADO EN VIVO en el original: es "crear y ENTREGAR"** — apenas
   el jugador nace bajo el sub-agente, la key creadora recibe
   `404 player_not_found` en lectura Y en depósito. **NO reemplaza el ruteo
   por keys de publicista** (el pool por publicista sigue siendo la solución).
   Error nuevo: `422 agent_not_allowed`.
2. **v1.10 — bono con multiplicador 0 = regalo directo:** se acredita
   disponible/retirable al instante, sin reclamo, y **ya no pisa el bono en
   curso**. Implicación pendiente de decisión del owner (NO implementar sin
   que lo pida): los guards bono-sobre-bono podrían dejar pasar regalos con
   multiplicador 0.

## NO REPLICAR

- La entrada #194 del original (era la guía consolidada anterior, ya aplicada).
- Los curls de prueba de la v1.11 (jugadores `zz_agtest*`): fueron pruebas
  puntuales contra la plataforma del original.

## CIERRE

Al terminar: WORKLOG.md con una entrada por feature (qué/por qué/cómo probar),
UN bump del SW de la PWA + UN bump del admin-sw, `node --check` de todo,
commit por feature y push. Después del deploy de estáticos, correr los
"PROBAR" (el de iPhone requiere un iPhone con la app instalada).
