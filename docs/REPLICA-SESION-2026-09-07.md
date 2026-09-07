# RÉPLICA sesiones 2026-08-30 y 09-07 (#204–#205 del original) — guía para la repo gemela

> **Cómo usar esto:** copiá TODO este documento como prompt inicial en una
> sesión del asistente parada en la OTRA repo, que ya aplicó todo hasta el
> **#203** del original (el #203 —pastilla "CARGA RÁPIDA"— lo pasó el owner a
> mano). Cubre DOS entradas: **#204** (backend+panel: NINGUNA push puede
> mencionar la ruleta diaria) y **#205** (backend: username tomado en 1girox
> por OTRA estructura → el alta falla sin dejar cuenta local).

---

## INSTRUCCIONES PARA EL ASISTENTE QUE IMPLEMENTA

1. **NO copies líneas a ciegas.** Verificá con grep cada nombre de función/
   archivo citado antes de tocar; las repos pueden haber divergido (marca,
   textos, nombres de campañas).
2. Un commit por feature, `node --check` en cada JS tocado (no hay
   node_modules local: solo syntax check).
3. Convenciones del proyecto (CLAUDE.md local): bump del admin-sw (el feature
   RULETA toca el panel); WORKLOG.md; commit + push a main.
4. Deploy: los DOS features son de BACKEND → **redeploy del back** (el bloque
   del panel va en el mismo deploy).

---

## FEATURE 1 (#204) — NINGUNA push puede mencionar la RULETA DIARIA

**Por qué:** la ruleta diaria NO está activa y a los clientes les llegaba la
push "🔥 La ruleta diaria te espera · Tenés tu giro gratis del día sin usar"
(sale del motor de ENCUESTA) → se quejaban porque no hay ruleta para tirar.
⚠️ Antes de implementar, confirmá con el owner de la gemela que ahí TAMPOCO
hay ruleta activa (si la usan, este feature NO va).

**1-A. Candado GLOBAL en `src/services/notificationService.js` (la clave):**

- Helper nuevo (cerca del tope del archivo):
  ```js
  const ROULETTE_TEXT_RE = /ruleta|roulette|giro\s+(gratis|del\s+d[ií]a)|\bgir[aá]\b/i;
  function isRouletteText(title, body, data) {
    const t = String(title || '') + ' ' + String(body || '');
    if (ROULETTE_TEXT_RE.test(t)) return true;
    if (data && typeof data === 'object') {
      const src = String(data.source || data.kind || data.type || '');
      if (/roulette|ruleta/i.test(src)) return true;
    }
    return false;
  }
  ```
- Al INICIO de las 5 funciones de envío (`sendNotificationToUser`,
  `sendNotificationToMultiple`, `sendNotificationToTopic`,
  `sendNotificationToAllUsers`, `sendNotificationToUsernames`): si
  `isRouletteText(title, body, data)` → NO enviar, `console.warn`
  `[FCM] 🚫 push BLOQUEADA (<dónde>): texto de RULETA — "<title>"` y devolver
  `{ success:false, blocked:'roulette', successCount:0, failureCount:0, error:… }`.
- Exportar `isRouletteText` y `ROULETTE_TEXT_RE` en el module.exports.
- Con esto queda bloqueado TODO: motores automáticos, reglas/plantillas/lotes
  editados desde el panel, envíos manuales.

**1-B. Sacar el mensaje de la biblioteca de la encuesta**
(`src/services/encuestaService.js`, array `INCENTIVO_MSGS`): eliminar (con
lápida) la entrada `{ title: '🔥 La ruleta diaria te espera', body: 'Tenés tu
giro gratis del día sin usar. ¡Aprovechalo!' }`.

**1-C. Seed + migraciones de lo GUARDADO en la base:**
- En `src/services/notificationRulesService.js`, la seed `PLAN-ACTIVO-DIARIO`
  decía `'Entrá y aprovechá los bonos de hoy. ¡Girá la ruleta y jugá!'` →
  cambiar a `'Entrá y aprovechá los bonos de hoy. ¡Jugá y divertite!'`.
- En `seedDefaultRulesIfMissing` (antes del loop que crea las que faltan),
  migración idempotente: buscar `NotificationRule` cuyo title/body matchee la
  MISMA regex de 1-A; si es una seed cuyo copy nuevo ya está limpio → pisarle
  title/body con el de la seed; si no → `enabled:false` + warn en el log para
  que el owner la edite desde el panel.
- En server.js, después del seed de reglas: `NotifTemplate.updateMany({$or:
  [{title: RE},{body: RE}]}, {$set:{title:'', body:''}})` — vacío = vuelve al
  texto default (que no menciona la ruleta).

**1-D. Botón "Reiniciar ruleta" del panel:** eliminar el checkbox "📲 Avisar a
todos por notificación (🎰 Ruleta diaria actualizada…)" del bloque REINICIAR
RULETA DIARIA (`public/adminprivado2026/index.html`), su lectura en
`resetRouletteDaily()` (admin.js manda `{}` en el body) y la rama del back en
`POST /api/admin/roulette/reset-daily` que mandaba esa push (dejar `notified =
null` en la respuesta por compat con paneles cacheados). Bump del admin-sw.

**PROBAR:** tras el redeploy, en los logs del boot buscar
`migración ruleta` (reglas/plantillas tocadas); intentar un envío manual de
push desde el panel con la palabra "ruleta" → no llega y aparece
`[FCM] 🚫 push BLOQUEADA` en el log.

**⚠️ Avisar al owner de la gemela:** si la sección ENCUESTA está activa, sigue
mandando los OTROS incentivos ("Te estamos esperando", etc.). Si tampoco los
quiere, se apaga desde el panel (isActive).

---

## FEATURE 2 (#205) — Username ya tomado en 1girox por OTRA estructura → el alta FALLA (sin cuenta local)

**El bug (caso real `gxdaiana323`):** los usernames de 1girox son únicos para
TODA la plataforma, pero la visibilidad/operación es POR RAMA. Si alguien
intenta crear un username que ya existe bajo OTRA estructura/agente (que
nuestras keys no ven), `girox.syncUserToPlatform` lo trataba como "ya existe
→ lo vinculo" (`alreadyExists:true` → cuenta local `giroxSyncStatus:'linked'`).
Resultado: cuenta local IMPOSIBLE de operar para siempre — cargas, retiros y
SSO dan `player_not_found` (y la red de seguridad del depósito intenta
crearlo → "ya existe" → error "el usuario no existe en ese acceso").

**2-A. Fix en la fuente (`src/services/giroxService.js`,
`syncUserToPlatform`):** la función primero hace `getUserInfoByName(username)`
(si lo VE, es nuestro → vincular como siempre, NO tocar esa rama). El caso a
cambiar es el de abajo: cuando `createPlatformUser` devuelve
`alreadyExists:true` (nombre tomado PERO nuestra key no lo pudo leer arriba)
→ en vez de `success:true, alreadyExists:true`, devolver:
```js
return {
  success: false,
  foreignUsername: true,
  code: 'username_taken_foreign',
  error: 'Ese nombre de usuario ya está en uso en la plataforma (pertenece a otra estructura). Elegí otro nombre.'
};
```

**2-B. Call sites (todos los altas fallan SIN dejar cuenta local):**
1. **Registro PWA** (`/api/auth/register`): en el `if (!jgResult.success &&
   !jgResult.alreadyExists)` agregar rama: código `username_taken_foreign` →
   400 `'Ese nombre de usuario ya está en uso. Elegí otro.'` (los demás
   errores siguen igual). register-quick y la landing heredan el rechazo por
   la fuente (la landing reintenta sola con otro sufijo — no tocar).
2. **Altas del panel** (`POST /api/admin/users` y el viejo `POST /api/users`):
   esos endpoints crean la cuenta local PRIMERO y sincronizan con await; en la
   rama de fallo del sync, si el código es `username_taken_foreign` →
   `User.deleteOne({id: userId})` + `return 400` con `'El usuario ya existe en
   la plataforma de 1girox (bajo otra estructura que no manejamos). Elegí OTRO
   nombre de usuario.'` (antes quedaba creada con platformWarning).
3. **Alta del publicista** (`POST /api/admin/publisher-admin/create-user`):
   el sync con la key corría en un IIFE fire-and-forget en background →
   pasarlo a **await inline** (necesario para poder abortar). Lógica:
   - `createUserAsPublisher` OK → como siempre (synced + giroxOwnerCampaign).
   - `result.alreadyExists` → borrar la cuenta local + 400 (mismo mensaje del
     punto 2 de esta lista). Ojo: si fuera un jugador nuestro con cuenta local, el alta ya
     rebotaba antes en el chequeo local — acá solo llegan ajenos.
   - Fallbacks a master (NO_CREDS / campaña sin key): si el sync master
     devuelve `username_taken_foreign` → borrar + 400; otros fallos, igual
     que antes.
   - **Excepción/error transitorio (girox caído) → NO abortar**: la cuenta
     local queda y se repara con la red de seguridad de la 1ª carga, como
     siempre. Costo del await: el alta espera ~1-2 s (igual que la del admin).
4. **SSO auto-reparación** (handler de `/api/platform/session`, rama
   `player_not_found` → crear al vuelo): si el sync falla con
   `username_taken_foreign`, persistir `giroxSyncStatus:'error'` +
   `giroxSyncError` antes de responder el 502 (cuentas YA rotas quedan
   marcadas y visibles en el panel). El endpoint de sync manual del panel ya
   muestra el error de la fuente solo.

**PROBAR:** intentar registrar (PWA) y crear (panel general y publicista) un
username que exista en OTRA estructura de la plataforma → rechaza con mensaje
claro y NO aparece en Usuarios; alta de un nombre libre → igual que siempre;
cliente ya roto de este tipo → botón CASINO responde "escribinos por chat" y
el user queda con estado de sync en error.

**Operativo (pasárselo a los agentes):** una cuenta ya "vinculada" a un
jugador ajeno NO se puede rescatar (recrearla no lo mueve de rama): crearle al
cliente un username NUEVO y bloquear/anotar la cuenta local vieja.

---

## NO REPLICAR

- La entrada #199/#194 del original (docs de réplica propios).
- El commit vacío "test auth".
- Los datos puntuales del caso gxdaiana323 (usuario/estructura leyla): son del
  original — en la gemela solo importa el comportamiento.

## CIERRE

WORKLOG.md con una entrada por feature (qué/por qué/cómo probar), bump del
admin-sw (feature RULETA), `node --check` de todo, commit por feature, push, y
**redeploy del BACK**.
