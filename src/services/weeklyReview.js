'use strict';
// #973 (owner 2026-10-24): REVISIÓN SEMANAL AUTOMÁTICA — "armá un sistema de medición semanal para reajustar si es necesario viendo la
// retención y todo lo que necesites ver; si ves todo bien dejás todo como está, si no impulsás todo; que sea todo automático y con reportes".
// Reglas puras: reciben las métricas de la semana (las arma server.js `_weeklyMetrics`) y el ajuste vigente, y devuelven la decisión:
// subir / mantener / bajar un escalón los regalos del recorrido (y el % extra de la campaña masiva), con las razones y recomendaciones.
// El escalón (`level`, de −2 a +3) se traduce en multiplicadores: % de bono ×(1 + 0,1·nivel) y fichas ×(1 + 0,25·nivel).
const LEVEL_MIN = -2, LEVEL_MAX = 3;
const GIFT_OK = 0.15, GIFT_RED = 0.20;      // regalado / depositado de la semana: sano hasta 15 %, rojo más de 20 %
const DROP = 0.03;                           // caída de "volvieron" semana a semana que dispara el impulso
const MIN_TARGETS = 30;                      // contactados mínimos para juzgar una conversión

function clamp(l) { return Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(Number(l) || 0))); }
function tuningFor(level) { const l = clamp(level); return { level: l, pctMult: Math.round((1 + 0.1 * l) * 100) / 100, chipsMult: Math.max(0.5, Math.round((1 + 0.25 * l) * 100) / 100), apPctPlus: l > 0 ? 10 * l : l < 0 ? 5 * l : 0 }; }
const pct = (v, d) => (v == null || !Number.isFinite(v)) ? '—' : (Math.round(v * 1000) / 10).toLocaleString('es-AR') + ' %';
const rate = (o) => o && o.targets >= MIN_TARGETS ? o.converted / o.targets : null;

// m: ver _weeklyMetrics (server.js). cur: ajuste vigente { level }.
function decide(m, cur) {
  const level0 = cur && Number.isFinite(Number(cur.level)) ? clamp(cur.level) : 0;
  let level = level0; const reasons = [], recs = [];
  const g = m.giftRatio, rep = m.repeatRate, prev = m.prevRepeatRate;
  const jr = rate(m.journey), cr = rate(m.campaigns);
  const dropped = rep != null && prev != null && rep < prev - DROP;
  if (g != null && g > GIFT_RED) {
    level = level0 - 1;
    reasons.push(`Regalamos ${pct(g)} de lo depositado esta semana (sano hasta ${pct(GIFT_OK)}, rojo más de ${pct(GIFT_RED)}): bajo un escalón los regalos.`);
  } else if ((g == null || g <= GIFT_OK) && (dropped || (jr != null && jr < 0.05))) {
    level = level0 + 1;
    if (dropped) reasons.push(`Los que habían cargado la semana anterior volvieron menos (${pct(prev)} → ${pct(rep)}) y hay margen de regalos (${g == null ? 'sin cierres' : pct(g)}): subo un escalón.`);
    if (jr != null && jr < 0.05) reasons.push(`El recorrido recuperó sólo ${pct(jr)} de los contactados (${m.journey.converted} de ${m.journey.targets}): subo un escalón.`);
  } else {
    if (g != null && g > GIFT_OK) reasons.push(`Regalos en zona amarilla (${pct(g)}): mantengo sin subir.`);
    else reasons.push(`Todo dentro de lo esperado (regalos ${g == null ? 'sin cierres' : pct(g)}, volvieron ${pct(rep)}${prev != null ? ' vs ' + pct(prev) : ''}): mantengo.`);
  }
  level = clamp(level);
  if (level === level0 && level0 !== 0 && reasons.length === 1 && /mantengo/.test(reasons[0]) && g != null && g <= GIFT_OK && !dropped && jr != null && jr >= 0.08) {
    // Si subimos antes y ya se recuperó, volvemos un escalón hacia el centro para no regalar de más de forma permanente.
    if (level0 > 0) { level = level0 - 1; reasons.push('El impulso anterior ya hizo efecto: vuelvo un escalón hacia lo normal.'); }
  }
  // Recomendaciones (no automáticas): dónde está el problema de fondo.
  if (m.cohortM1 != null && m.cohortM1 < 0.25) recs.push(`Sólo ${pct(m.cohortM1)} de los que se registraron el mes pasado cargaron este mes: el problema está después de la primera carga (2ª carga, soporte), no en la pauta.`);
  if (m.app && m.app.appPct != null && m.app.appPct < 0.5) recs.push(`Sólo ${pct(m.app.appPct)} de los que cargaron en 30 días tiene la app instalada: el 50 % por instalar no alcanza; conviene pedir la instalación también al registrarse.`);
  if (m.prefs && m.prefs.optOutPct > 0.10) recs.push(`Más del 10 % bajó sus avisos desde el Perfil (${pct(m.prefs.optOutPct)}): hay cansancio; bajar la campaña masiva a 3 por semana.`);
  if (cr != null && cr < 0.03) recs.push(`La campaña masiva convierte ${pct(cr)} en 48 h (menos del 3 %): cambiar textos u horario, o bajar frecuencia.`);
  if (m.firstDeposits != null && m.newRegs >= 20 && m.firstDeposits / m.newRegs < 0.3) recs.push(`De ${m.newRegs} registrados en la semana sólo ${m.firstDeposits} hicieron la primera carga (${pct(m.firstDeposits / m.newRegs)}): revisar el camino registro → primera carga.`);
  // Acá no hay reembolso diario por rango: se mira el SEMANAL (el que el Centro de avisos recuerda lunes y jueves).
  if (m.refunds && m.refunds.weekly && m.deposits && m.deposits.users && m.refunds.weekly.n / m.deposits.users < 0.2) recs.push(`Pocos reclaman el reembolso semanal (${m.refunds.weekly.n} reclamos vs ${m.deposits.users} cargadores): el aviso del reembolso tiene que seguir y conviene mostrarlo más adentro de la app.`);
  const verdict = level > level0 ? 'impulsar' : level < level0 ? 'frenar' : 'mantener';
  return { level, prevLevel: level0, changed: level !== level0, tuning: tuningFor(level), verdict, reasons, recommendations: recs };
}

// Informe en texto plano (para copiar y analizar afuera).
function reportText(rep) {
  if (!rep || !rep.metrics) return 'Todavía no hay revisión semanal.';
  const m = rep.metrics, d = rep.decision || {}; const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const L = [];
  L.push(`REVISIÓN SEMANAL CARGAS 1GIROX · semana ${m.week.from} → ${m.week.to} · generada ${rep.at}`);
  L.push(`DECISIÓN: ${String(d.verdict || '').toUpperCase()} · nivel ${d.prevLevel} → ${d.level} (bonos ×${rep.tuning.pctMult}, fichas ×${rep.tuning.chipsMult}, campaña masiva ${rep.tuning.apPctPlus >= 0 ? '+' : ''}${rep.tuning.apPctPlus} pts)`);
  (d.reasons || []).forEach((r) => L.push('  · ' + r));
  L.push('');
  L.push(`Cargadores de la semana: ${m.deposits.users} (${m.deposits.count} cargas, ${money(m.deposits.amount)}) · semana anterior: ${m.deposits.prevUsers}`);
  L.push(`Volvieron (cargaron la semana anterior y también ésta): ${pct(m.repeatRate)} · la semana previa: ${pct(m.prevRepeatRate)}`);
  L.push(`Regalado / depositado (${m.gifts.days} días, de las transacciones): ${pct(m.giftRatio)} (${money(m.gifts.regalos)} de ${money(m.gifts.depositos)})`);
  L.push(`Registrados: ${m.newRegs} · primeras cargas: ${m.firstDeposits} · clientes totales: ${m.totalUsers}`);
  L.push(`App instalada entre los que cargaron en 30 días: ${pct(m.app && m.app.appPct)} (${m.app && m.app.withApp} de ${m.app && m.app.depositors30})`);
  L.push(`Avisos: sólo lo mío ${m.prefs.mine} · ninguno ${m.prefs.none} · pausados por fatiga ${m.prefs.fatigued}`);
  L.push(`Recorrido (lotes de hace 7–14 d, carga en 7 d): ${m.journey.converted} de ${m.journey.targets} (${pct(rate(m.journey))})`);
  Object.keys(m.journey.steps || {}).forEach((k) => { const s = m.journey.steps[k]; L.push(`  · ${k}: ${s.converted}/${s.targets} (${s.targets ? pct(s.converted / s.targets) : '—'})`); });
  L.push(`Campaña masiva (carga en 48 h): ${m.campaigns.converted} de ${m.campaigns.targets} (${pct(rate(m.campaigns))})`);
  L.push(`Reembolsos reclamados: ` + (Object.keys(m.refunds || {}).length ? Object.keys(m.refunds).map((k) => `${k} ${m.refunds[k].n} (${money(m.refunds[k].amount)})`).join(' · ') : 'ninguno'));
  if (m.segments) L.push('Segmentos hoy: ' + Object.keys(m.segments).map((k) => `${k} ${m.segments[k]}`).join(' · '));
  if (Array.isArray(m.cohorts) && m.cohorts.length) { L.push('Cohortes (mes de registro: registrados / cargaron / M0 / M+1 / M+2 / M+3):'); m.cohorts.forEach((c) => L.push(`  · ${c.month}: ${c.regs} / ${c.depositors} / ${(c.m || []).map((v) => v == null ? '—' : v).join(' / ')}`)); }
  if ((d.recommendations || []).length) { L.push(''); L.push('RECOMENDACIONES:'); d.recommendations.forEach((r) => L.push('  · ' + r)); }
  return L.join('\n');
}

module.exports = { LEVEL_MIN, LEVEL_MAX, GIFT_OK, GIFT_RED, tuningFor, decide, reportText };
