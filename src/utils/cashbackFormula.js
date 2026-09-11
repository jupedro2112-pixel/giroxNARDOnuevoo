/**
 * cashbackFormula.js — la FÓRMULA del reembolso acumulativo de por vida, PURA.
 *
 * Implementa la §3 de docs/ESPEC-REEMBOLSO-1GIROX.md sin tocar Mongo ni la
 * Partner API: server.js (`_cashbackStateToday`) le pasa los números y esto
 * devuelve el reclamable. Al estar separada se puede validar con la tabla de
 * casos de la §7 (scripts/test-cashback-spec.js) con `node` pelado, sin
 * node_modules — que es todo lo que hay en Tails.
 *
 *   netoDePorVida = carryNet + liveNet          (§3.4: tramos plegados + tramo vivo)
 *   regalado      = max(localViejo, grantedViejo) + max(localVivo, grantedVivo)   (§3.3)
 *   pérdidaReal   = max(0, netoDePorVida − regalado)
 *   reclamable    = floor(pct% × pérdidaReal − cobrado)
 *   reclamable    = min(reclamable, topeDiario − cobradoHoy)
 *   si reclamable < mínimo → no se puede reclamar todavía
 *
 * ⚠️ netwin POSITIVO = el jugador PERDIÓ. Todo en PESOS (sin ×100).
 */

/** Primer día con stats en 1girox (la migración desde JUGAYGANA). No hay datos antes. */
const STATS_EPOCH = new Date('2026-07-31T00:00:00-03:00');
/** Cuando el tramo vivo supera esto (< 92, tope de la API, con margen) se pliega. */
const FOLD_AFTER_DAYS = 85;
/** Cuánto se consolida por plegado. */
const FOLD_CHUNK_DAYS = 60;
const DAY_MS = 86400000;

/**
 * Ancla inicial de un jugador: su alta, pero nunca antes del arranque en 1girox.
 * @param {Date|string|null} createdAt
 * @param {Date} [epoch]
 */
function initialAnchor(createdAt, epoch = STATS_EPOCH) {
  const c = createdAt ? new Date(createdAt).getTime() : epoch.getTime();
  return new Date(Math.max(Number.isFinite(c) ? c : epoch.getTime(), epoch.getTime()));
}

/** ¿El tramo vivo [anchor, today] ya supera el umbral de plegado? */
function needsFold(anchor, today, afterDays = FOLD_AFTER_DAYS) {
  return (today.getTime() - anchor.getTime()) / DAY_MS > afterDays;
}

/**
 * Tramo a consolidar en un plegado: [anchor, anchor+60d − 1d] y la ancla nueva
 * (anchor+60d). El tramo termina el día ANTERIOR a la ancla nueva para que el
 * tramo vivo siguiente no se solape con él (la API cuenta ambos extremos).
 */
function foldChunk(anchor, chunkDays = FOLD_CHUNK_DAYS) {
  const next = new Date(anchor.getTime() + chunkDays * DAY_MS);
  return { from: new Date(anchor.getTime()), to: new Date(next.getTime() - DAY_MS), next };
}

/**
 * Plan de plegado completo para llegar a un tramo vivo ≤ umbral (varios chunks
 * si el jugador estuvo mucho tiempo sin evaluarse). Sólo calcula fechas.
 * @returns {{chunks: Array<{from,to,next}>, anchor: Date}}
 */
function foldPlan(anchor, today, opts = {}) {
  const after = opts.afterDays || FOLD_AFTER_DAYS;
  const chunk = opts.chunkDays || FOLD_CHUNK_DAYS;
  const maxChunks = opts.maxChunks || 4;
  const chunks = [];
  let a = new Date(anchor.getTime());
  while (needsFold(a, today, after) && chunks.length < maxChunks) {
    const c = foldChunk(a, chunk);
    chunks.push(c);
    a = c.next;
  }
  return { chunks, anchor: a };
}

/**
 * `regalado` (§3.3): fuente local y oficial comparadas TRAMO A TRAMO, se toma
 * el mayor de cada tramo. Nunca se reembolsa un regalo que alguno de los dos vio.
 */
function giftedLife({ localBefore = 0, localLive = 0, carryGranted = 0, liveGranted = 0 }) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return Math.max(n(localBefore), n(carryGranted)) + Math.max(n(localLive), n(liveGranted));
}

/**
 * Reclamable de por vida (§3).
 * @param {object} p
 * @param {number} p.pct           % del reembolso (ej. 5)
 * @param {number} p.carryNet      netwin de casino consolidado (tramos plegados; puede ser negativo)
 * @param {number} p.liveNet       netwin de casino del tramo vivo (ancla → hoy)
 * @param {number} p.giftedLife    regalado (salida de giftedLife())
 * @param {number} p.paidLife      Σ reembolsos acumulativos ya pagados (pending + credited)
 * @param {number} p.paidToday     Σ de esos pagados HOY (para el tope diario)
 * @param {number} [p.maxDailyArs] tope por día por jugador (0 = sin tope)
 * @param {number} [p.minArs]      mínimo para poder reclamar (0 = sin mínimo)
 */
function computeReclamable(p) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pct = n(p.pct);
  const lifeNet = n(p.carryNet) + n(p.liveNet);
  const gifted = n(p.giftedLife);
  const lossLife = Math.max(0, lifeNet - gifted);
  const paidLife = n(p.paidLife);
  const paidToday = n(p.paidToday);
  const maxDaily = n(p.maxDailyArs);
  const minArs = n(p.minArs);

  let reclamable = Math.floor(Math.max(0, (pct / 100) * lossLife - paidLife));
  if (maxDaily > 0) reclamable = Math.min(reclamable, Math.max(0, maxDaily - paidToday));
  const belowMin = reclamable > 0 && reclamable < minArs;
  return { lifeNet, lossLife, reclamable, belowMin, faltaParaMinimo: belowMin ? minArs - reclamable : 0 };
}

module.exports = {
  STATS_EPOCH,
  FOLD_AFTER_DAYS,
  FOLD_CHUNK_DAYS,
  initialAnchor,
  needsFold,
  foldChunk,
  foldPlan,
  giftedLife,
  computeReclamable
};
