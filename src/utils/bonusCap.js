/**
 * bonusCap.js — TOPE de los bonos AUTOMÁTICOS en % sobre una carga (owner
 * 2026-09-18): el % del bono aplica sólo hasta `capArs` de la carga; sobre lo
 * que cargue de más va `restPct`. Ej. bono 50%, tope $20.000, resto 20%:
 *   carga $10.000 → $5.000            (50% de todo: no pasa el tope)
 *   carga $20.000 → $10.000           (50% de 20.000)
 *   carga $50.000 → $10.000 + $6.000 = $16.000 (50% de 20.000 + 20% de 30.000)
 * Si el % del bono es menor o igual al % del resto, no hay nada que topear
 * (un 20% sigue siendo 20% de todo). Pura: sin Mongo, testeable con node pelado.
 */
const DEFAULT = { enabled: true, capArs: 20000, restPct: 20 };

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT };
  const capArs = Math.max(0, Math.round(Number(raw.capArs)));
  const restPct = Number(raw.restPct);
  return {
    enabled: raw.enabled !== false,
    capArs: Number.isFinite(capArs) && capArs > 0 ? capArs : DEFAULT.capArs,
    restPct: Number.isFinite(restPct) ? Math.max(0, Math.min(100, Math.round(restPct))) : DEFAULT.restPct
  };
}

/** Monto del bono para una carga `amount` con `pct`% y la config del tope. */
function bonusWithCap(amount, pct, cfg) {
  const a = Math.max(0, Number(amount) || 0);
  const p = Math.max(0, Number(pct) || 0);
  const c = normalizeConfig(cfg);
  if (c.enabled && p > c.restPct && c.capArs > 0 && a > c.capArs) {
    return Math.round(c.capArs * p / 100 + (a - c.capArs) * c.restPct / 100);
  }
  return Math.round(a * p / 100);
}

/** Texto corto de la regla para notas/mensajes: "50% hasta $20.000 y 20% sobre el resto". */
function describeRule(pct, cfg) {
  const c = normalizeConfig(cfg);
  const p = Number(pct) || 0;
  const money = (n) => '$' + Math.round(n).toLocaleString('es-AR');
  if (!c.enabled || p <= c.restPct) return `${p}% de la carga`;
  return `${p}% hasta ${money(c.capArs)} de la carga y ${c.restPct}% sobre lo que pase de ahí`;
}

module.exports = { DEFAULT, normalizeConfig, bonusWithCap, describeRule };
