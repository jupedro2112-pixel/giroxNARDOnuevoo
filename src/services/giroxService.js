/**
 * giroxService.js — Cliente ÚNICO de la plataforma 1girox (Partner API v1.7).
 *
 * Reemplaza a los 4 clientes de JUGAYGANA (jugaygana.js, jugaygana-movements.js,
 * jugayganaService.js, jugayganaPublisherSessions.js). Diferencias de fondo:
 *
 *   - NO hay sesión que renovar: auth por header `X-Api-Key` fijo. Se van login/
 *     ensureSession/invalidateSession, el mutex de login y el pool por publicista.
 *   - NO hay HTML de Cloudflare: la API responde JSON siempre. Se va isHtmlBlocked().
 *   - Los montos van en PESOS (unidad mayor, admite decimales), NO en centavos.
 *     ⚠️ NO multiplicar ×100 en ningún lado — era el gotcha #1 de JUGAYGANA.
 *   - Cargas/retiros/bonos son IDEMPOTENTES por `reference`: reintentar con la misma
 *     reference NO duplica la operación (devuelve duplicate:true con los datos del
 *     original). Es la defensa real contra el doble cobro; ver `_withRetry`.
 *   - Todo va por `username`: 1girox no expone un ID numérico de jugador, así que
 *     `User.jugayganaUserId` NO tiene equivalente (ver giroxSyncStatus en User.js).
 *
 * FORMA DE LAS RESPUESTAS — a propósito, imita la de los clientes viejos para que
 * los ~60 call sites de server.js no tengan que reescribirse:
 *   - operaciones de plata → { success, data: { transfer_id, user_balance_after, ... } }
 *     (server.js lee `result.data?.transfer_id || result.data?.transferId` en 27 lugares
 *      y `result.data?.user_balance_after` como fallback de saldo en 7).
 *   - balance → { success, balance, username, ... }
 *   - errores → { success:false, error:'<texto para el usuario>', code, httpStatus }
 *
 * CONFIG (lazy — se leen en runtime, NUNCA en el require):
 *   GIROX_API_URL   Base URL de la Partner API, sin barra final. La entrega el agente
 *                   junto con la key. Ej: https://api.1girox.com/api/v1
 *   GIROX_API_KEY   Header X-Api-Key (`pk_...`). Va en SSM, jamás en el repo.
 *   GIROX_API_KEY_CONSULTAS  (opcional) key(s) del MISMO agente solo para
 *                   lecturas de stats/netwin — cupo de rate limit propio.
 *                   Una o varias separadas por coma (pool balanceado).
 *   GIROX_PLAY_URL  Sitio de juego al que se manda al cliente (default 1girox.com).
 *
 * ⚠️ Los secrets de SSM se cargan en el bootstrap async, DESPUÉS de que Node resuelve
 * los require() del top de server.js. Por eso acá todo se lee con getters lazy y el
 * cliente axios se construye on-demand — el bug que tienen hoy los 4 clientes viejos,
 * que congelan process.env en consts de módulo (funcionan sólo porque esas vars están
 * en el entorno de EB y no en SSM). Mismo patrón correcto que hgcashService.js:19.
 */
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const _fileLogger = require('../utils/logger');
// ⚠️ En producción winston escribe SOLO a archivos locales (logs/*.log) que NO
// entran en el bundle de logs de EB → la saturación del limitador, los
// reintentos y los 429 de este cliente eran INVISIBLES para el diagnóstico
// (lag nocturno del 13-15/08: los logs solo mostraban el error del caller).
// Espejo de warn/error a consola: web.stdout.log sí los captura.
const logger = {
  info: function (m) { _fileLogger.info(m); },
  warn: function (m) {
    _fileLogger.warn(m);
    try { console.warn(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' [WARN] ' + m); } catch (_) {}
  },
  error: function (m) {
    _fileLogger.error(m);
    try { console.error(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' [ERROR] ' + m); } catch (_) {}
  }
};

// ============================================================
// CONFIG (lazy)
// ============================================================

function getBaseUrl() {
  const raw = process.env.GIROX_API_URL || '';
  return raw.trim().replace(/\/+$/, ''); // sin barra final
}
function getApiKey() {
  return process.env.GIROX_API_KEY || null;
}
/** Keys OPCIONALES solo-consultas (`GIROX_API_KEY_CONSULTAS` en SSM, 2026-08-15).
 *  El límite de 1girox es POR KEY (confirmado por su soporte): con keys extra,
 *  las lecturas pesadas (stats/netwin de reembolsos, VIP, referidos, datos)
 *  viajan con cupo PROPIO y no compiten con cargas/retiros/SSO.
 *  Acepta UNA o VARIAS separadas por coma (pool: N keys = N×60/min de lectura;
 *  cada request sale por la key menos cargada del minuto). Sin la env, todo
 *  sigue por la key master como siempre.
 *  ⚠️ TODAS deben crearse bajo el MISMO agente que la master: una key de otro
 *  agente NO VE a los jugadores (mismo motivo del ruteo por publicista). */
/** Parsea la lista de consultas. Cada entrada acepta un techo PROPIO con el
 *  sufijo `:rpm` (POR INSTANCIA, mismo criterio que GIROX_MAX_RPM): la
 *  plataforma subió el límite a 180 solo en ALGUNAS keys (2026-08-15), así
 *  que ya no alcanza un techo parejo. Ej. con 2 instancias, una key de 180 y
 *  una de 60: `pk_aaa:90,pk_bbb:30`. Sin sufijo → GIROX_MAX_RPM.
 *  @returns {Array<{key:string, rpm:number}>} */
function _readsKeyConfigs() {
  const raw = process.env.GIROX_API_KEY_CONSULTAS || '';
  return raw.split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const i = e.lastIndexOf(':');
      if (i > 0) {
        const rpm = Number(e.slice(i + 1));
        if (Number.isFinite(rpm) && rpm > 0) return { key: e.slice(0, i).trim(), rpm };
      }
      return { key: e, rpm: MAX_RPM };
    })
    .filter((c) => c.key);
}

function getReadsKeys() {
  return _readsKeyConfigs().map((c) => c.key);
}

// Techo de las keys de PUBLICISTA (en la plataforma siguen en 60/min): 60 ÷ 2
// instancias. Env propia por si girox se las sube — NO heredan GIROX_MAX_RPM,
// que acompaña a la master (180/min desde el 2026-08-15).
const PUBLISHER_MAX_RPM = Number(process.env.GIROX_PUBLISHER_MAX_RPM || 30);

// Overrides POR key de publicista (`GIROX_PUBLISHER_KEY_RPM` = `pk_x:90,pk_y:90`).
// Para cuando 1girox sube el límite de UN publicista puntual (ej. onekey, con
// miles de jugadores) a 180: se le pone su techo propio sin cambiar el del resto.
// Sin la env, todos los publicistas usan PUBLISHER_MAX_RPM.
function _publisherKeyConfigs() {
  const raw = process.env.GIROX_PUBLISHER_KEY_RPM || '';
  return raw.split(',').map((e) => e.trim()).filter(Boolean).map((e) => {
    const i = e.lastIndexOf(':');
    if (i > 0) {
      const rpm = Number(e.slice(i + 1));
      if (Number.isFinite(rpm) && rpm > 0) return { key: e.slice(0, i).trim(), rpm };
    }
    return null;
  }).filter(Boolean);
}

/** Techo de la ventana local para UNA key: consultas → su sufijo `:rpm`;
 *  master → GIROX_MAX_RPM; publicista con override → su rpm; resto de
 *  publicistas → PUBLISHER_MAX_RPM. */
function _laneLimit(laneKey) {
  const cfg = _readsKeyConfigs().find((c) => c.key === laneKey);
  if (cfg) return cfg.rpm;
  if (!laneKey || laneKey === 'master' || laneKey === getApiKey()) return MAX_RPM;
  const pub = _publisherKeyConfigs().find((c) => c.key === laneKey);
  if (pub) return pub.rpm;
  return PUBLISHER_MAX_RPM;
}

/** Elige la key de consultas con MÁS LUGAR LIBRE (techo − usado) en su
 *  ventana: una key de 180 absorbe proporcionalmente más que una de 60. */
function _pickReadsKey() {
  const configs = _readsKeyConfigs();
  if (configs.length === 0) return null;
  if (configs.length === 1) return configs[0].key;
  const now = Date.now();
  let best = configs[0].key;
  let bestFree = -Infinity;
  for (const c of configs) {
    const arr = _laneTimestamps.get(c.key) || [];
    const load = arr.filter((t) => now - t < WINDOW_MS).length;
    const free = c.rpm - load;
    if (free > bestFree) { bestFree = free; best = c.key; }
  }
  return best;
}

/** Elige, de un POOL de keys del MISMO publicista, la que tiene más lugar libre
 *  en su ventana (todas ven a los mismos jugadores → repartir multiplica el
 *  cupo). Usa el techo por-key de _laneLimit (publicistas = PUBLISHER_MAX_RPM). */
function _pickPublisherKey(pool) {
  const keys = (Array.isArray(pool) ? pool : []).filter(Boolean);
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  const now = Date.now();
  let best = keys[0], bestFree = -Infinity;
  for (const k of keys) {
    const arr = _laneTimestamps.get(k) || [];
    const load = arr.filter((t) => now - t < WINDOW_MS).length;
    const free = _laneLimit(k) - load;
    if (free > bestFree) { bestFree = free; best = k; }
  }
  return best;
}
/** URL pública del casino (la que ve el usuario). */
function getPlayUrl() {
  return (process.env.GIROX_PLAY_URL || 'https://1girox.com').replace(/\/+$/, '');
}
/** true si el cliente está configurado y puede operar. */
function isEnabled() {
  return !!(getBaseUrl() && getApiKey());
}

const TIMEOUT_MS = Number(process.env.GIROX_TIMEOUT_MS || 20000);

// Reintentos ante fallas transitorias (5xx / timeout / red / 429).
// La doc recomienda backoff 2s, 5s, 15s reusando SIEMPRE la misma reference.
const RETRY_DELAYS_MS = [2000, 5000, 15000];

// ============================================================
// RATE LIMIT — 60 requests/minuto POR KEY (límite de la API; 429 si se pasa)
// ============================================================
// El límite de la plataforma es POR API KEY (confirmado por soporte 2026-08-15),
// así que el limitador local también ventanea POR KEY: la key de consultas y las
// de publicistas tienen cupo propio y no le comen lugar a la master.
// ⚠️ MULTI-INSTANCIA (AWS EB): este limitador es POR PROCESO. Con N instancias el
// techo real es N×GIROX_MAX_RPM por key, así que el 429 sigue siendo posible →
// por eso además se reintenta respetando Retry-After. Con 2 instancias, poner
// GIROX_MAX_RPM = (límite por key)/2 (ej. 30 con límite 60; 90 si lo suben a 180).
const MAX_RPM = Number(process.env.GIROX_MAX_RPM || 55); // margen de seguridad bajo el límite
const WINDOW_MS = 60000;
const MAX_QUEUE_WAIT_MS = 30000; // si hay que esperar más que esto, falla rápido

const _laneTimestamps = new Map(); // apiKey → timestamps de la ventana

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Espera a que haya lugar en la ventana de rate limit DE ESA KEY.
 *  Devuelve false si esperar sería excesivo. */
async function _acquireSlot(laneKey) {
  const lane = laneKey || 'master';
  const limit = _laneLimit(lane); // las keys de consultas pueden tener techo propio (:rpm)
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
  for (;;) {
    const now = Date.now();
    const arr = (_laneTimestamps.get(lane) || []).filter((t) => now - t < WINDOW_MS);
    if (arr.length < limit) {
      arr.push(now);
      _laneTimestamps.set(lane, arr);
      return true;
    }
    _laneTimestamps.set(lane, arr);
    const oldest = arr[0];
    const waitMs = Math.max(50, WINDOW_MS - (now - oldest) + 25);
    if (now + waitMs > deadline) return false;
    await _sleep(waitMs);
  }
}

// ============================================================
// TRANSPORTE
// ============================================================

// ============================================================
// RUTEO POR DUEÑO DEL JUGADOR (fix 2026-08-05)
// ============================================================
// Los jugadores creados con la key de un PUBLICISTA viven bajo ESE agente en la
// jerarquía de 1girox, y la key MASTER **NO LOS VE** por Partner API (comprobado:
// depositar a un jugador de un sub-agente devolvía player_not_found, aunque el
// panel web sí lo permita). El supuesto viejo de giroxPublisherKeys.js ("cargas y
// retiros van por la master, que opera sobre toda su jerarquía") era FALSO.
//
// server.js inyecta acá un resolver `username → apiKey|null` (lee
// User.giroxOwnerCampaign → Campaign.giroxApiKey, con cache corto). Con eso,
// TODA operación por username firma sola con la key del dueño del jugador —
// cargas, retiros, saldo, stats, SSO, cambio de clave — sin tocar los ~60 call
// sites. null / error del resolver → key master (comportamiento de siempre).
let _keyResolver = null;
function setKeyResolver(fn) { _keyResolver = typeof fn === 'function' ? fn : null; }
async function _resolveKeyFor(username) {
  if (!_keyResolver || !username) return null;
  try {
    return (await _keyResolver(String(username))) || null;
  } catch (e) {
    logger.warn(`[girox] keyResolver(${username}) falló: ${e.message} — usando key master`);
    return null;
  }
}

function _headers(apiKeyOverride) {
  return {
    'X-Api-Key': apiKeyOverride || getApiKey(),
    'Content-Type': 'application/json',
    // La doc lo pide explícitamente: evita que los errores vuelvan en HTML.
    Accept: 'application/json'
  };
}

/** Mensajes al usuario final por código de error de 1girox. */
const ERROR_MESSAGES = {
  unauthorized: 'La plataforma rechazó nuestras credenciales. Avisale al soporte.',
  invalid_credentials: 'Usuario o contraseña incorrectos.',
  player_not_found: 'Tu cuenta no existe en la plataforma. Contactá al soporte.',
  insufficient_funds: 'Saldo insuficiente.',
  rollover_locked: 'Tenés un objetivo de apuestas pendiente: todavía no podés retirar ese monto.',
  feature_disabled: 'Esa función no está habilitada en la plataforma.',
  bonus_out_of_range: 'El monto del bono está fuera de los límites permitidos.',
  wallet_not_configured: 'La plataforma está en mantenimiento. Reintentá en unos minutos.'
};

/** Normaliza cualquier error (de red o de la API) a { error, code, httpStatus, retryable }. */
function _normalizeError(e, opLabel) {
  // Error de red / timeout / DNS: sin response.
  if (!e.response) {
    const isTimeout = e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '');
    return {
      error: isTimeout
        ? 'La plataforma está demorada. Reintentá en un momento.'
        : 'No se pudo conectar con la plataforma. Reintentá en un momento.',
      code: e.code || 'network_error',
      httpStatus: null,
      retryable: true,
      detail: `${opLabel}: ${e.code || ''} ${e.message || ''}`.trim()
    };
  }

  const httpStatus = e.response.status;
  const body = e.response.data || {};
  const apiCode = (body.error && body.error.code) || body.code || null;
  const apiMessage = (body.error && body.error.message) || body.message || null;

  // 422 de validación estilo Laravel: { message, errors: {campo: [...]} }
  let validationDetail = null;
  if (httpStatus === 422 && body.errors && typeof body.errors === 'object') {
    validationDetail = Object.entries(body.errors)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' | ');
  }

  const friendly =
    ERROR_MESSAGES[apiCode] ||
    apiMessage ||
    validationDetail ||
    `Error de la plataforma (HTTP ${httpStatus}).`;

  return {
    error: friendly,
    code: apiCode || `http_${httpStatus}`,
    httpStatus,
    // 429 y 5xx son transitorios. 503 wallet_not_configured la doc pide reintentarlo
    // con la MISMA reference. 4xx de negocio (saldo, rollover, validación) NO.
    retryable: httpStatus === 429 || httpStatus >= 500,
    retryAfterMs: _parseRetryAfter(e.response.headers),
    detail: `${opLabel}: HTTP ${httpStatus} ${JSON.stringify(body).slice(0, 300)}`,
    body
  };
}

function _parseRetryAfter(headers) {
  if (!headers) return null;
  const raw = headers['retry-after'] || headers['Retry-After'];
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) ? Math.min(secs * 1000, 60000) : null;
}

/**
 * Ejecuta una request contra la Partner API con rate limit + reintentos.
 * Devuelve { ok:true, data } | { ok:false, ...normalizedError }.
 *
 * @param {object} opts
 * @param {'get'|'post'|'put'} opts.method
 * @param {string} opts.path            path relativo, ej. `/players/juan/deposit`
 * @param {object} [opts.body]
 * @param {string} opts.label           etiqueta para los logs
 * @param {boolean} [opts.retryable]    si false, no reintenta (operaciones sin idempotencia)
 * @param {string} [opts.username]      jugador objetivo → el resolver decide con qué key firmar
 * @param {string} [opts.apiKey]        key explícita (gana sobre el resolver; para el batch)
 * @param {boolean} [opts.readOnly]     lectura pura → si hay key de consultas y la request
 *                                      iría por la MASTER, firma con la de consultas (cupo aparte)
 */
async function _request({ method, path, body, label, retryable = true, username = null, apiKey = null, readOnly = false }) {
  if (!isEnabled()) {
    logger.error('[girox] GIROX_API_URL / GIROX_API_KEY no configurados');
    return { ok: false, error: 'La plataforma no está configurada. Avisale al soporte.', code: 'not_configured', httpStatus: null };
  }

  // Se resuelve UNA vez (no por reintento): la key del dueño no cambia en medio.
  let keyOverride = apiKey || await _resolveKeyFor(username);
  // Pool de keys del publicista: si el resolver devolvió un ARRAY (varias keys
  // del mismo publicista, todas ven a los mismos jugadores), se elige la que
  // tiene más lugar libre → reparte la carga. Se elige UNA vez (antes de los
  // reintentos) para no romper la idempotencia por reference.
  if (Array.isArray(keyOverride)) keyOverride = _pickPublisherKey(keyOverride);
  // Lecturas por el pool de consultas SOLO cuando iría por la master: la key de
  // un publicista es la única que ve a SUS jugadores, no se puede reemplazar.
  if (!keyOverride && readOnly) keyOverride = _pickReadsKey();

  const url = `${getBaseUrl()}${path}`;
  let lastErr = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = lastErr && lastErr.retryAfterMs ? lastErr.retryAfterMs : RETRY_DELAYS_MS[attempt - 1];
      logger.warn(`[girox] ${label} — reintento ${attempt}/${RETRY_DELAYS_MS.length} en ${wait}ms (${lastErr && lastErr.code})`);
      await _sleep(wait);
    }

    if (!(await _acquireSlot(keyOverride || getApiKey()))) {
      logger.warn(`[girox] ${label} — rate limit local saturado (${_laneLimit(keyOverride || getApiKey())}/min${keyOverride && getReadsKeys().includes(keyOverride) ? ', key consultas' : ''}), abortando`);
      return { ok: false, error: 'La plataforma está saturada. Reintentá en un minuto.', code: 'rate_limited_local', httpStatus: null };
    }

    try {
      const resp = await axios({
        method,
        url,
        data: body,
        headers: _headers(keyOverride),
        timeout: TIMEOUT_MS,
        proxy: false
      });
      return { ok: true, data: resp.data || {}, httpStatus: resp.status };
    } catch (e) {
      lastErr = _normalizeError(e, label);
      // Log sin exponer la key ni la password del body.
      logger.warn(`[girox] ${lastErr.detail}`);
      if (!retryable || !lastErr.retryable || attempt === RETRY_DELAYS_MS.length) {
        return { ok: false, ...lastErr };
      }
    }
  }
  return { ok: false, ...(lastErr || { error: 'Error desconocido', code: 'unknown', httpStatus: null }) };
}

// ============================================================
// HELPERS DE DOMINIO
// ============================================================

/**
 * Reglas de username de 1girox: 3-18 caracteres, sólo letras/números/guion bajo.
 * ⚠️ MIGRACIÓN: hay que correr esto sobre TODA la base antes de migrar — cualquier
 * usuario que no pase NO se puede crear en 1girox y necesita decisión manual.
 * @returns {{valid:boolean, reason?:string}}
 */
function validateUsername(username) {
  const u = String(username || '');
  if (u.length < 3) return { valid: false, reason: 'menos de 3 caracteres' };
  if (u.length > 18) return { valid: false, reason: `${u.length} caracteres (máximo 18)` };
  if (!/^[A-Za-z0-9_]+$/.test(u)) return { valid: false, reason: 'tiene caracteres no permitidos (sólo letras, números y _)' };
  return { valid: true };
}

/** Normaliza el monto a pesos con 2 decimales. Devuelve null si es inválido. */
function _normalizeAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100; // 2 decimales, SIN convertir a centavos
}

/**
 * Arma la respuesta de una operación de plata con la MISMA forma que los clientes
 * viejos, para no tocar los 27 call sites que leen data.transfer_id / user_balance_after.
 */
function _moneyResult(data) {
  const op = data.operation || {};
  return {
    success: true,
    duplicate: !!data.duplicate,
    data: {
      // compat: server.js lee `transfer_id || transferId` en todos lados
      transfer_id: op.ledger_id != null ? String(op.ledger_id) : (op.reference || null),
      transferId: op.ledger_id != null ? String(op.ledger_id) : (op.reference || null),
      user_balance_after: data.balance != null ? Number(data.balance) : undefined,
      // datos propios de 1girox
      reference: op.reference || null,
      ledger_id: op.ledger_id != null ? Number(op.ledger_id) : null,
      type: op.type || null,
      created_at: op.created_at || null,
      duplicate: !!data.duplicate,
      wagering: data.wagering || null
    }
  };
}

/** Extrae el desglose de saldo de un objeto `player`. */
function _playerBalances(player) {
  const balance = player.balance != null ? Number(player.balance) : 0;
  const w = player.wagering || null;
  return {
    balance,
    // `available` = lo único RETIRABLE si el feat de rollover está activo.
    // Sin rollover, 1girox no manda `wagering` → disponible == balance.
    available: w && w.available != null ? Number(w.available) : balance,
    // Bloqueado por objetivos de apuesta pendientes.
    locked: w && w.locked != null ? Number(w.locked) : 0,
    bonusLocked: w && w.bonus_locked != null ? Number(w.bonus_locked) : 0,
    // BONOS A RECLAMAR (Partner API v1.7, 2026-07-31): un bono que cumplió su
    // objetivo —o que se otorgó con multiplier 0— YA NO se libera solo. Queda
    // bloqueado hasta que el jugador lo reclama en el casino (el "regalito" del
    // header). Si esto es > 0, el usuario tiene plata esperándolo que no ve en su
    // saldo disponible: conviene avisárselo.
    claimableTotal: w && w.claimable_total != null ? Number(w.claimable_total) : 0,
    claimable: (w && Array.isArray(w.claimable)) ? w.claimable : [],
    wagering: w
  };
}

// ============================================================
// JUGADORES — alta, consulta, credenciales
// ============================================================

/**
 * Crea un jugador en 1girox. POST /players
 * @returns { success, player } | { success:false, error, code, alreadyExists? }
 */
async function createPlatformUser({ username, password }) {
  const check = validateUsername(username);
  if (!check.valid) {
    return { success: false, error: `Usuario inválido para la plataforma: ${check.reason}`, code: 'invalid_username' };
  }
  if (!password || String(password).length < 6) {
    return { success: false, error: 'La contraseña debe tener al menos 6 caracteres', code: 'invalid_password' };
  }

  const r = await _request({
    method: 'post',
    path: '/players',
    body: { username: String(username), password: String(password) },
    label: `createPlayer(${username})`,
    username
  });

  if (r.ok) return { success: true, player: (r.data && r.data.player) || null };

  // Username ya tomado → la API lo devuelve como 422 de validación. Lo tratamos como
  // "ya existe" (no es un error para syncUserToPlatform).
  if (r.httpStatus === 422 && /username/i.test(JSON.stringify(r.body || {}))) {
    return { success: false, error: r.error, code: 'username_taken', alreadyExists: true };
  }
  return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
}

// ============================================================
// CACHE CORTO + COALESCING de la lectura de jugador (2026-08-16)
// ============================================================
// PORQUÉ: getUserInfoByName (y getUserBalance, que la usa) es el punto MÁS
// consultado del cliente — la PWA pollea el saldo de cada usuario online, y
// además lo leen los guards de bono, el status de reembolsos, etc. Para
// jugadores de PUBLICISTA todo eso va por la ÚNICA key de ese publicista
// (30/min) → con pocos usuarios online se satura y TODO lo de ellos (ver saldo,
// acreditar bono, cargar) se relentiza. Causa raíz del lag reportado (logs
// 2026-08-16: 98/124 saturaciones eran `getPlayer`, carril de publicista).
//
// SOLUCIÓN: cache de pocos segundos por username + coalescing de llamadas en
// vuelo → girox se consulta ~1 vez por usuario por ventana, por más que N cosas
// pidan el saldo a la vez. SIN staleness peligroso:
//   • Se INVALIDA en cada operación de plata del usuario (deposit/withdraw/
//     bonus/claim) → toda lectura POST-cambio es fresca.
//   • TTL corto (default 8s) → un cambio externo (jugó en el casino) se refleja
//     en ≤8s (y el poll real es más lento que eso, así que igual llega fresco).
//   • Solo se cachean lecturas EXITOSAS — nunca null/errores transitorios.
//   • La plataforma sigue siendo la verdad para el DÉBITO real (el retiro/carga
//     los valida girox server-side); el cache es solo para LECTURA/display.
const PLAYER_CACHE_TTL_MS = Number(process.env.GIROX_PLAYER_CACHE_MS || 8000);
const _playerCache = new Map();        // usernameLower → { data, ts }
const _playerInflight = new Map();     // usernameLower → Promise<data|null>
const _playerInvalidatedAt = new Map(); // usernameLower → ts de la última invalidación

// Cache de stats/netwin (getPlayerStats) — status de reembolso. Ver getPlayerStats.
const STATS_CACHE_TTL_MS = Number(process.env.GIROX_STATS_CACHE_MS || 90000);
const _statsCache = new Map();         // "user|from|to" → { data, ts }

/** Borra el saldo cacheado de un usuario (se llama tras cada operación de plata)
 *  y registra CUÁNDO se invalidó, para que una lectura que venía en vuelo no
 *  vuelva a cachear el valor viejo después (ver _maybeCachePlayer). */
function _invalidatePlayer(username) {
  const k = String(username || '').toLowerCase();
  _playerCache.delete(k);
  _playerInvalidatedAt.set(k, Date.now());
}

/** Cachea SOLO si ninguna operación de plata invalidó a este usuario DESPUÉS de
 *  que la lectura arrancó. Evita la race: una lectura en vuelo cuando se
 *  acreditó/retiró NO debe escribir el saldo pre-operación en el cache. */
function _maybeCachePlayer(key, data, startTs) {
  if (!data) return; // solo se cachea el éxito
  if ((_playerInvalidatedAt.get(key) || 0) >= startTs) return; // invalidado mientras leíamos
  _playerCache.set(key, { data, ts: Date.now() });
}

// Prune periódico: el cache y los timestamps de invalidación crecen ~1 entrada
// por usuario consultado. Cada 60s se limpian los vencidos. `.unref()` para no
// mantener vivo el proceso solo por este timer.
const _playerCachePrune = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _playerCache) if (now - v.ts >= PLAYER_CACHE_TTL_MS) _playerCache.delete(k);
  for (const [k, v] of _statsCache) if (now - v.ts >= STATS_CACHE_TTL_MS) _statsCache.delete(k);
  // Los timestamps de invalidación se guardan más tiempo que la peor lectura en
  // vuelo posible (timeout + reintentos ~80s) para no reactivar la race.
  for (const [k, ts] of _playerInvalidatedAt) if (now - ts >= 300000) _playerInvalidatedAt.delete(k);
}, 60000);
if (_playerCachePrune.unref) _playerCachePrune.unref();

/** Lectura CRUDA del jugador contra girox (sin cache). */
async function _fetchUserInfo(username) {
  const r = await _request({
    method: 'get',
    path: `/players/${encodeURIComponent(String(username))}`,
    label: `getPlayer(${username})`,
    username
  });
  if (!r.ok) return null; // player_not_found o cualquier fallo → null (contrato de siempre)
  const player = (r.data && r.data.player) || null;
  if (!player) return null;
  const bal = _playerBalances(player);
  return {
    // Desde la Partner API v1.8 el ID numérico del jugador VIENE en la respuesta.
    id: player.id != null ? Number(player.id) : null,
    username: player.username || String(username),
    email: player.email || null,
    active: player.active !== false,
    balance: bal.balance,
    available: bal.available,
    locked: bal.locked,
    bonusLocked: bal.bonusLocked,
    claimableTotal: bal.claimableTotal,
    claimable: bal.claimable,
    wagering: bal.wagering,
    createdAt: player.created_at || null
  };
}

/**
 * Consulta un jugador (datos + saldo + desglose de rollover). GET /players/{username}
 * Con cache corto + coalescing (ver bloque de arriba).
 * @param {object} [opts]
 * @param {boolean} [opts.fresh] SALTEA el cache de lectura y el coalescing — para
 *   DECISIONES DE PLATA que necesitan el saldo exacto del momento (delta de un
 *   retiro, guard bono-sobre-bono). Igual refresca el cache para las lecturas de
 *   display siguientes. Las lecturas de display (poll, status) NO lo pasan.
 * @returns { username, balance, available, wagering, email, active, id } | null si no existe
 */
async function getUserInfoByName(username, opts = {}) {
  const key = String(username || '').toLowerCase();
  if (!key) return null;

  if (opts && opts.fresh) {
    // Lectura garantizada fresca (no lee cache ni se une a una en vuelo), pero
    // actualiza el cache para las de display que vengan después.
    const startTs = Date.now();
    const data = await _fetchUserInfo(username);
    _maybeCachePlayer(key, data, startTs);
    return data;
  }

  const cached = _playerCache.get(key);
  if (cached && (Date.now() - cached.ts) < PLAYER_CACHE_TTL_MS) return cached.data;

  // Coalescing: si ya hay una lectura EN VUELO para este usuario, se comparte
  // (no se dispara otra request a girox).
  const inflight = _playerInflight.get(key);
  if (inflight) return inflight;

  const startTs = Date.now();
  const p = (async () => {
    const data = await _fetchUserInfo(username);
    _maybeCachePlayer(key, data, startTs);
    return data;
  })();
  _playerInflight.set(key, p);
  try {
    return await p;
  } finally {
    _playerInflight.delete(key);
  }
}

/** @returns {boolean} true si el jugador existe en 1girox. */
async function checkUserExists(username) {
  const info = await getUserInfoByName(username);
  return !!info;
}

/** Lee un jugador con una KEY ESPECÍFICA (sin cache, sin resolver). Sirve para
 *  VALIDAR que una key extra del pool de un publicista ve a sus jugadores antes
 *  de guardarla en el panel. @returns { found:bool, username?, balance? }. */
async function readPlayerWithKey(apiKey, username) {
  if (!apiKey || !username) return { found: false };
  const r = await _request({
    method: 'get',
    path: `/players/${encodeURIComponent(String(username))}`,
    label: `test-key(${username})`,
    apiKey,
    retryable: false
  });
  if (!r.ok) return { found: false, error: r.error, code: r.code };
  const p = (r.data && r.data.player) || null;
  return p ? { found: true, username: p.username, balance: p.balance } : { found: false };
}

/**
 * Chequeo de salud REAL contra la Partner API, para diagnóstico.
 *
 * ⚠️ NO usar `getUserInfoByName` para esto: devuelve `null` ante CUALQUIER fallo
 * (404, 401, timeout…), así que un `null` no distingue "el jugador no existe" de
 * "la key fue rechazada". Ese fue exactamente el falso positivo que hizo que el
 * endpoint de health dijera "la key es válida" mientras el alta de usuarios fallaba
 * con 401. Acá se mira el código de error crudo.
 *
 * Consulta un jugador inexistente: la respuesta ESPERADA es 404 player_not_found.
 * @returns { ok, estado, detalle, httpStatus, code }
 */
async function ping() {
  if (!isEnabled()) {
    return { ok: false, estado: 'sin_configurar', detalle: 'Faltan GIROX_API_URL y/o GIROX_API_KEY' };
  }
  const probe = 'zz_probe_' + Date.now().toString(36).slice(-8);
  const r = await _request({
    method: 'get',
    path: `/players/${probe}`,
    label: `ping(${probe})`,
    retryable: false // diagnóstico: queremos la respuesta cruda, sin esperar reintentos
  });

  if (r.ok) {
    return { ok: false, estado: 'inesperado', detalle: 'Devolvió datos para un jugador que no existe' };
  }
  if (r.code === 'player_not_found' || r.httpStatus === 404) {
    return { ok: true, estado: 'ok', detalle: 'La plataforma responde y la API key es válida', httpStatus: r.httpStatus };
  }
  if (r.code === 'unauthorized' || r.httpStatus === 401) {
    return {
      ok: false,
      estado: 'key_rechazada',
      detalle: 'La plataforma respondió, pero RECHAZÓ la API key (401 unauthorized). ' +
        'O la Base URL es de otra instalación, o la key está inactiva/regenerada.',
      httpStatus: r.httpStatus,
      code: r.code
    };
  }
  return { ok: false, estado: 'error', detalle: r.error, httpStatus: r.httpStatus, code: r.code };
}

/**
 * Crea el jugador si no existe; si ya existe, lo reporta como vinculado.
 * Equivalente a jugaygana.syncUserToPlatform, pero SIN jugayganaUserId (1girox va por username).
 * @returns { success, alreadyExists, platformUsername, player } | { success:false, error, code }
 */
async function syncUserToPlatform({ username, password }) {
  const existing = await getUserInfoByName(username);
  if (existing) {
    return { success: true, alreadyExists: true, platformUsername: existing.username, player: existing };
  }
  const created = await createPlatformUser({ username, password });
  if (created.success) {
    return { success: true, alreadyExists: false, platformUsername: username, player: created.player };
  }
  if (created.alreadyExists) {
    // (owner 2026-09-07, caso gxdaiana323) El nombre está TOMADO en la plataforma
    // pero NUESTRA key no puede leer al jugador (el getUserInfoByName de arriba
    // devolvió null) → es un jugador de OTRA estructura/agente de 1girox (los
    // usernames son únicos para TODA la plataforma, la visibilidad es por rama).
    // "Vincularlo" crearía una cuenta local imposible de operar para siempre
    // (cargas/retiros/SSO → player_not_found). Se RECHAZA: que elija otro nombre.
    return {
      success: false,
      foreignUsername: true,
      code: 'username_taken_foreign',
      error: 'Ese nombre de usuario ya está en uso en la plataforma (pertenece a otra estructura). Elegí otro nombre.'
    };
  }
  return { success: false, error: created.error, code: created.code };
}

/**
 * Valida usuario+contraseña contra la plataforma. POST /players/validate
 * Reemplaza a jugayganaService.loginAsUser (que devolvía un token de sesión).
 * OJO: la API responde 200 con { valid:false } cuando la contraseña es incorrecta.
 * @returns { success, valid, player } | { success:false, error, code }
 */
async function validateCredentials(username, password) {
  const r = await _request({
    method: 'post',
    path: '/players/validate',
    body: { username: String(username), password: String(password) },
    label: `validate(${username})`,
    username
  });
  if (!r.ok) return { success: false, valid: false, error: r.error, code: r.code };
  return { success: true, valid: !!(r.data && r.data.valid), player: (r.data && r.data.player) || null };
}

/**
 * Cambia la contraseña del jugador sin necesitar su sesión (ya lo autenticamos nosotros).
 * PUT /players/{username}/password — cierra todas sus sesiones abiertas en la plataforma.
 * Reemplaza a jugayganaService.changeUserPasswordAsAdmin.
 * @returns { success } | { success:false, error, code }
 */
async function changeUserPassword(username, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    return { success: false, error: 'La contraseña debe tener al menos 6 caracteres', code: 'invalid_password' };
  }
  const r = await _request({
    method: 'put',
    path: `/players/${encodeURIComponent(String(username))}/password`,
    body: { password: String(newPassword) },
    label: `changePassword(${username})`,
    username
  });
  if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
  return { success: true };
}

// ============================================================
// LOGIN ÚNICO (SSO) — el botón CASINO
// ============================================================

/**
 * Pide un link de acceso directo a la plataforma. POST /players/{username}/session
 *
 * El `redirect_url` lleva un código de UN SOLO USO que vence a los 60 segundos:
 * hay que redirigir al usuario apenas se recibe. NO cachear ni guardar el token.
 *
 * La contraseña es opcional (ya autenticamos al usuario en VIPCARGAS). Sólo se manda
 * si se quiere revalidar.
 *
 * @returns { success, redirectUrl, token } | { success:false, error, code }
 */
async function createSession(username, password = null) {
  const body = {};
  if (password) body.password = String(password);

  const r = await _request({
    method: 'post',
    path: `/players/${encodeURIComponent(String(username))}/session`,
    body,
    label: `session(${username})`,
    username,
    // No es idempotente, pero reintentar sólo emite otro código de un uso: es inocuo.
    retryable: true
  });

  if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };

  const redirectUrl = r.data && r.data.redirect_url;
  if (!redirectUrl) {
    logger.error(`[girox] session(${username}) — respuesta sin redirect_url: ${JSON.stringify(r.data).slice(0, 200)}`);
    return { success: false, error: 'La plataforma no devolvió el link de acceso.', code: 'no_redirect_url' };
  }
  return { success: true, redirectUrl, token: (r.data && r.data.token) || null };
}

// ============================================================
// PLATA — depósitos, retiros, bonos
// ============================================================
//
// `reference` es la LLAVE DE IDEMPOTENCIA: única por operación. Si se reintenta con
// la misma, 1girox NO duplica (devuelve duplicate:true con la operación original).
// REGLA DE ORO de la doc: ante timeout o error de red, reintentar SIEMPRE con la
// misma reference; nunca generar una nueva para el mismo depósito.
//
// Los call sites deben pasar una reference ESTABLE y persistida (ej. el id de la
// Transaction). Si no se pasa, se genera una acá — cubre los reintentos internos de
// esta llamada, pero NO protege si el usuario/agente reintenta la operación entera.

function _buildReference(prefix, explicit) {
  if (explicit) return String(explicit).slice(0, 100);
  const generated = `${prefix}-${uuidv4()}`;
  logger.warn(`[girox] operación SIN reference estable — se generó ${generated}. ` +
    'Pasar una reference persistida para tener idempotencia real entre requests.');
  return generated;
}

/**
 * Acredita saldo (carga). POST /players/{username}/deposit
 *
 * @param {string} username
 * @param {number} amount        en PESOS (no centavos)
 * @param {string} [description]
 * @param {string} [reference]   llave de idempotencia (RECOMENDADO: id de la Transaction)
 * @param {object} [wagering]    opcional, sólo si el feat "Rollover y Bonos" está activo:
 *                               { multiplier, bonusPercent, bonusAmount, bonusMultiplier }
 * @returns { success, duplicate, data:{ transfer_id, user_balance_after, ... } } | { success:false, error, code }
 */
async function depositToUser(username, amount, description = '', reference = null, wagering = null) {
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };

  const body = { amount: amt, reference: _buildReference('dep', reference) };
  if (description) body.description = String(description).slice(0, 500);

  if (wagering) {
    if (wagering.multiplier != null) body.multiplier = Number(wagering.multiplier);
    if (wagering.bonusPercent != null) body.bonus_percent = Number(wagering.bonusPercent);
    if (wagering.bonusAmount != null) body.bonus_amount = Number(wagering.bonusAmount);
    if (wagering.bonusMultiplier != null) body.bonus_multiplier = Number(wagering.bonusMultiplier);
  }

  let r = await _request({
    method: 'post',
    path: `/players/${encodeURIComponent(String(username))}/deposit`,
    body,
    label: `deposit(${username}, $${amt}, ref=${body.reference})`,
    username
  });

  // RED DE SEGURIDAD — auto-creación del jugador.
  // JUGAYGANA creaba la cuenta sola dentro del depósito, así que un usuario que
  // existía en VIPCARGAS pero no en la plataforma se arreglaba solo en la primera
  // carga. 1girox NO hace eso: devuelve `player_not_found` y la carga falla.
  // Sin esto, cualquier usuario que se haya creado sin llegar a la plataforma (alta
  // vieja, migración incompleta, caída momentánea de la API) queda imposible de
  // cargar, y el cliente transfirió la plata. Se crea al vuelo y se reintenta UNA vez
  // con la MISMA reference (así el reintento sigue siendo idempotente).
  if (!r.ok && r.code === 'player_not_found') {
    logger.warn(`[girox] deposit(${username}) — el jugador no existe en la plataforma; creándolo al vuelo`);
    // Contraseña random: acá no tenemos la del usuario. No lo deja afuera (al casino
    // se entra por SSO) y la real se sincroniza en su próximo login.
    const provisional = crypto.randomBytes(12).toString('base64url');
    const created = await createPlatformUser({ username, password: provisional });
    if (created.success || created.alreadyExists) {
      r = await _request({
        method: 'post',
        path: `/players/${encodeURIComponent(String(username))}/deposit`,
        body,
        label: `deposit-retry(${username}, $${amt}, ref=${body.reference})`,
        username
      });
    } else {
      logger.error(`[girox] deposit(${username}) — no se pudo crear al jugador: ${created.error}`);
    }
  }

  if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };

  _invalidatePlayer(username); // el saldo cambió → la próxima lectura debe ser fresca
  const out = _moneyResult(r.data);
  // Caso excepcional documentado: la carga se acreditó pero el bono no.
  const bonusStatus = r.data && r.data.wagering && r.data.wagering.bonus && r.data.wagering.bonus.status;
  if (bonusStatus === 'failed') {
    logger.error(`[girox] deposit(${username}) — la carga se acreditó pero el BONO falló (ref=${body.reference}). ` +
      'NO reintentar el depósito completo: la reference devolvería duplicate. Escalar a soporte de 1girox.');
    out.bonusFailed = true;
  }
  return out;
}

/**
 * Debita saldo (retiro). POST /players/{username}/withdraw
 * Errores de negocio esperables: insufficient_funds, rollover_locked (422).
 * @returns misma forma que depositToUser
 */
async function withdrawFromUser(username, amount, description = '', reference = null) {
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };

  const body = { amount: amt, reference: _buildReference('wd', reference) };
  if (description) body.description = String(description).slice(0, 500);

  const r = await _request({
    method: 'post',
    path: `/players/${encodeURIComponent(String(username))}/withdraw`,
    body,
    label: `withdraw(${username}, $${amt}, ref=${body.reference})`,
    username
  });

  if (!r.ok) {
    return {
      success: false,
      error: r.error,
      code: r.code,
      httpStatus: r.httpStatus,
      // El body de rollover_locked trae el desglose — útil para el mensaje al usuario.
      wagering: (r.body && r.body.wagering) || null
    };
  }
  _invalidatePlayer(username); // el saldo cambió → la próxima lectura debe ser fresca
  return _moneyResult(r.data);
}

/**
 * Acredita un bono / premio / reembolso (regalo: reembolsos, ruleta, rakeback, bono
 * de nivel VIP, comisiones de referidos, regalos de lote, código de bienvenida).
 *
 * DEFAULT (sin `opts.multiplier`) = REGALO DIRECTO por `POST /players/{u}/bonus` con
 * `multiplier: 0` (Partner API v1.10+, confirmado en el manual v1.15 §2.9/§2.12):
 *   - queda disponible/RETIRABLE al instante, SIN pasar por el reclamo (el bono 0
 *     "nunca pasa por el claim: se acredita directo");
 *   - NO pisa el bono en curso del jugador (a diferencia de un bono con rollover);
 *   - en el panel de 1girox figura como BONO (ledger `type: "bonus"`), no como Carga.
 * Antes (hasta 2026-09-07) esta rama iba por `/deposit` libre y TODOS los regalos
 * aparecían como "Carga" en el panel del agente, indistinguibles de las cargas reales
 * (reclamo del owner con captura: vip-rf-* y vip-roulette-* como "↑ Carga").
 *
 * 🪦 El comentario viejo decía "NO USAR /bonus: con multiplier 0 queda a reclamar
 * (v1.7)". Eso fue cierto sólo entre la 1.7 y la 1.10 (2026-07-31 → 2026-08-03).
 *
 * FALLBACK AUTOMÁTICO A DEPÓSITO LIBRE (misma reference — en un 422 la plataforma
 * NO mueve plata, así que reusar la reference es seguro): cuando el bono suelto no
 * está habilitado, el 0 no está entre `bonus.multipliers`, el monto queda fuera de
 * `fixed_min/fixed_max` (ej. un reembolso de $1 con fixed_min=2), o la plataforma
 * responde `feature_disabled` / `bonus_out_of_range` / validación 422. La plata
 * SIEMPRE llega; sólo cambia cómo figura en el panel. Errores transitorios (red,
 * 429, 5xx) NO caen al depósito: se devuelven para que el caller reintente con la
 * misma reference (un timeout puede haber acreditado del otro lado).
 *
 * Kill switch sin deploy: `GIROX_GIFT_AS_BONUS=0` → vuelve al depósito libre de antes.
 *
 * Con `opts.multiplier` explícito usa `/bonus` ESTRICTO (sin fallback): con >0 el
 * bono queda bloqueado hasta apostar amount × multiplier, con `claim_required` puede
 * quedar "a reclamar" (los callers hacen claimPendingBonus) y ⚠️ PISA un bono activo
 * previo; con 0 explícito es el mismo regalo directo pero un rechazo se devuelve
 * como error (botón Bonificación del panel, welcome code, lotes).
 *
 * @returns misma forma que depositToUser (+ `creditedAs: 'bonus'|'deposit'`)
 */
async function creditUserBalance(username, amount, reference = null, opts = {}) {
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };

  // Multiplier EXPLÍCITO (incluido 0): /bonus estricto, SIN fallback a depósito —
  // lo usan el botón Bonificación del panel, el welcome code cash y los lotes, donde
  // un bonus_out_of_range tiene que verse como error (no convertirse en carga).
  if (opts && opts.multiplier != null) {
    const body = {
      amount: amt,
      multiplier: Number(opts.multiplier),
      reference: _buildReference('bonus', reference)
    };
    // El endpoint /bonus no documenta `description`, pero se manda igual para que el
    // historial de la plataforma no quede sin contexto (un campo extra se ignora).
    if (opts.description) body.description = String(opts.description).slice(0, 500);
    const r = await _request({
      method: 'post',
      path: `/players/${encodeURIComponent(String(username))}/bonus`,
      body,
      label: `bonus(${username}, $${amt}, x${body.multiplier}, ref=${body.reference})`,
      username
    });
    if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
    // El estado del jugador cambió (bono nuevo): invalidar la lectura cacheada.
    _invalidatePlayer(username);
    const out = _moneyResult(r.data);
    out.creditedAs = 'bonus';
    return out;
  }

  // Regalo directo = bono 0 (default). La reference es la MISMA en las dos ramas.
  const ref = _buildReference('bonus', reference);
  const description = (opts && opts.description) || '';

  if (_giftAsBonusEnabled()) {
    const pre = await _giftPrecheck(amt);
    if (pre.ok) {
      const body = { amount: amt, multiplier: 0, reference: ref };
      if (description) body.description = String(description).slice(0, 500);
      const r = await _request({
        method: 'post',
        path: `/players/${encodeURIComponent(String(username))}/bonus`,
        body,
        label: `gift(${username}, $${amt}, ref=${ref})`,
        username
      });
      if (r.ok) {
        _invalidatePlayer(username);
        const out = _moneyResult(r.data);
        out.creditedAs = 'bonus';
        // Cinturón: si (contra lo documentado) el regalo quedara "a reclamar", se
        // reclama SÓLO ese requirement — nunca claim-all, para respetar la decisión
        // del owner de no auto-reclamar el regalito que el cliente ya tuviera.
        if (!out.duplicate) await _claimOwnGiftIfLocked(username, r.data);
        return out;
      }
      if (!_giftFallbackToDeposit(r)) {
        return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };
      }
      logger.warn(`[girox] gift(${username}, $${amt}) rechazado por la plataforma (${r.code}) — cae a depósito libre con la misma reference ${ref}`);
    } else {
      logger.info(`[girox] gift(${username}, $${amt}) va por depósito libre: ${pre.reason}`);
    }
  }

  // Depósito libre (fallback / kill switch)
  const out = await depositToUser(username, amt, description, ref);
  if (out && out.success) out.creditedAs = 'deposit';
  return out;
}

/** Kill switch: GIROX_GIFT_AS_BONUS=0|false|off → regalos por depósito libre (como antes). */
function _giftAsBonusEnabled() {
  const raw = String(process.env.GIROX_GIFT_AS_BONUS || '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/**
 * Chequeo previo contra GET /config (cacheado 10 min) para no gastar un request en un
 * /bonus que va a rebotar. Sin config disponible → se intenta igual (el 422 cae al
 * fallback). Devuelve { ok, reason }.
 */
async function _giftPrecheck(amt) {
  let cfg = null;
  try {
    const r = await getPlatformConfig();
    if (r.success) cfg = r.config || null;
  } catch (_) { /* sin config: se intenta */ }
  if (!cfg || !cfg.bonus) return { ok: true, reason: 'config no disponible' };
  const b = cfg.bonus;
  if (b.enabled === false) return { ok: false, reason: 'bonos deshabilitados en la plataforma' };
  if (b.standalone_enabled === false) return { ok: false, reason: 'bono suelto deshabilitado en la plataforma' };
  if (Array.isArray(b.multipliers) && b.multipliers.length && !b.multipliers.map(Number).includes(0)) {
    return { ok: false, reason: 'la plataforma no permite multiplier 0 en bonos' };
  }
  const min = Number(b.fixed_min) || 0;
  const max = Number(b.fixed_max) || 0;
  if (min > 0 && amt < min) return { ok: false, reason: `monto $${amt} menor al mínimo de bono fijo ($${min})` };
  if (max > 0 && amt > max) return { ok: false, reason: `monto $${amt} mayor al máximo de bono fijo ($${max})` };
  return { ok: true, reason: 'ok' };
}

/**
 * ¿Un fallo del /bonus 0 debe caer a depósito libre? Sólo los rechazos de NEGOCIO en
 * los que la plataforma NO movió plata (422 de feat/rango/validación) y el jugador
 * inexistente (404: depositToUser lo crea al vuelo). Nunca en errores transitorios.
 */
function _giftFallbackToDeposit(r) {
  if (!r) return false;
  if (r.code === 'feature_disabled' || r.code === 'bonus_out_of_range' || r.code === 'player_not_found') return true;
  return r.httpStatus === 422;
}

/**
 * Cinturón anti "regalo a reclamar": si la respuesta del bono 0 trae un
 * requirement_id que además aparece en `claimable`, se reclama ESE puntual.
 * Con la v1.10+ no debería pasar (bono 0 = directo); se deja por si la config del
 * sitio lo cambia. Fire-and-forget: nunca hace fallar el crédito (la plata ya entró).
 */
async function _claimOwnGiftIfLocked(username, data) {
  try {
    const w = data && data.wagering;
    const reqId = w && w.bonus && w.bonus.requirement_id;
    if (reqId == null) return;
    const bd = w.breakdown || {};
    const claimable = Array.isArray(bd.claimable) ? bd.claimable : (Array.isArray(w.claimable) ? w.claimable : []);
    if (!claimable.some((c) => c && Number(c.id) === Number(reqId))) return;
    logger.warn(`[girox] gift(${username}) quedó "a reclamar" (req=${reqId}) — se reclama ese requirement`);
    const c = await claimPendingBonus(username, reqId);
    if (!c.success) logger.warn(`[girox] gift(${username}) claim del req=${reqId} falló: ${c.error}`);
  } catch (e) {
    logger.warn(`[girox] gift(${username}) claim excepción: ${e.message}`);
  }
}

/** Resumen para la radiografía de boot: cómo se acreditan los regalos. */
function getGiftModeSummary() {
  return _giftAsBonusEnabled() ? 'bono 0 (regalo directo, fallback depósito)' : 'depósito libre (GIROX_GIFT_AS_BONUS=0)';
}

// ============================================================
// SALDO
// ============================================================

/**
 * @returns { success, balance, available, username, wagering } | { success:false, error, code }
 */
async function getUserBalance(username, opts = {}) {
  // opts.fresh se propaga a getUserInfoByName (decisiones de plata saltean cache).
  const info = await getUserInfoByName(username, opts);
  if (!info) {
    return { success: false, error: 'No se pudo leer el saldo en la plataforma.', code: 'player_not_found' };
  }
  return {
    success: true,
    username: info.username,
    balance: info.balance,
    // ⚠️ Para VALIDAR RETIROS hay que usar `available`, no `balance`: con el feat de
    // rollover activo (lo está), el jugador puede tener saldo que todavía no puede
    // retirar. Si se valida contra `balance`, la plataforma rechaza el retiro con
    // `rollover_locked` y queda un retiro colgado en el panel.
    available: info.available,
    locked: info.locked,
    bonusLocked: info.bonusLocked,
    claimableTotal: info.claimableTotal,
    wagering: info.wagering
  };
}

/**
 * Igual que getUserBalance pero con reintentos. Se conserva por compatibilidad con
 * los 8 call sites que lo usan; el backoff real ya vive en _request, así que acá los
 * intentos extra sólo cubren el caso "player_not_found transitorio".
 */
async function getUserBalanceWithRetry(username, { maxAttempts = 3, baseDelayMs = 500, fresh = false } = {}) {
  let last = null;
  for (let i = 1; i <= maxAttempts; i++) {
    last = await getUserBalance(username, { fresh });
    if (last.success) return last;
    if (i < maxAttempts) await _sleep(baseDelayMs * Math.pow(2, i - 1));
  }
  return { ...last, attemptsExhausted: true };
}

// ============================================================
// NO DISPONIBLE EN LA PARTNER API
// ============================================================

/**
 * Historial de movimientos por rango de fechas.
 * ❌ La Partner API NO expone este endpoint (lo usaba GET /api/movements contra
 * `ShowUserMovements` de JUGAYGANA). Queda explícito y falla claro en vez de
 * romper con un TypeError.
 */
async function getUserMovements() {
  return {
    success: false,
    error: 'El historial de movimientos no está disponible en la plataforma nueva.',
    code: 'not_supported'
  };
}

// ============================================================
// NETWIN (GGR) — la pérdida real del jugador
// ============================================================
//
// Partner API v1.8. Es la base de los REEMBOLSOS y de las COMISIONES DE REFERIDOS.
//
// ⚠️ SIGNO: `netwin` POSITIVO significa que ganó la casa, o sea que el jugador PERDIÓ
// — que es justo lo que se reembolsa. Negativo = el jugador ganó en el período y no
// hay nada que devolver.
//
// El rango se evalúa en HORARIO DE ARGENTINA del lado de la plataforma, así que
// cortar a la medianoche argentina sale natural y no hay que compensar husos.
//
// Antes esto se sacaba del panel de administración (giroxReportsService, con un
// Bearer de sesión y el ID numérico del jugador). Con este endpoint eso ya no hace
// falta: va por username y con la misma API key que el resto.

/** Máximo que acepta la API por consulta (invalid_range si se pasa). */
const STATS_MAX_DAYS = 92;

/**
 * Formatea una Date al formato que espera la API ("YYYY-MM-DD HH:mm:ss") en hora de
 * ARGENTINA, que es el huso en el que la plataforma evalúa el rango.
 */
function formatStatsDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const opts = { timeZone: 'America/Argentina/Buenos_Aires' };
  return `${d.toLocaleDateString('en-CA', opts)} ${d.toLocaleTimeString('en-GB', { ...opts, hour12: false })}`;
}

/** Normaliza el bloque de totales que devuelve la API. */
function _statsTotals(t) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    betsCount: n(t && t.bets_count),
    wagered: n(t && t.wagered),
    payout: n(t && t.payout),
    netwin: n(t && t.netwin)
  };
}

/**
 * Netwin de UN jugador en un rango. GET /players/{username}/stats
 *
 * @param {string} username
 * @param {Date} fromDate
 * @param {Date} toDate
 * @param {string} [label] etiqueta para logs
 * @returns {{success, netwin, casinoNetwin, sportsNetwin, wagered, payout, betsCount,
 *            playerId, from, to}} | {success:false, error, code}
 */
async function getPlayerStats(username, fromDate, toDate, label = 'stats', opts = {}) {
  const from = formatStatsDate(fromDate);
  const to = formatStatsDate(toDate);
  if (!from || !to) {
    return { success: false, error: 'Rango de fechas inválido', code: 'invalid_range' };
  }
  // Se corta antes de llamar: la API rechaza rangos de más de 92 días y el error
  // llegaría igual, pero así no se gasta una request del cupo de 60/min.
  const days = Math.abs(new Date(toDate) - new Date(fromDate)) / 86400000;
  if (days > STATS_MAX_DAYS) {
    return { success: false, error: `El rango no puede superar los ${STATS_MAX_DAYS} días.`, code: 'invalid_range' };
  }

  // Cache corto por (usuario, rango): el status de reembolso consulta esto muy
  // seguido (weekly+monthly por usuario) y para jugadores de publicista va por
  // la única key de ese publicista (30/min) → era el top de saturación (logs
  // 2026-08-18). El rango del status es un período ya cerrado → el netwin es
  // estable, cachear es seguro. La RECLAMACIÓN (plata) pasa {fresh:true}.
  const _statsKey = String(username).toLowerCase() + '|' + from + '|' + to;
  if (!(opts && opts.fresh)) {
    const _c = _statsCache.get(_statsKey);
    if (_c && (Date.now() - _c.ts) < STATS_CACHE_TTL_MS) return _c.data;
  }

  const r = await _request({
    method: 'get',
    path: `/players/${encodeURIComponent(String(username))}/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    label: `${label}(${username}, ${from} → ${to})`,
    username,
    readOnly: true
  });

  if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };

  const d = r.data || {};
  const totals = _statsTotals(d.totals);
  const cats = d.categories || {};
  const casino = _statsTotals(cats.casino);
  const sports = _statsTotals(cats.sports);

  const out = {
    success: true,
    playerId: d.player && d.player.id != null ? Number(d.player.id) : null,
    username: (d.player && d.player.username) || String(username),
    from: d.from || from,
    to: d.to || to,
    netwin: totals.netwin,
    casinoNetwin: casino.netwin,
    sportsNetwin: sports.netwin,
    wagered: totals.wagered,
    payout: totals.payout,
    betsCount: totals.betsCount,
    categories: { casino, sports }
  };
  _statsCache.set(_statsKey, { data: out, ts: Date.now() }); // solo se cachea el éxito
  return out;
}

/**
 * Netwin de VARIOS jugadores de una. POST /players/stats/batch (hasta 100).
 *
 * Es lo que hace viable el cálculo de comisiones de referidos: con el límite de 60
 * requests/minuto, consultar de a uno no alcanza cuando hay decenas de referidos.
 *
 * @param {string[]} usernames  1 a 100
 * @returns {{success, players:{[username]: stats}, notFound:string[]}} | {success:false,...}
 */
async function getPlayersStatsBatch(usernames, fromDate, toDate, label = 'stats-batch') {
  const list = (Array.isArray(usernames) ? usernames : []).map((u) => String(u).trim()).filter(Boolean);
  if (list.length === 0) return { success: true, players: {}, notFound: [] };
  if (list.length > 100) {
    return { success: false, error: 'El batch acepta hasta 100 usuarios por request.', code: 'too_many' };
  }

  const from = formatStatsDate(fromDate);
  const to = formatStatsDate(toDate);
  if (!from || !to) return { success: false, error: 'Rango de fechas inválido', code: 'invalid_range' };

  // RUTEO POR DUEÑO (fix 2026-08-05): el batch puede mezclar jugadores de la
  // master y de varios publicistas, y cada key SOLO ve a los suyos — un batch
  // único con la master devolvía a los de publicista como not_found (y sus
  // reembolsos/VIP/referidos quedaban en $0). Se agrupa por key resuelta y se
  // hace UN request por grupo; sin resolver, un solo grupo con la master.
  const groups = new Map(); // keyOverride (null = master) → usernames
  for (const u of list) {
    const k = await _resolveKeyFor(u);
    const gk = k || '';
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(u);
  }

  const players = {};
  const notFound = [];
  for (const [gk, groupList] of groups) {
    const r = await _request({
      method: 'post',
      path: '/players/stats/batch',
      body: { usernames: groupList, from, to },
      label: `${label}(${groupList.length} jugadores${gk ? ', key publicista' : ''}, ${from} → ${to})`,
      apiKey: gk || null,
      readOnly: true
    });

    // Si UN grupo falla, falla todo el batch (mismo contrato de antes: el caller
    // trata el fallo como "sin datos" y no paga de más).
    if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };

    const d = r.data || {};
    for (const p of (Array.isArray(d.players) ? d.players : [])) {
      const totals = _statsTotals(p.totals);
      const cats = p.categories || {};
      const casino = _statsTotals(cats.casino);
      const sports = _statsTotals(cats.sports);
      players[String(p.username)] = {
        success: true,
        playerId: p.id != null ? Number(p.id) : null,
        username: p.username,
        netwin: totals.netwin,
        casinoNetwin: casino.netwin,
        sportsNetwin: sports.netwin,
        wagered: totals.wagered,
        payout: totals.payout,
        betsCount: totals.betsCount,
        categories: { casino, sports }
      };
    }
    // ⚠️ `not_found` mezcla "no existe" con "no es tuyo" a propósito (lo aclara el
    // manual): no se puede distinguir, así que se trata igual — sin netwin.
    for (const nf of (Array.isArray(d.not_found) ? d.not_found : [])) notFound.push(nf);
  }

  return { success: true, players, notFound, from, to };
}

/**
 * Configuración del sitio. GET /config (Partner API v1.9)
 *
 * Dice qué feats están habilitados, qué multiplicadores son válidos y los límites
 * min/max del bono de monto fijo. Sirve para validar ANTES de mandar una operación
 * en vez de comerse un 422.
 *
 * Se cachea en memoria: cambia sólo cuando el operador toca la configuración, y
 * consultarlo en cada carga desperdiciaría el cupo de 60 req/min.
 */
let _configCache = null;
let _configCachedAt = 0;
const CONFIG_TTL_MS = 10 * 60 * 1000;

async function getPlatformConfig({ force = false } = {}) {
  if (!force && _configCache && (Date.now() - _configCachedAt) < CONFIG_TTL_MS) {
    return { success: true, config: _configCache, cached: true };
  }
  const r = await _request({ method: 'get', path: '/config', label: 'config' });
  if (!r.ok) return { success: false, error: r.error, code: r.code };
  _configCache = r.data || {};
  _configCachedAt = Date.now();
  return { success: true, config: _configCache, cached: false };
}

/**
 * Reclama los bonos que el jugador tiene pendientes. POST /players/{username}/bonus/claim
 *
 * Desde la v1.7 un bono que cumple su objetivo (o que se otorgó sin rollover) NO se
 * libera solo: queda bloqueado hasta que alguien lo reclama. En el casino lo reclama
 * el jugador tocando el regalito del header — pero nuestros jugadores operan desde
 * VIPCARGAS y muchos no entran nunca a la plataforma, así que lo reclamamos nosotros.
 *
 * Es idempotente: si no quedaba nada devuelve `amount: 0`, no es un error.
 * No mueve plata nueva — destraba lo que el jugador ya tenía (pasa a retirable).
 *
 * @param {string} username
 * @param {number} [requirementId] reclamar UNO puntual; sin esto se reclaman TODOS
 */
async function claimPendingBonus(username, requirementId = null) {
  const body = {};
  if (requirementId != null) body.requirement_id = Number(requirementId);

  const r = await _request({
    method: 'post',
    path: `/players/${encodeURIComponent(String(username))}/bonus/claim`,
    body,
    label: `bonusClaim(${username}${requirementId != null ? ', req=' + requirementId : ''})`,
    username
  });

  if (!r.ok) return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus };

  _invalidatePlayer(username); // reclamar el bono cambia el saldo → próxima lectura fresca
  const d = r.data || {};
  return {
    success: true,
    amount: Number(d.amount) || 0,
    claimed: Array.isArray(d.claimed) ? d.claimed : [],
    wagering: d.wagering || null
  };
}

module.exports = {
  // config
  isEnabled,
  getPlayUrl,
  getBaseUrl,
  validateUsername,
  // diagnóstico: cuántas keys de consultas cargó (log de arranque en server.js)
  getReadsKeysCount: function () { return getReadsKeys().length; },
  // ídem con el techo local de cada una, ej. "2 (techos 90, 30/min)"
  getReadsKeysSummary: function () {
    const c = _readsKeyConfigs();
    if (c.length === 0) return '0';
    return `${c.length} (techos ${c.map((x) => x.rpm).join(', ')}/min)`;
  },
  // overrides de rpm por key de publicista (para el log de arranque)
  getPublisherKeyOverridesCount: function () { return _publisherKeyConfigs().length; },
  // ruteo por dueño del jugador (server.js inyecta el resolver username→apiKey)
  setKeyResolver,
  // jugadores
  createPlatformUser,
  getUserInfoByName,
  checkUserExists,
  readPlayerWithKey,
  ping,
  syncUserToPlatform,
  validateCredentials,
  changeUserPassword,
  // SSO
  createSession,
  // plata
  depositToUser,
  withdrawFromUser,
  creditUserBalance,
  // saldo
  getUserBalance,
  getUserBalanceWithRetry,
  // netwin / estadísticas
  getPlayerStats,
  getPlayersStatsBatch,
  formatStatsDate,
  // configuración del sitio
  getPlatformConfig,
  // bonos pendientes de reclamar
  claimPendingBonus,
  getGiftModeSummary,
  // no soportado
  getUserMovements
};
