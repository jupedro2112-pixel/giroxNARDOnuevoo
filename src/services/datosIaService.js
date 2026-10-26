// #459/#461/#477 (owner 2026-10-18): DATOS IA — análisis del negocio a partir de los datos recolectados (sin IA externa).
// Capas: (1) datos por AGREGACIONES de Mongo (todo agrupado por día/usuario en la base: nunca se bajan movimientos
// sueltos → #477 pasó de ~34 s a pocos segundos en 90 días y no infla la memoria del server), (2) métricas,
// (3) informe por reglas, (4) comparativa con "la otra página", (5) calculador de inversión ("panorama") con
// promociones vigentes/futuras y calibración (factor real/proyectado de revisiones anteriores).
// Hora argentina (UTC−3 fijo) para todos los cortes. Moneda: pesos; si se pasa `usdRate` + `cur:'usd'` los textos
// del informe salen en USDT.
'use strict';
const GIFT_SOURCES = ['install_bonus', 'welcome_gift', 'payout_refund'];
// #469: lo que la casa REGALA (todo lo que no es carga ni retiro)
const PROMO_TYPES = ['bonus', 'refund', 'roulette', 'fire_reward', 'rakeback', 'vip_levelup', 'install_gift', 'referral_commission', 'mission'];
const PROMO_LABEL = { bonus: 'bonos de carga', refund: 'reembolsos', roulette: 'ruleta', fire_reward: 'fueguito', rakeback: 'rakeback', vip_levelup: 'nivel VIP', install_gift: 'extra por instalar', referral_commission: 'referidos', mission: 'misiones' };
const DAY = 86400000;
const TZ = '-03:00';

// #463: Argentina es UTC−3 fijo (sin horario de verano): se calcula por desplazamiento.
function dateKeyART(d) { const t = (d instanceof Date ? d.getTime() : new Date(d).getTime()) - 3 * 3600000; return new Date(t).toISOString().slice(0, 10); }
function bucketOfKey(k, gran) {
  if (gran === 'month') return k.slice(0, 7);
  if (gran === 'week') { const [y, m, dd] = k.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return dt.toISOString().slice(0, 10); }
  return k;
}
function bucketOf(d, gran) { return bucketOfKey(dateKeyART(d), gran); }
function listBuckets(from, to, gran) { const out = [], seen = new Set(); for (let t = from.getTime(); t <= to.getTime() + DAY; t += DAY) { const b = bucketOf(new Date(Math.min(t, to.getTime())), gran); if (!seen.has(b)) { seen.add(b); out.push(b); } } return out; }
// Misma agrupación pero calculada DENTRO de Mongo (hora argentina), para que los usuarios distintos por período sean exactos.
function bucketExpr(field, gran) {
  if (gran === 'month') return { $dateToString: { format: '%Y-%m', date: field, timezone: TZ } };
  if (gran === 'week') return { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday', timezone: TZ } }, timezone: TZ } };
  return { $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } };
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Formateador de plata: pesos, o USDT si `cur:'usd'` y hay cotización.
function fmt(opts) {
  const rate = Number(opts && opts.usdRate) > 0 ? Number(opts.usdRate) : 0, usd = !!(opts && opts.cur === 'usd' && rate);
  const money = (n) => (usd ? 'US$ ' + Math.round((Number(n) || 0) / rate).toLocaleString('es-AR') : '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'));
  return { money, usd, rate };
}

const _cache = new Map(); // key → { at, value } (5 min; multi-instancia: cada proceso tiene la suya)
async function analyze(models, opts) {
  const key = JSON.stringify([dateKeyART(opts.from), dateKeyART(opts.to), opts.granularity, opts.campaign, opts.spend, opts.cur, opts.usdRate]); // #486: clave por día → la caché pega
  const c = _cache.get(key); if (c && Date.now() - c.at < 300000) return c.value;
  const value = await _analyze(models, opts);
  _cache.set(key, { at: Date.now(), value }); if (_cache.size > 40) _cache.delete(_cache.keys().next().value);
  return value;
}

async function _analyze(models, opts) {
  const { Transaction, User, RefundClaim, DailyRouletteSpin, Message, AppSession } = models;
  // #486: el rango se corta por DÍA ARGENTINO (00:00 → 23:59:59 ART) aunque venga con hora: entre 21 y 24 h la fecha UTC ya es mañana.
  const from = new Date(dateKeyART(opts.from) + 'T03:00:00.000Z');
  const to = new Date(new Date(dateKeyART(opts.to) + 'T03:00:00.000Z').getTime() + DAY - 1);
  const gran = ['day', 'week', 'month'].includes(opts.granularity) ? opts.granularity : 'day';
  const campaign = String(opts.campaign || '').toUpperCase().trim();
  const spend = Number(opts.spend) || 0;
  const spendByDay = opts.spendByDay || {};
  const days = Math.max(1, Math.round((to - from) / DAY));
  const now = new Date();
  const F = fmt(opts);
  const T = {}; let _tk = Date.now(); const lap = (k) => { T[k] = Date.now() - _tk; _tk = Date.now(); };

  // Alcance por campaña → ids
  const userFilter = { role: 'user' }; if (campaign) userFilter.acquisitionCampaign = campaign;
  let scopeIds = null;
  if (campaign) scopeIds = (await User.find(userFilter).select('id').lean()).map((u) => u.id);
  const scope = (q) => (scopeIds ? { ...q, userId: { $in: scopeIds } } : q);
  const okStatus = { $nin: ['failed', 'cancelled'] };
  const realDep = scope({ type: 'deposit', status: okStatus, 'metadata.source': { $nin: GIFT_SOURCES } });
  const realWd = scope({ type: 'withdrawal', status: okStatus });
  const inRange = { timestamp: { $gte: from, $lte: to } };

  // (1) Por usuario, todo el histórico de cargas reales: primera, última, cantidad, monto, monto de la primera. Para la COHORTE
  // (primera carga dentro del rango) vienen además sus cargas (fecha+monto) para retención, escalera y netwin de nuevos.
  const perUser = await Transaction.aggregate([
    { $match: realDep }, { $sort: { timestamp: 1 } },
    { $group: { _id: '$userId', un: { $first: '$username' }, first: { $min: '$timestamp' }, last: { $max: '$timestamp' }, n: { $sum: 1 }, amt: { $sum: '$amount' }, firstAmt: { $first: '$amount' }, tx: { $push: { t: '$timestamp', a: '$amount' } } } },
    { $project: { un: 1, first: 1, last: 1, n: 1, amt: 1, firstAmt: 1, tx: { $cond: [{ $and: [{ $gte: ['$first', from] }, { $lte: ['$first', to] }] }, '$tx', '$$REMOVE'] } } }
  ]).allowDiskUse(true);
  lap('perUser');
  const cohort = perUser.filter((u) => Array.isArray(u.tx));
  const cohortSet = new Set(cohort.map((u) => u._id));
  const cohortNames = new Set(cohort.map((u) => String(u.un || '').toLowerCase()).filter(Boolean));
  const isCohort = (userId, username) => cohortSet.has(userId) || (username && cohortNames.has(String(username).toLowerCase()));
  const firstIn = (a, b) => perUser.filter((u) => u.first >= a && u.first <= b);

  // (2) Rango: TODO agrupado en Mongo por período (hora argentina) y por usuario.
  const bExpr = bucketExpr('$timestamp', gran);
  const byBucket = (match) => Transaction.aggregate([{ $match: { ...match, ...inRange } }, { $group: { _id: { b: bExpr, u: '$userId' }, n: { $sum: 1 }, amt: { $sum: '$amount' } } }, { $group: { _id: '$_id.b', n: { $sum: '$n' }, amt: { $sum: '$amt' }, users: { $sum: 1 } } }]);
  const byUser = (match) => Transaction.aggregate([{ $match: { ...match, ...inRange } }, { $group: { _id: '$userId', n: { $sum: 1 }, amt: { $sum: '$amount' } } }]);
  const sessMatch = scope({ startedAt: { $gte: from, $lte: to } });
  const [depB, depU, wdB, wdU, regB, logins, sessB, sessU, refundsR, spinsR, supportMsgs, promoAgg, last14U] = await Promise.all([
    byBucket(realDep), byUser(realDep), byBucket(realWd), byUser(realWd),
    User.aggregate([{ $match: { ...userFilter, createdAt: { $gte: from, $lte: to } } }, { $group: { _id: bucketExpr('$createdAt', gran), n: { $sum: 1 } } }]),
    // lastLogin hasta 7 días después del rango: sirve para "volvió a ENTRAR en la primera semana" de los nuevos del final del rango
    User.find({ ...userFilter, lastLogin: { $gte: from, $lte: new Date(Math.min(now.getTime(), to.getTime() + 7 * DAY)) } }).select('id lastLogin').lean(),
    AppSession.aggregate([{ $match: sessMatch }, { $group: { _id: { b: bucketExpr('$startedAt', gran), u: '$userId' }, n: { $sum: 1 }, min: { $sum: { $max: [1, { $divide: [{ $subtract: ['$lastPingAt', '$startedAt'] }, 60000] }] } } } }, { $group: { _id: '$_id.b', sesiones: { $sum: '$n' }, usuarios: { $sum: 1 }, minutos: { $sum: '$min' } } }]),
    AppSession.aggregate([{ $match: sessMatch }, { $group: { _id: '$userId', inst: { $max: { $cond: ['$installed', 1, 0] } }, days: { $addToSet: '$dateKey' } } }]),
    RefundClaim.find(scope({ claimedAt: { $gte: from, $lte: to } })).select('userId amount claimedAt').lean(),
    DailyRouletteSpin.find(scope({ spunAt: { $gte: from, $lte: to } })).select('userId spunAt prizeARS').lean(),
    Message.countDocuments({ senderRole: 'user', timestamp: { $gte: from, $lte: to } }),
    // Regalos por tipo y usuario. ⚠️ Algunos bonos viejos no tienen userId (sólo username): se agrupa por los dos.
    Transaction.aggregate([{ $match: scope({ type: { $in: PROMO_TYPES }, status: okStatus, ...inRange }) }, { $group: { _id: { t: '$type', u: '$userId', un: '$username' }, n: { $sum: 1 }, amt: { $sum: '$amount' } } }]),
    // #477: venta de los ÚLTIMOS 14 días por usuario → lo que vende por día la base "vieja" (primera carga antes de esos 14 días)
    Transaction.aggregate([{ $match: { ...realDep, timestamp: { $gte: new Date(to.getTime() - 14 * DAY), $lte: to } } }, { $group: { _id: '$userId', amt: { $sum: '$amount' } } }])
  ]);
  lap('rango');
  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f ? f(x) : x) || 0), 0);

  // Retención de la cohorte
  const lastLoginById = new Map(logins.map((u) => [u.id, new Date(u.lastLogin)]));
  const sessDaysById = new Map(sessU.map((s) => [s._id, s.days || []]));
  const redep = (u, d) => { const lim = u.first.getTime() + d * DAY; return u.tx.some((x) => x.t > u.first && x.t.getTime() <= lim); };
  const nextB = (u) => { const b = bucketOf(u.first, gran); return u.tx.some((x) => x.t > u.first && bucketOf(x.t, gran) !== b); };
  const back7 = (u) => { const since = u.first.getTime(), lim = since + 7 * DAY; const ll = lastLoginById.get(u._id); if (ll && ll.getTime() > since + 60000 && ll.getTime() <= lim) return true; const k0 = dateKeyART(u.first), k1 = dateKeyART(new Date(lim)); return (sessDaysById.get(u._id) || []).some((k) => k >= k0 && k <= k1); };
  const retention = { cohort: cohort.length, d7: pct(cohort.filter((u) => redep(u, 7)).length, cohort.length), d30: pct(cohort.filter((u) => redep(u, 30)).length, cohort.length), next: pct(cohort.filter(nextB).length, cohort.length), login7: pct(cohort.filter(back7).length, cohort.length) };

  // Escalera después de la primera carga (todo lo que cargaron hasta hoy)
  const L = { una: 0, dosTres: 0, cuatroNueve: 0, diezMas: 0, activos14: 0, enDuda: 0, perdidos30: 0, cargas: 0, monto: 0, primera: 0 };
  cohort.forEach((u) => { L.cargas += u.n; L.monto += u.amt; L.primera += Number(u.firstAmt) || 0; if (u.n <= 1) L.una++; else if (u.n <= 3) L.dosTres++; else if (u.n <= 9) L.cuatroNueve++; else L.diezMas++; const ago = (now - new Date(u.last)) / DAY; if (ago <= 14) L.activos14++; else if (ago > 30) L.perdidos30++; else L.enDuda++; });
  const n = cohort.length;
  const repeat = { cohort: n, siguieronCargando: n - L.una, pctSiguieron: pct(n - L.una, n), una: L.una, pctUna: pct(L.una, n), dosTres: L.dosTres, pctDosTres: pct(L.dosTres, n), cuatroNueve: L.cuatroNueve, pctCuatroNueve: pct(L.cuatroNueve, n), diezMas: L.diezMas, pctDiezMas: pct(L.diezMas, n), activos14: L.activos14, pctActivos14: pct(L.activos14, n), enDuda: L.enDuda, perdidos30: L.perdidos30, pctPerdidos30: pct(L.perdidos30, n), cargasPorCliente: n ? r1(L.cargas / n) : null, montoPorCliente: n ? r0(L.monto / n) : null, primeraCargaPromedio: n ? r0(L.primera / n) : null };

  // #483 CURVA DE RETENCIÓN por antigüedad (días desde la primera carga): cuánto vende por día un cliente a esa edad y qué % sigue
  // cargando. Sólo cuentan los clientes que ya tienen esa edad (ventana completa hasta hoy), así no se subestima a los recientes.
  const AGE_BUCKETS = [[1, 7], [8, 14], [15, 30], [31, 60], [61, 90], [91, 120], [121, 180], [181, 365]];
  const curva = AGE_BUCKETS.map(([a0, a1]) => {
    let clientes = 0, venta = 0, activos = 0, cargasN = 0;
    cohort.forEach((u) => { const f = u.first.getTime(); if (f + a1 * DAY > now.getTime()) return; clientes++; let any = false; u.tx.forEach((x) => { const age = Math.floor((x.t.getTime() - f) / DAY); if (age >= a0 && age <= a1) { venta += x.a; cargasN++; any = true; } }); if (any) activos++; });
    return { desde: a0, hasta: a1, clientes, ventaPorClienteDia: clientes ? Math.round(venta / clientes / (a1 - a0 + 1)) : null, activosPct: clientes ? Math.round((activos / clientes) * 1000) / 10 : null, cargasPorCliente: clientes ? Math.round((cargasN / clientes) * 100) / 100 : null };
  });
  // Abandono de toda la base del alcance
  const churn30 = pct(perUser.filter((u) => new Date(u.last) < new Date(to.getTime() - 30 * DAY)).length, perUser.length);

  // Serie por período (ya viene agrupada de Mongo)
  const buckets = listBuckets(from, to, gran);
  const row = () => ({ registros: 0, primerasCargas: 0, cargas: 0, montoCargas: 0, cargadores: 0, retiros: 0, montoRetiros: 0, sesiones: 0, usuariosApp: 0, usuariosLogin: new Set(), minutos: 0, reembolsos: 0, montoReembolsos: 0, giros: 0, premiosRuleta: 0 });
  const series = {}; buckets.forEach((b) => { series[b] = row(); });
  const get = (b) => { if (!series[b]) series[b] = row(); return series[b]; };
  regB.forEach((x) => { get(x._id).registros += x.n; });
  cohort.forEach((u) => { get(bucketOf(u.first, gran)).primerasCargas++; });
  depB.forEach((x) => { const r = get(x._id); r.cargas += x.n; r.montoCargas += x.amt; r.cargadores += x.users; });
  wdB.forEach((x) => { const r = get(x._id); r.retiros += x.n; r.montoRetiros += x.amt; });
  sessB.forEach((x) => { const r = get(x._id); r.sesiones += x.sesiones; r.usuariosApp += x.usuarios; r.minutos += x.minutos; });
  logins.forEach((u) => { if (u.lastLogin <= to) get(bucketOf(u.lastLogin, gran)).usuariosLogin.add(u.id); });
  refundsR.forEach((c) => { const r = get(bucketOf(c.claimedAt, gran)); r.reembolsos++; r.montoReembolsos += Number(c.amount) || 0; });
  spinsR.forEach((s) => { const r = get(bucketOf(s.spunAt, gran)); r.giros++; r.premiosRuleta += Number(s.prizeARS) || 0; });
  const spendOf = {}; Object.keys(spendByDay).forEach((k) => { const bb = bucketOfKey(k, gran); spendOf[bb] = (spendOf[bb] || 0) + spendByDay[k]; });
  const rows = Object.keys(series).sort().map((b) => { const r = series[b]; const ua = Math.max(r.usuariosApp, r.usuariosLogin.size); return { bucket: b, gasto: r0(spendOf[b] || 0), costoPorNuevo: spendOf[b] > 0 && r.primerasCargas ? r0(spendOf[b] / r.primerasCargas) : null, registros: r.registros, primerasCargas: r.primerasCargas, cargas: r.cargas, montoCargas: r0(r.montoCargas), cargadores: r.cargadores, retiros: r.retiros, montoRetiros: r0(r.montoRetiros), netwin: r0(r.montoCargas - r.montoRetiros), sesiones: r.sesiones, usuariosApp: ua, minPorSesion: r.sesiones ? r1(r.minutos / r.sesiones) : null, reembolsos: r.reembolsos, montoReembolsos: r0(r.montoReembolsos), giros: r.giros, premiosRuleta: r0(r.premiosRuleta) }; });
  lap('series');

  // Totales
  const montoCargas = sum(depB, (x) => x.amt), cargas = sum(depB, (x) => x.n), montoRetiros = sum(wdB, (x) => x.amt), retiros = sum(wdB, (x) => x.n);
  const appUsers = new Set([...sessU.map((s) => s._id), ...logins.filter((u) => u.lastLogin <= to).map((u) => u.id)]);
  const sesiones = sum(sessB, (x) => x.sesiones), minutos = sum(sessB, (x) => x.minutos);
  // Nuevos del rango: lo que cargaron DENTRO del rango y lo que retiraron
  const montoCargasNuevos = sum(cohort, (u) => sum(u.tx.filter((x) => x.t <= to), (x) => x.a));
  const montoRetirosNuevos = sum(wdU.filter((w) => cohortSet.has(w._id)), (w) => w.amt);
  const nwNew = montoCargasNuevos - montoRetirosNuevos;
  // Promociones: por tipo y separadas entre NUEVOS del rango y RECURRENTES (clientes de antes). #477
  const promos = {}; let promosTotal = 0, promosNuevos = 0, promosRecurrentes = 0;
  (promoAgg || []).forEach((p) => { const t = p._id.t; if (!promos[t]) promos[t] = { n: 0, amt: 0, nuevos: 0, recurrentes: 0 }; promos[t].n += p.n; promos[t].amt += p.amt; promosTotal += p.amt; if (isCohort(p._id.u, p._id.un)) { promos[t].nuevos += p.amt; promosNuevos += p.amt; } else { promos[t].recurrentes += p.amt; promosRecurrentes += p.amt; } });
  Object.keys(promos).forEach((k) => { promos[k].amt = r0(promos[k].amt); promos[k].nuevos = r0(promos[k].nuevos); promos[k].recurrentes = r0(promos[k].recurrentes); });
  const montoCargasRecurrentes = Math.max(0, Math.round(montoCargas - montoCargasNuevos)); // redondeado: evita residuos flotantes
  // Base actual: clientes con primera carga ANTES de los últimos 14 días → cuánto vendieron por día en esos 14 días
  const firstById = new Map(perUser.map((u) => [u._id, u.first])); const cut14 = new Date(to.getTime() - 14 * DAY);
  let venta14Viejos = 0, clientes14Viejos = 0; (last14U || []).forEach((x) => { const f = firstById.get(x._id); if (f && f < cut14) { venta14Viejos += x.amt; clientes14Viejos++; } });
  const netwin = montoCargas - montoRetiros;
  const pc = opts.promoConfig || null;
  // Tasa de reclamo del reembolso: cuánto de lo "reembolsable" (pérdida × % diario) se pagó de verdad (0..1).
  const tasaReclamo = pc && pc.dailyRefundPct > 0 && netwin > 0 ? clamp(((promos.refund && promos.refund.amt) || 0) / (netwin * pc.dailyRefundPct / 100), 0, 1) : null;
  const totals = {
    dias: days, registros: sum(regB, (x) => x.n), primerasCargas: n, conversionRegistroCarga: null,
    cargas, montoCargas: r0(montoCargas), cargadores: depU.length, cargasPorCargador: depU.length ? r1(cargas / depU.length) : null, cargaPromedio: cargas ? r0(montoCargas / cargas) : null,
    retiros, montoRetiros: r0(montoRetiros), netwin: r0(netwin),
    usuariosApp: appUsers.size, sesiones, minPorSesion: sesiones ? r1(minutos / sesiones) : null, sesionesPorUsuarioDia: appUsers.size ? Math.round(sesiones / appUsers.size / days * 100) / 100 : null, instalados: sessU.filter((s) => s.inst).length,
    reembolsos: refundsR.length, montoReembolsos: r0(sum(refundsR, (x) => x.amount)), giros: spinsR.length, premiosRuleta: r0(sum(spinsR, (x) => x.prizeARS)), mensajesSoporte: supportMsgs,
    promos, promosTotal: r0(promosTotal), promosNuevos: r0(promosNuevos), promosRecurrentes: r0(promosRecurrentes),
    montoCargasNuevos: r0(montoCargasNuevos), montoCargasRecurrentes: r0(montoCargasRecurrentes), montoRetirosNuevos: r0(montoRetirosNuevos),
    promosPct: pct(promosTotal, montoCargas), promosPctNuevos: pct(promosNuevos, Math.round(montoCargasNuevos)), promosPctRecurrentes: montoCargasRecurrentes >= 1 ? pct(promosRecurrentes, montoCargasRecurrentes) : null,
    netwinNeto: r0(netwin - promosTotal), tasaReclamoReembolso: tasaReclamo == null ? null : Math.round(tasaReclamo * 100) / 100,
    churn30, spend, gastoPorDia: spend > 0 ? r0(spend / days) : 0, cac: spend > 0 && n ? r0(spend / n) : null, ventaPorPeso: spend > 0 ? Math.round((montoCargas / spend) * 100) / 100 : null, netoPorPeso: spend > 0 ? Math.round(((netwin - promosTotal) / spend) * 100) / 100 : null,
    netwinNuevos: r0(nwNew), netwinPorNuevo: n ? r0(nwNew / n) : null, baseCargadores: perUser.length, primeraCargaPromedio: repeat.primeraCargaPromedio,
    ventaBaseViejaPorDia: r0(venta14Viejos / 14), clientesBaseVieja14: clientes14Viejos
  };
  totals.conversionRegistroCarga = pct(n, totals.registros);
  // Período anterior (misma longitud)
  const prevTo = new Date(from.getTime() - 1), prevFrom = new Date(from.getTime() - (to - from) - 1);
  const [prevRegs, prevDepAgg] = await Promise.all([
    User.countDocuments({ ...userFilter, createdAt: { $gte: prevFrom, $lte: prevTo } }),
    Transaction.aggregate([{ $match: { ...realDep, timestamp: { $gte: prevFrom, $lte: prevTo } } }, { $group: { _id: null, n: { $sum: 1 }, amt: { $sum: '$amount' } } }])
  ]);
  const prevFirst = firstIn(prevFrom, prevTo).length; const prevAmt = (prevDepAgg[0] && prevDepAgg[0].amt) || 0;
  const growth = { primerasCargas: pct(n - prevFirst, prevFirst), registros: pct(totals.registros - prevRegs, prevRegs), montoCargas: pct(montoCargas - prevAmt, prevAmt), prev: { primerasCargas: prevFirst, registros: prevRegs, montoCargas: r0(prevAmt) } };
  lap('prev');
  T.counts = { perUser: perUser.length, cohort: cohort.length, depB: depB.length, depU: depU.length, logins: logins.length, sessU: sessU.length, promoAgg: (promoAgg || []).length };
  return { from: dateKeyART(from), to: dateKeyART(to), granularity: gran, campaign: campaign || null, totals, retention, repeat, curva, growth, rows, promoConfig: pc, moneda: { cur: F.usd ? 'usd' : 'ars', usdRate: F.rate || null }, informe: narrative(totals, retention, growth, gran, repeat, pc, F), calculadoEn: now.toISOString(), timings: T };
}

function grade(v, good, ok) { if (v == null) return null; return v >= good ? 'bien' : (v >= ok ? 'regular' : 'flojo'); }
function narrative(t, r, g, gran, rp, pc, F) {
  const money = (F || fmt()).money;
  const L = []; const per = gran === 'month' ? 'mes' : (gran === 'week' ? 'semana' : 'día');
  const sec = (ico, titulo, texto, estado, consejo) => L.push({ ico, titulo, texto, estado: estado || null, consejo: consejo || null });
  // Captación
  const conv = t.conversionRegistroCarga;
  sec('📥', 'Captación', `${t.registros} registros y ${t.primerasCargas} clientes que cargaron por primera vez en ${t.dias} día(s)` + (conv != null ? ` (${conv}% de los registrados llegó a cargar)` : '') + (g.primerasCargas != null ? `. Contra el período anterior: primeras cargas ${g.primerasCargas >= 0 ? '+' : ''}${g.primerasCargas}% (antes ${g.prev.primerasCargas}), registros ${g.registros >= 0 ? '+' : ''}${g.registros}%.` : '.'),
    grade(conv, 35, 20), conv == null ? null : (conv >= 35 ? 'La conversión registro → carga es buena.' : (conv >= 20 ? 'Muchos se registran y no cargan: revisar el primer mensaje, la carga mínima y la claridad del CBU.' : 'La mayoría entra y no carga: trabajar el primer contacto (soporte, bono de bienvenida, claridad del CBU).')));
  // Retención
  if (r.cohort) {
    const gd = grade(r.d30, 40, 20);
    sec('🔁', 'Retención', `De los ${r.cohort} que cargaron por primera vez: volvió a cargar a los 7 días el ${r.d7 ?? 0}%, a los 30 días el ${r.d30 ?? 0}% y en el ${per} siguiente el ${r.next ?? 0}%. Volvió a ENTRAR a la app en la primera semana el ${r.login7 ?? 0}%.`, gd,
      gd === 'bien' ? 'El producto gusta: la gente vuelve a cargar.' : (gd === 'regular' ? 'Vuelve una parte: empujar con reembolsos, fueguito y avisos a los que no vuelven.' : 'La mayoría carga una vez y no vuelve: antes de invertir más, revisar la experiencia después de la primera carga.') + (r.login7 != null && r.d7 != null && r.login7 - r.d7 >= 25 ? ' Muchos vuelven a ENTRAR pero no a CARGAR: falta un motivo para la segunda carga (bono en la 2ª carga, recordatorio).' : ''));
  } else sec('🔁', 'Retención', 'No hubo primeras cargas en el rango: no se puede medir.', null, null);
  // Escalera
  if (rp && rp.cohort) sec('🪜', 'Después de la primera carga', `De los ${rp.cohort} nuevos del rango (contando todo lo que cargaron hasta hoy): ${rp.siguieronCargando} siguieron cargando (${rp.pctSiguieron}%) y ${rp.una} se quedaron en una sola carga (${rp.pctUna}%). 2-3 cargas: ${rp.dosTres} (${rp.pctDosTres}%) · 4-9: ${rp.cuatroNueve} (${rp.pctCuatroNueve}%) · 10 o más: ${rp.diezMas} (${rp.pctDiezMas}%). Hoy siguen activos (cargaron en los últimos 14 días) ${rp.activos14} (${rp.pctActivos14}%); perdidos (más de 30 días sin cargar) ${rp.perdidos30} (${rp.pctPerdidos30}%). Cada nuevo dejó en promedio ${rp.cargasPorCliente} cargas y ${money(rp.montoPorCliente)} (primera carga promedio ${money(rp.primeraCargaPromedio)}).`,
    grade(rp.pctSiguieron, 50, 30), rp.pctSiguieron >= 50 ? 'Quedan muchos: más de la mitad vuelve a cargar. Base sana.' : (rp.pctSiguieron >= 30 ? 'Se pierde una parte importante en el camino: entre 3 y 5 de cada 10 siguen. Trabajar la segunda carga.' : 'Se pierde la mayoría: menos de 3 de cada 10 vuelven. El problema no es traer gente sino retenerla.'));
  if (t.churn30 != null) sec('📉', 'Abandono', `El ${t.churn30}% de los ${t.baseCargadores} que alguna vez cargaron no carga hace más de 30 días.`, t.churn30 >= 70 ? 'flojo' : (t.churn30 >= 45 ? 'regular' : 'bien'), t.churn30 >= 70 ? 'Alto: la base se enfría. Campañas de recuperación.' : (t.churn30 >= 45 ? 'Normal para el rubro; vale un lote de recuperación.' : 'Bajo: la base está activa.'));
  // Uso
  if (t.sesiones) sec('📱', 'Uso de la app', `${t.usuariosApp} usuarios entraron, ${t.sesiones} sesiones, ${t.minPorSesion} min por sesión en promedio, ${t.sesionesPorUsuarioDia} sesiones por usuario por día; ${t.instalados} usaron la app instalada.`, t.minPorSesion >= 4 ? 'bien' : (t.minPorSesion >= 2 ? 'regular' : 'flojo'), t.minPorSesion >= 4 ? 'Se quedan un buen rato: la app engancha.' : (t.minPorSesion >= 2 ? 'Visitas cortas: entran, hacen lo suyo y salen (normal si vienen a cargar).' : 'Visitas muy cortas: revisar si encuentran lo que buscan.'));
  else sec('📱', 'Uso de la app', `${t.usuariosApp} usuarios entraron. Sin medición de tiempo en sesión todavía (el medidor arranca con la versión nueva de la app).`, null, null);
  // Dinero
  sec('💰', 'Dinero (datos reales)', `DEPÓSITOS: ${t.cargas} cargas por ${money(t.montoCargas)} (${t.cargadores} cargadores, ${t.cargasPorCargador ?? 0} cargas por cargador, promedio ${money(t.cargaPromedio)}). RETIROS: ${t.retiros} por ${money(t.montoRetiros)}. VENTA (netwin = depósitos − retiros): ${money(t.netwin)}. De los depósitos, ${money(t.montoCargasNuevos)} fueron de clientes nuevos del período y ${money(t.montoCargasRecurrentes)} de clientes de antes.`,
    t.cargasPorCargador == null ? null : (t.cargasPorCargador >= 3 ? 'bien' : (t.cargasPorCargador >= 1.8 ? 'regular' : 'flojo')), t.cargasPorCargador == null ? null : (t.cargasPorCargador >= 3 ? 'Frecuencia de carga alta: los que cargan, repiten.' : (t.cargasPorCargador >= 1.8 ? 'Frecuencia de carga media.' : 'Frecuencia baja: la mayoría carga una sola vez en el período.')));
  // #469/#477 Promociones vigentes + costo real, separando nuevos y recurrentes
  {
    const vig = pc ? [pc.firstDepositBonusPct > 0 ? `${pc.firstDepositBonusPct}% en la PRIMERA carga` : null, pc.autoLoadBonusPct > 0 ? `${pc.autoLoadBonusPct}% en cargas automáticas` : null, pc.roulettePct > 0 ? `ruleta ≈ ${pc.roulettePct}% extra por giro` : null, pc.dailyRefundPct > 0 ? `reembolso diario ${pc.dailyRefundPct}%` : null, pc.weeklyRefundPct > 0 ? `semanal ${pc.weeklyRefundPct}%` : null, pc.monthlyRefundPct > 0 ? `mensual ${pc.monthlyRefundPct}%` : null, pc.installGiftPct > 0 ? `${pc.installGiftPct}% extra por instalar la app` : null].filter(Boolean).join(' · ') : null;
    const det = Object.keys(t.promos || {}).map((k) => `${PROMO_LABEL[k] || k} ${money(t.promos[k].amt)}`).join(' · ');
    sec('🎁', 'Premios y regalos (lo que regalás)', (vig ? `Condiciones vigentes: ${vig}. ` : '') + `En el período regalaste ${money(t.promosTotal)} = ${t.promosPct ?? 0}% de los depósitos` + (det ? ` (${det})` : '') + `. A los clientes NUEVOS del período les fue ${money(t.promosNuevos)} (${t.promosPctNuevos ?? 0}% de lo que cargaron: ahí pesa el bono de primera carga) y a los de ANTES ${money(t.promosRecurrentes)} (${t.promosPctRecurrentes ?? 0}% de lo que cargaron). NETO (venta − regalos): ${money(t.netwinNeto)}.` + (t.tasaReclamoReembolso != null ? ` Del reembolso diario se cobró el ${Math.round(t.tasaReclamoReembolso * 100)}% de lo reembolsable.` : ''),
      t.promosPct == null ? null : (t.promosPct <= 15 ? 'bien' : (t.promosPct <= 30 ? 'regular' : 'flojo')),
      t.promosPct == null ? null : (t.promosPct <= 15 ? 'Los regalos pesan poco sobre los depósitos.' : (t.promosPct <= 30 ? 'Los regalos pesan bastante: es el precio de captar. Los clientes que quedan después de la primera carga dejan más margen (ya no llevan ese bono).' : 'Los regalos se comen gran parte del margen: revisar el % de primera carga y los reembolsos.')));
  }
  // Inversión
  if (t.spend > 0) sec('📣', 'Inversión', `${money(t.spend)} gastados en el período (${money(t.gastoPorDia)} por día) → costo por cliente nuevo (primera carga): ${t.cac != null ? money(t.cac) : '—'}. Por cada ${F && F.usd ? 'US$ 1' : '$1'} invertido entraron ${t.ventaPorPeso} en depósitos y quedaron ${t.netoPorPeso} netos. Los ${t.primerasCargas} nuevos dejaron ${money(t.netwinNuevos)} de VENTA (netwin) en el período (${money(t.netwinPorNuevo)} por cliente).`,
    t.cac != null && t.netwinPorNuevo != null ? (t.netwinPorNuevo >= t.cac * 1.3 ? 'bien' : (t.netwinPorNuevo >= t.cac * 0.8 ? 'regular' : 'flojo')) : null,
    t.cac != null && t.netwinPorNuevo != null ? (t.netwinPorNuevo >= t.cac * 1.3 ? 'La inversión RINDE: cada cliente nuevo deja más de lo que costó traerlo, ya dentro del período.' : (t.netwinPorNuevo >= t.cac * 0.8 ? 'Al límite: el cliente nuevo paga casi lo que costó; depende de que vuelva a cargar.' : 'No se recupera en el período: cada cliente nuevo cuesta más de lo que deja. Si la retención es buena puede cerrar después; si no, bajar el gasto o cambiar la pauta.')) : null);
  else sec('📣', 'Inversión', 'Cargá el gasto en publicidad del período para calcular el costo por cliente nuevo y si se recupera.', null, null);
  sec('💬', 'Soporte', `${t.mensajesSoporte} mensajes de clientes en el período.`, null, null);
  // Veredicto
  const score = L.map((x) => x.estado).filter(Boolean); const good = score.filter((x) => x === 'bien').length, bad = score.filter((x) => x === 'flojo').length;
  const veredicto = !score.length ? { nivel: 'sin-datos', texto: 'Todavía no hay datos suficientes en este rango.' } : (good > bad && bad <= 1 ? { nivel: 'bien', texto: 'El negocio está sano: la gente carga, vuelve y repite. Vale invertir más.' } : (bad >= 2 && bad >= good ? { nivel: 'flojo', texto: 'Hay señales de alarma (conversión, retención o frecuencia flojas). Antes de escalar la pauta, ajustar producto y seguimiento.' } : { nivel: 'regular', texto: 'Va, pero con puntos a mejorar: mantener la inversión y corregir lo marcado.' }));
  return { secciones: L, veredicto, resumen: { bien: good, regular: score.filter((x) => x === 'regular').length, flojo: bad } };
}

function compare(ours, other) {
  const dOther = Math.max(1, Math.round((new Date(other.to) - new Date(other.from)) / DAY) + 1), oursDays = ours.totals.dias;
  const rows = [];
  const add = (key, label, o, t, isMoney) => {
    const tv = (t == null || t === '') ? null : Number(t); const od = o == null ? null : Math.round((o / oursDays) * 100) / 100, td = tv == null ? null : Math.round((tv / dOther) * 100) / 100;
    const diff = od != null && td != null && td > 0 ? Math.round(((od - td) / td) * 1000) / 10 : null;
    rows.push({ key, label, ours: o, oursPerDay: od, other: tv, otherPerDay: td, diffPct: diff, better: diff != null && diff > 5, worse: diff != null && diff < -5, isMoney: !!isMoney });
  };
  add('firstDeposits', 'Clientes que cargaron por primera vez', ours.totals.primerasCargas, other.firstDeposits);
  add('usersEntered', 'Usuarios que entraron a la app', ours.totals.usuariosApp, other.usersEntered);
  add('deposits', 'Cantidad de depósitos', ours.totals.cargas, other.deposits);
  add('depositsSum', 'Monto depositado', ours.totals.montoCargas, other.depositsSum, true);
  const direct = (key, label, o, t) => { const tv = (t == null || t === '') ? null : Number(t); const diff = o != null && tv != null && tv > 0 ? Math.round(((o - tv) / tv) * 1000) / 10 : null; rows.push({ key, label, ours: o, other: tv, diffPct: diff, better: diff != null && diff > 5, worse: diff != null && diff < -5, direct: true }); };
  if (other.avgSessionMin != null && other.avgSessionMin !== '') direct('avgSessionMin', 'Minutos por sesión (medidor)', ours.totals.minPorSesion, other.avgSessionMin);
  if (other.retentionPct != null && other.retentionPct !== '') direct('retention', 'Retención a 30 días (volvió a cargar, %)', ours.retention.d30, other.retentionPct);
  const b = rows.filter((r) => r.better).length, w = rows.filter((r) => r.worse).length, nn = rows.filter((r) => r.diffPct != null).length;
  const verdict = !nn ? 'Faltan números de la otra página para comparar.' : (b > w ? `La app nueva va MEJOR en ${b} de ${nn} indicadores (comparando por día).` : (w > b ? `La app nueva va PEOR en ${w} de ${nn} indicadores (comparando por día).` : 'Parejas: sin diferencias claras por día.'));
  return { otherLabel: other.label || 'Otra página', otherDays: dOther, oursDays, rows, verdict, nivel: !nn ? 'sin-datos' : (b > w ? 'bien' : (w > b ? 'flojo' : 'regular')) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #477 PANORAMA (calculador de inversión). Lógica, en criollo:
//  1. LA BASE = lo que pasó de verdad en el período base (ej. desde el inicio hasta hoy): inversión, clientes nuevos,
//     venta (cargas), retiros, regalos (separando nuevos y recurrentes), netwin bruto y neto.
//     De ahí salen: costo por cliente (inversión / nuevos), cuánto deja cada cliente nuevo (venta, retiros), cuánto
//     venden por día los clientes de ANTES (recurrentes) y qué % de lo reembolsable se cobra de verdad.
//  2. LAS CONDICIONES: las vigentes se leen del panel (bono 1ª carga, reembolso diario, bono en cargas siguientes =
//     carga automática + promedio de la ruleta). Las FUTURAS las escribe el owner. Los regalos del futuro NO se copian de
//     lo observado: se calculan con los % futuros sobre la plata proyectada (1ª carga con tope, cargas siguientes, reembolso
//     sobre lo perdido × tasa de reclamo) + los regalos "fijos" observados (fueguito, VIP, referidos…) como % de la venta.
//     Así, bajar el bono de primera carga sube el neto de los que quedan.
//  3. SI INVERTÍS X EN N DÍAS: clientes nuevos por pauta = X / costo por cliente (+ orgánicos al ritmo de la base).
//     Cada nuevo vende lo que vendieron los de la base, ajustado por la duración (horizonte = N / días base, entre 0.5 y 2).
//     Se suma lo que sigue vendiendo la base actual (recurrentes por día × N). Tres panoramas: bajo (−30 %), base, alto (+30 %)
//     sobre los clientes nuevos. Resultado de la pauta = neto de los clientes por pauta − inversión.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function project(base, opts) {
  const F = fmt(opts); const money = F.money;
  const spend = Math.max(0, Number(opts.spend) || 0), days = Math.max(1, Math.min(365, parseInt(opts.days, 10) || 30));
  const t = base.totals, rp = base.repeat, baseDays = Math.max(1, t.dias);
  const calib = Number(opts.calibration) > 0 ? Number(opts.calibration) : 1;
  const cac = Number(opts.cac) > 0 ? Number(opts.cac) : (t.cac || null);
  const organicPct = Number(opts.organicPct) >= 0 && Number(opts.organicPct) <= 100 ? Number(opts.organicPct) / 100 : 0.3;
  const perDayFirst = t.primerasCargas / baseDays;
  let organicPerDay;
  if (t.spend > 0 && cac) organicPerDay = Math.max(0, perDayFirst - (t.spend / baseDays) / cac); // base con gasto: lo que no explica la pauta
  else organicPerDay = perDayFirst * organicPct;
  const cargasPorCliente = rp.cargasPorCliente || t.cargasPorCargador || 1;
  const montoPorCliente = rp.montoPorCliente || t.cargaPromedio || 0;
  const primeraCarga = Math.min(montoPorCliente || Infinity, rp.primeraCargaPromedio || t.cargaPromedio || 0);
  const cargaProm = t.cargaPromedio || primeraCarga || 1;
  const wdRatio = t.montoCargas > 0 ? clamp(t.montoRetiros / t.montoCargas, 0, 0.95) : 0.5;
  const activePct = (rp.pctActivos14 != null ? rp.pctActivos14 : 30) / 100;
  const horizon = clamp(days / baseDays, 0.5, 2);
  // Condiciones
  const pc = opts.promoConfig || {};
  const capArs = Number(pc.capArs) > 0 ? Number(pc.capArs) : 20000, restPct = Number(pc.restPct) >= 0 ? Number(pc.restPct) : 20;
  const cur = { bonus1: Number(pc.firstDepositBonusPct) || 0, refund: Number(pc.dailyRefundPct) || 0, rec: (Number(pc.autoLoadBonusPct) || 0) + (Number(pc.roulettePct) || 0) };
  const pick = (v, d) => (v !== '' && v != null && Number(v) >= 0 ? Number(v) : d);
  const fut = { bonus1: pick(opts.futBonus, cur.bonus1), refund: pick(opts.futRefund, cur.refund), rec: pick(opts.futRec, cur.rec) };
  const capCost = (amount, p) => (p / 100) * Math.min(amount, capArs) + (restPct / 100) * Math.max(0, amount - capArs);
  const tasaReclamo = t.tasaReclamoReembolso != null ? t.tasaReclamoReembolso : 0.6;
  const fixedTypes = ['fire_reward', 'rakeback', 'vip_levelup', 'install_gift', 'referral_commission', 'mission']; // #486: la ruleta ya va en el % de cargas siguientes (no se cuenta dos veces)
  const otrosPct = t.montoCargas > 0 ? fixedTypes.reduce((s, k) => s + ((t.promos && t.promos[k] && t.promos[k].amt) || 0), 0) / t.montoCargas : 0;
  // Economía de UN cliente nuevo en el horizonte, con las condiciones FUTURAS
  const ventaCli = montoPorCliente * horizon;
  const recAmt = Math.max(0, ventaCli - primeraCarga), recDeps = cargaProm > 0 ? recAmt / cargaProm : 0;
  const netwinBrutoCli = ventaCli * (1 - wdRatio);
  const bonus1Cli = capCost(primeraCarga, fut.bonus1), bonusRecCli = recDeps * capCost(cargaProm, fut.rec), refundCli = (fut.refund / 100) * netwinBrutoCli * tasaReclamo, otrosCli = ventaCli * otrosPct;
  const promosCli = bonus1Cli + bonusRecCli + refundCli + otrosCli;
  const netoCli = netwinBrutoCli - promosCli;
  // Lo mismo con las condiciones VIGENTES (para mostrar la diferencia)
  const promosCliHoy = capCost(primeraCarga, cur.bonus1) + recDeps * capCost(cargaProm, cur.rec) + (cur.refund / 100) * netwinBrutoCli * tasaReclamo + otrosCli;
  // La base actual (clientes de antes) sigue vendiendo al ritmo observado; sus regalos: con el % recurrente futuro
  // Base actual = clientes que ya cargaban antes de los últimos 14 días: lo que vendieron por día en esos 14 días (no depende de cómo se eligió la base)
  const recPorDia = t.ventaBaseViejaPorDia != null ? t.ventaBaseViejaPorDia : t.montoCargasRecurrentes / baseDays;
  const baseVenta = recPorDia * days, baseNetwin = baseVenta * (1 - wdRatio);
  const baseDepsN = cargaProm > 0 ? baseVenta / cargaProm : 0;
  const basePromos = baseDepsN * capCost(cargaProm, fut.rec) + (fut.refund / 100) * baseNetwin * tasaReclamo + baseVenta * otrosPct;
  const baseActual = { venta: r0(baseVenta), retiros: r0(baseVenta * wdRatio), netwin: r0(baseNetwin), promos: r0(basePromos), neto: r0(baseNetwin - basePromos), ventaPorDiaHoy: r0(recPorDia), clientes14: t.clientesBaseVieja14 || 0, promosPctHoy: t.promosPctRecurrentes };
  // #483 DESPUÉS DE LA INVERSIÓN, sin pauta: con la curva de retención, cuánto venden por día/mes los clientes que trajo la pauta
  // cuando termina el período y en los meses siguientes. Más allá de lo observado, decae al ritmo de los dos últimos tramos.
  const curva = (base.curva || []).filter((b) => b.clientes >= 20 && b.ventaPorClienteDia != null);
  const lastB = curva[curva.length - 1], prevB = curva[curva.length - 2];
  const decayMes = lastB && prevB && prevB.ventaPorClienteDia > 0 ? clamp(lastB.ventaPorClienteDia / prevB.ventaPorClienteDia, 0.3, 1) : 0.7;
  const vAt = (age) => { if (age < 1 || !lastB) return 0; for (const b of curva) if (age >= b.desde && age <= b.hasta) return b.ventaPorClienteDia; if (age < curva[0].desde) return curva[0].ventaPorClienteDia; return lastB.ventaPorClienteDia * Math.pow(decayMes, (age - lastB.hasta) / 30); };
  const actAt = (age) => { if (age < 1 || !lastB) return 0; for (const b of curva) if (age >= b.desde && age <= b.hasta) return (b.activosPct || 0) / 100; return ((lastB.activosPct || 0) / 100) * Math.pow(decayMes, (age - lastB.hasta) / 30); };
  const promosSobreVenta = (venta) => { const nw = venta * (1 - wdRatio); return (cargaProm > 0 ? (venta / cargaProm) * capCost(cargaProm, fut.rec) : 0) + (fut.refund / 100) * nw * tasaReclamo + venta * otrosPct; };
  const despuesDe = (cPorDia) => {
    const ventaDia = (k) => { let s = 0; for (let d = 0; d < days; d++) s += cPorDia * vAt(k + (days - 1 - d)); return s; };
    const activosEn = (k) => { let s = 0; for (let d = 0; d < days; d++) s += cPorDia * actAt(k + (days - 1 - d)); return s; };
    const meses = []; let tot = 0;
    for (let m = 1; m <= 6; m++) { let s = 0; for (let k = (m - 1) * 30 + 1; k <= m * 30; k++) s += ventaDia(k); const nw = s * (1 - wdRatio), pr = promosSobreVenta(s); tot += s; meses.push({ mes: m, venta: r0(s), porDia: r0(s / 30), netwin: r0(nw), regalos: r0(pr), neto: r0(nw - pr), activos: r0(activosEn(m * 30)) }); }
    const nwT = tot * (1 - wdRatio), prT = promosSobreVenta(tot);
    return { clientesPorDia: Math.round(cPorDia * 10) / 10, clientesTraidos: r0(cPorDia * days), ventaPorDiaAlFinal: r0(ventaDia(1)), ventaPorMesAlFinal: r0(ventaDia(1) * 30), netwinPorDiaAlFinal: r0(ventaDia(1) * (1 - wdRatio)), netwinPorMesAlFinal: r0(ventaDia(1) * 30 * (1 - wdRatio)), activosAlFinal: r0(activosEn(1)), meses, seisMeses: { venta: r0(tot), netwin: r0(nwT), regalos: r0(prT), neto: r0(nwT - prT) } };
  };
  const mk = (f) => {
    const ff = f * calib;
    const porPauta = cac ? (spend / cac) * ff : 0, organicos = organicPerDay * days * ff, nuevos = porPauta + organicos;
    const monto = nuevos * ventaCli, retiros = monto * wdRatio, netwin = monto - retiros;
    const promos = nuevos * promosCli, bonus1 = nuevos * bonus1Cli, bonusRec = nuevos * bonusRecCli, refund = nuevos * refundCli, otros = nuevos * otrosCli;
    const netwinNeto = netwin - promos;
    const netwinPauta = porPauta * netwinBrutoCli, netwinPautaNeto = porPauta * netoCli;
    const total = { venta: r0(monto + baseVenta), retiros: r0(retiros + baseVenta * wdRatio), netwin: r0(netwin + baseNetwin), promos: r0(promos + basePromos), neto: r0(netwinNeto + baseNetwin - basePromos) };
    return { clientesPorPauta: r0(porPauta), clientesOrganicos: r0(organicos), clientesNuevos: r0(nuevos), cargas: r0(nuevos * cargasPorCliente * horizon), montoCargas: r0(monto), retiros: r0(retiros), netwin: r0(netwin),
      promos: r0(promos), promosDetalle: { bonus1: r0(bonus1), bonusRec: r0(bonusRec), refund: r0(refund), otros: r0(otros) }, netwinNeto: r0(netwinNeto), netwinPauta: r0(netwinPauta), netwinPautaNeto: r0(netwinPautaNeto), netwinOrganico: r0(netwin - netwinPauta), activosAlFinal: r0(nuevos * activePct),
      resultado: r0(netwinPautaNeto - spend), roi: spend > 0 ? Math.round(((netwinPautaNeto - spend) / spend) * 100) : null, recuperaEnDias: cac && netoCli > 0 ? Math.min(999, r0(cac / (netoCli / days))) : null,
      total, resultadoTotal: r0(netwinNeto + baseNetwin - basePromos - spend), despues: despuesDe(cac ? (spend / days / cac) * ff : 0) };
  };
  // "Hoy, como está": lo que pasa por día en la base, llevado a N días (sin la inversión nueva)
  const hoy = { gastoPorDia: r0((t.spend || 0) / baseDays), nuevosPorDia: Math.round(perDayFirst * 10) / 10, cargasPorDia: r0(t.cargas / baseDays), montoPorDia: r0(t.montoCargas / baseDays), netwinPorDia: r0(t.netwin / baseDays), promosPorDia: r0(t.promosTotal / baseDays), netoPorDia: r0(t.netwinNeto / baseDays), costoPorNuevo: t.cac || null,
    enDias: { dias: days, gasto: r0((t.spend || 0) / baseDays * days), nuevos: r0(perDayFirst * days), monto: r0(t.montoCargas / baseDays * days), netwin: r0(t.netwin / baseDays * days), promos: r0(t.promosTotal / baseDays * days), neto: r0(t.netwinNeto / baseDays * days) } };
  const bajo = mk(0.7), b = mk(1), alto = mk(1.3);
  const cacOrigen = Number(opts.cac) > 0 ? 'indicado' : (t.cac ? 'observado en la base' : 'sin dato');
  const aviso = cac && primeraCarga && cac < primeraCarga * 0.02 ? `El costo por cliente (${money(cac)}) es sospechosamente bajo frente a la primera carga promedio (${money(primeraCarga)}): revisá el gasto de la base o la moneda del campo.` : null;
  const supuestos = { diasBase: baseDays, baseDesde: base.from, baseHasta: base.to, gastoBase: t.spend || 0, cac, cacOrigen, primerasCargasPorDia: Math.round(perDayFirst * 100) / 100, organicasPorDia: Math.round(organicPerDay * 100) / 100, organicPct: t.spend > 0 && cac ? null : Math.round(organicPct * 100), cargasPorCliente, montoPorCliente: r0(montoPorCliente), primeraCarga: r0(primeraCarga), cargaPromedio: r0(cargaProm), horizonte: Math.round(horizon * 100) / 100, ventaPorCliente: r0(ventaCli), netwinPorCliente: r0(netwinBrutoCli), promosPorCliente: r0(promosCli), promosPorClienteHoy: r0(promosCliHoy), netoPorCliente: r0(netoCli), pctRetirado: Math.round(wdRatio * 100), pctActivos: Math.round(activePct * 100), tasaReclamo: Math.round(tasaReclamo * 100), otrosPct: Math.round(otrosPct * 1000) / 10, capArs, restPct };
  const curvaInfo = { tramosObservados: curva.length, hastaDias: lastB ? lastB.hasta : 0, decaimientoMensual: Math.round(decayMes * 100) / 100, tramos: base.curva || [] };
  const promo = { cur, fut, promoNowPct: t.promosPct, promoNowPctNuevos: t.promosPctNuevos, promoNowPctRecurrentes: t.promosPctRecurrentes, promoFutPctCliente: ventaCli > 0 ? Math.round((promosCli / ventaCli) * 1000) / 10 : null, promoHoyPctCliente: ventaCli > 0 ? Math.round((promosCliHoy / ventaCli) * 1000) / 10 : null };
  // Explicación del cierre, paso a paso (lo que se guarda con el panorama)
  const E = [];
  E.push(`✅ BASE REAL (confirmado con los movimientos registrados, ${base.from} → ${base.to}, ${baseDays} días): invertiste ${money(t.spend || 0)} y entraron ${t.primerasCargas} clientes nuevos → costo por cliente ${cac ? money(cac) : '—'} (${cacOrigen}). DEPÓSITOS ${money(t.montoCargas)} (${t.cargas} cargas) − RETIROS ${money(t.montoRetiros)} (${Math.round(wdRatio * 100)}%) = VENTA (netwin) ${money(t.netwin)}. Regalos ${money(t.promosTotal)} (${t.promosPct ?? 0}% de los depósitos: a nuevos ${t.promosPctNuevos ?? 0}%, a los de antes ${t.promosPctRecurrentes ?? 0}%) → NETO (venta − regalos) ${money(t.netwinNeto)}.` + (t.spend > 0 ? ` Por cada ${F.usd ? 'US$ 1' : '$1'} invertido: ${t.ventaPorPeso} en depósitos y ${t.netoPorPeso} netos.` : ''));
  E.push(`CADA CLIENTE NUEVO de la base depositó ${money(montoPorCliente)} en ${cargasPorCliente} cargas (primera carga ${money(primeraCarga)}). Para ${days} días se toma ×${supuestos.horizonte} → ${money(ventaCli)} en depósitos, ${money(netwinBrutoCli)} de VENTA (netwin).`);
  E.push(`🔮 ESTIMACIÓN — REGALOS por cliente nuevo con las condiciones FUTURAS (bono 1ª carga ${fut.bonus1}% con tope ${money(capArs)} y ${restPct}% sobre el resto · ${fut.rec}% en cargas siguientes · reembolso ${fut.refund}% sobre lo perdido, que se cobra el ${supuestos.tasaReclamo}% · otros regalos ${supuestos.otrosPct}% de los depósitos): ${money(promosCli)} (hoy, con ${cur.bonus1}% / ${cur.rec}% / ${cur.refund}%, serían ${money(promosCliHoy)}). Queda NETO por cliente: ${money(netoCli)}.`);
  E.push(`INVERSIÓN ${money(spend)} en ${days} días a ${cac ? money(cac) : '—'} por cliente → ${b.clientesPorPauta} clientes por pauta + ${b.clientesOrganicos} orgánicos (ritmo de la base) = ${b.clientesNuevos} nuevos (panorama base). Depósitos de los nuevos ${money(b.montoCargas)}, VENTA (netwin) ${money(b.netwin)}, regalos ${money(b.promos)}, neto ${money(b.netwinNeto)}.`);
  E.push(`LA BASE ACTUAL: ${baseActual.clientes14} clientes que ya cargaban antes de los últimos 14 días depositaron ${money(recPorDia)} por día en esos 14 días → si siguen así, en ${days} días ${money(baseVenta)} en depósitos, VENTA (netwin) ${money(baseActual.netwin)}, regalos ${money(basePromos)} (con los % futuros), neto ${money(baseActual.neto)}.`);
  if (b.despues && lastB) E.push(`DESPUÉS DE LA INVERSIÓN (sin más pauta): la pauta trae ${b.despues.clientesPorDia} clientes por día (${b.despues.clientesTraidos} en ${days} días). Con la curva de retención real (medida hasta ${lastB.hasta} días de antigüedad; más allá decae ×${curvaInfo.decaimientoMensual} por mes), al terminar el período esos clientes depositan ${money(b.despues.ventaPorDiaAlFinal)} por día y dejan VENTA (netwin) de ${money(b.despues.netwinPorDiaAlFinal)} por día ≈ ${money(b.despues.netwinPorMesAlFinal)} por mes, con ${b.despues.activosAlFinal} activos. VENTA (netwin) mes 1 después: ${money(b.despues.meses[0].netwin)} · mes 2: ${money(b.despues.meses[1].netwin)} · mes 3: ${money(b.despues.meses[2].netwin)} · mes 6: ${money(b.despues.meses[5].netwin)}. Los 6 meses siguientes suman ${money(b.despues.seisMeses.venta)} en depósitos, VENTA (netwin) ${money(b.despues.seisMeses.netwin)}, regalos ${money(b.despues.seisMeses.regalos)}, neto ${money(b.despues.seisMeses.neto)}.`);
  else E.push('DESPUÉS DE LA INVERSIÓN: todavía no hay suficientes clientes con antigüedad para medir la curva de retención (hacen falta al menos 20 clientes por tramo).');
  E.push(`TOTAL DEL NEGOCIO en ${days} días (panorama base, estimado): depósitos ${money(b.total.venta)}, VENTA (netwin) ${money(b.total.netwin)}, regalos ${money(b.total.promos)}, neto ${money(b.total.neto)}. Resultado de la PAUTA (neto de los clientes por pauta − inversión): ${money(b.resultado)} (ROI ${b.roi ?? '—'}%). Resultado total (neto total − inversión): ${money(b.resultadoTotal)}. Panoramas bajo/alto: ±30 % en clientes nuevos.`);
  if (calib !== 1) E.push(`Ajuste por revisiones anteriores aplicado: ×${calib}.`);
  return { spend, days, calibration: calib, moneda: { cur: F.usd ? 'usd' : 'ars', usdRate: F.rate || null }, hoy, baseActual, promo, curva: curvaInfo, supuestos, bajo, base: b, alto, explicacion: E, aviso, nota: cac ? null : 'No hay costo por cliente nuevo: cargá el gasto total desde el inicio (o el de la base) o escribí el costo a mano. Mientras tanto sólo se proyecta lo orgánico y la base actual.' };
}

// Revisión de una proyección contra lo REAL: `real` = analyze() del tramo transcurrido. Prorratea lo proyectado a los días
// transcurridos y devuelve el factor real/proyectado por indicador y el global (clientes nuevos y netwin pesan más).
function review(snapshot, real, elapsedDays) {
  const p = snapshot.result && snapshot.result.base; if (!p) return null;
  const frac = Math.max(0.05, Math.min(1, elapsedDays / snapshot.params.days));
  const rows = [['clientesNuevos', 'Clientes nuevos', p.clientesNuevos * frac, real.totals.primerasCargas], ['cargas', 'Cargas', p.cargas * frac, real.totals.cargas], ['montoCargas', 'Venta de los nuevos', p.montoCargas * frac, real.totals.montoCargasNuevos != null ? real.totals.montoCargasNuevos : real.totals.montoCargas, true], ['netwin', 'NETWIN de los nuevos', p.netwin * frac, real.totals.netwinNuevos != null ? real.totals.netwinNuevos : real.totals.netwin, true], ['activosAlFinal', 'Clientes activos', p.activosAlFinal * frac, real.repeat.activos14]]
    .map(([key, label, proj, rl, isMoney]) => ({ key, label, proyectado: r0(proj), real: r0(rl), diffPct: proj > 0 ? Math.round(((rl - proj) / proj) * 1000) / 10 : null, factor: proj > 0 ? Math.round((rl / proj) * 100) / 100 : null, isMoney: !!isMoney }));
  const w = { clientesNuevos: 2, netwin: 2, cargas: 1, montoCargas: 1, activosAlFinal: 1 };
  const fs = rows.filter((r) => r.factor != null && isFinite(r.factor)); const factor = fs.length ? Math.round((fs.reduce((s, r) => s + r.factor * w[r.key], 0) / fs.reduce((s, r) => s + w[r.key], 0)) * 100) / 100 : null;
  return { reviewedAt: new Date().toISOString(), elapsedDays, fraction: Math.round(frac * 100), rows, factor: factor != null ? Math.max(0.2, Math.min(3, factor)) : null, lectura: factor == null ? 'Sin datos reales todavía.' : (factor >= 0.9 && factor <= 1.1 ? 'La proyección estuvo bien calibrada.' : (factor > 1.1 ? `La realidad superó lo proyectado (×${factor}): las próximas proyecciones se ajustan hacia arriba.` : `La realidad quedó por debajo de lo proyectado (×${factor}): las próximas proyecciones se ajustan hacia abajo.`)) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #499 CIERRE DIARIO DE LA BASE RETENIDA (owner): "analizar la venta de AYER sacando a los clientes nuevos, entendiendo lo que
// costó antes el cliente que dejó esa venta". Lógica:
//  • Día = ayer (hora argentina) o el que se elija. Cliente NUEVO = su primera carga real fue ESE día; RETENIDO = cargó ese día
//    pero su primera carga fue antes. La venta de los nuevos va aparte: lleva bono de 1ª carga y no dice nada de la retención.
//  • Para los retenidos: depósitos, retiros, VENTA (netwin = depósitos − retiros), regalos del día y NETO, abiertos por
//    antigüedad (días desde su primera carga).
//  • "Lo que costó antes": para esos mismos retenidos, su historia completa hasta ese día: costo de traerlos (clientes × costo
//    por cliente), depósitos/retiros de toda la vida, regalos de toda la vida → NETO histórico vs costo → si ya se pagaron.
//  • Serie de los últimos 30 días con venta de retenidos vs nuevos, para ver la tendencia de la base.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function dailyRetained(models, opts) {
  const { Transaction } = models;
  const F = fmt(opts); const money = F.money;
  const dayKey = opts.day ? dateKeyART(opts.day) : dateKeyART(new Date(Date.now() - DAY));
  const d0 = new Date(dayKey + 'T03:00:00.000Z'), d1 = new Date(d0.getTime() + DAY - 1);
  const s0 = new Date(d0.getTime() - 29 * DAY);
  const okStatus = { $nin: ['failed', 'cancelled'] };
  const realDep = { type: 'deposit', status: okStatus, 'metadata.source': { $nin: GIFT_SOURCES } };
  const realWd = { type: 'withdrawal', status: okStatus };
  const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: TZ } };
  const T = {}; let _tk = Date.now(); const lap = (k) => { T[k] = Date.now() - _tk; _tk = Date.now(); };
  // (1) primera carga de cada usuario (liviano: sin fechas sueltas)
  const firsts = await Transaction.aggregate([{ $match: realDep }, { $group: { _id: '$userId', un: { $first: '$username' }, first: { $min: '$timestamp' } } }]);
  const firstById = new Map(firsts.map((u) => [u._id, u.first])); const firstByName = new Map(firsts.map((u) => [String(u.un || '').toLowerCase(), u.first]));
  const firstOf = (userId, username) => firstById.get(userId) || (username ? firstByName.get(String(username).toLowerCase()) : null) || null;
  lap('firsts');
  // (2) últimos 30 días agrupados por día y usuario: depósitos, retiros y regalos
  const byDayUser = (match) => Transaction.aggregate([{ $match: { ...match, timestamp: { $gte: s0, $lte: d1 } } }, { $group: { _id: { d: dayExpr, u: '$userId', un: '$username' }, n: { $sum: 1 }, amt: { $sum: '$amount' } } }]);
  const [depDU, wdDU, prDU] = await Promise.all([byDayUser(realDep), byDayUser(realWd), byDayUser({ type: { $in: PROMO_TYPES }, status: okStatus })]);
  lap('30d');
  const isNewOn = (uid, un, dk) => { const f = firstOf(uid, un); return f ? dateKeyART(f) === dk : true; };
  const ageOn = (uid, un, dk) => { const f = firstOf(uid, un); return f ? Math.floor((new Date(dk + 'T03:00:00.000Z') - f) / DAY) : 0; };
  // Serie 30 días
  const S = {}; const row = () => ({ nuevos: new Set(), retenidos: new Set(), depN: 0, depR: 0, wdN: 0, wdR: 0, prN: 0, prR: 0 });
  for (let t = s0.getTime(); t <= d0.getTime(); t += DAY) S[dateKeyART(new Date(t + 12 * 3600000))] = row();
  const put = (arr, kind) => arr.forEach((x) => { const dk = x._id.d; if (!S[dk]) return; const r = S[dk]; const nw = isNewOn(x._id.u, x._id.un, dk); if (kind === 'dep') { (nw ? r.nuevos : r.retenidos).add(x._id.u || x._id.un); r[nw ? 'depN' : 'depR'] += x.amt; } else if (kind === 'wd') r[nw ? 'wdN' : 'wdR'] += x.amt; else r[nw ? 'prN' : 'prR'] += x.amt; });
  put(depDU, 'dep'); put(wdDU, 'wd'); put(prDU, 'pr');
  const serie = Object.keys(S).sort().map((dk) => { const r = S[dk]; const vR = r.depR - r.wdR, vN = r.depN - r.wdN; return { dia: dk, nuevos: r.nuevos.size, retenidos: r.retenidos.size, depositosRetenidos: r0(r.depR), retirosRetenidos: r0(r.wdR), ventaRetenidos: r0(vR), regalosRetenidos: r0(r.prR), netoRetenidos: r0(vR - r.prR), depositosNuevos: r0(r.depN), ventaNuevos: r0(vN), regalosNuevos: r0(r.prN), netoNuevos: r0(vN - r.prN) }; });
  const hoy = serie.find((x) => x.dia === dayKey) || serie[serie.length - 1];
  // Por antigüedad (sólo retenidos del día)
  const AGE = [[1, 7, '1–7 días'], [8, 14, '8–14 días'], [15, 30, '15–30 días'], [31, 60, '31–60 días'], [61, 90, '61–90 días'], [91, 100000, 'más de 90 días']];
  const A = AGE.map(([a0, a1, label]) => ({ tramo: label, a0, a1, clientes: new Set(), dep: 0, wd: 0, pr: 0 }));
  const bucket = (age) => A.find((b) => age >= b.a0 && age <= b.a1) || A[A.length - 1];
  const retIds = new Set();
  depDU.filter((x) => x._id.d === dayKey && !isNewOn(x._id.u, x._id.un, dayKey)).forEach((x) => { const b = bucket(ageOn(x._id.u, x._id.un, dayKey)); b.clientes.add(x._id.u || x._id.un); b.dep += x.amt; retIds.add(x._id.u); });
  wdDU.filter((x) => x._id.d === dayKey && !isNewOn(x._id.u, x._id.un, dayKey)).forEach((x) => { bucket(ageOn(x._id.u, x._id.un, dayKey)).wd += x.amt; });
  prDU.filter((x) => x._id.d === dayKey && !isNewOn(x._id.u, x._id.un, dayKey)).forEach((x) => { bucket(ageOn(x._id.u, x._id.un, dayKey)).pr += x.amt; });
  const porAntiguedad = A.map((b) => ({ tramo: b.tramo, clientes: b.clientes.size, depositos: r0(b.dep), retiros: r0(b.wd), venta: r0(b.dep - b.wd), regalos: r0(b.pr), neto: r0(b.dep - b.wd - b.pr), ventaPorCliente: b.clientes.size ? r0((b.dep - b.wd) / b.clientes.size) : null }));
  lap('dia');
  // (3) Historia completa de los retenidos que cargaron ese día: lo que costó traerlos y lo que dejaron hasta ese día
  const ids = Array.from(retIds).filter(Boolean);
  const life = async (match) => { const r = await Transaction.aggregate([{ $match: { ...match, userId: { $in: ids }, timestamp: { $lte: d1 } } }, { $group: { _id: null, amt: { $sum: '$amount' }, n: { $sum: 1 } } }]); return r[0] || { amt: 0, n: 0 }; };
  const [lDep, lWd, lPr] = ids.length ? await Promise.all([life(realDep), life(realWd), life({ type: { $in: PROMO_TYPES }, status: okStatus })]) : [{ amt: 0, n: 0 }, { amt: 0, n: 0 }, { amt: 0, n: 0 }];
  lap('historia');
  const cac = Number(opts.cac) > 0 ? Number(opts.cac) : null;
  const ventaHist = lDep.amt - lWd.amt, netoHist = ventaHist - lPr.amt, costo = cac ? cac * ids.length : null;
  const historico = { clientes: ids.length, costoPorCliente: cac, costoAdquisicion: costo != null ? r0(costo) : null, depositos: r0(lDep.amt), cargas: lDep.n, retiros: r0(lWd.amt), venta: r0(ventaHist), regalos: r0(lPr.amt), neto: r0(netoHist), resultado: costo != null ? r0(netoHist - costo) : null, netoPorCliente: ids.length ? r0(netoHist / ids.length) : null, vecesElCosto: costo > 0 ? Math.round((netoHist / costo) * 100) / 100 : null };
  // Promedios de la serie (sin el día elegido) para contextualizar
  const prev = serie.filter((x) => x.dia !== dayKey); const avg = (k) => (prev.length ? r0(prev.reduce((s, x) => s + x[k], 0) / prev.length) : 0);
  const promedio30 = { retenidos: avg('retenidos'), ventaRetenidos: avg('ventaRetenidos'), netoRetenidos: avg('netoRetenidos'), ventaNuevos: avg('ventaNuevos') };
  const dif = promedio30.ventaRetenidos ? Math.round(((hoy.ventaRetenidos - promedio30.ventaRetenidos) / Math.abs(promedio30.ventaRetenidos)) * 100) : null;
  const top = porAntiguedad.slice().sort((a, b) => b.venta - a.venta)[0];
  const lectura = [
    `El ${dayKey} cargaron ${hoy.retenidos + hoy.nuevos} clientes: ${hoy.nuevos} nuevos (primera carga ese día, quedan AFUERA del análisis) y ${hoy.retenidos} retenidos (ya cargaban de antes).`,
    `BASE RETENIDA ese día: depósitos ${money(hoy.depositosRetenidos)} − retiros ${money(hoy.retirosRetenidos)} = VENTA (netwin) ${money(hoy.ventaRetenidos)}; regalos ${money(hoy.regalosRetenidos)} → NETO ${money(hoy.netoRetenidos)}.` + (dif != null ? ` Contra el promedio de los 29 días anteriores (${money(promedio30.ventaRetenidos)} de venta retenida por día): ${dif >= 0 ? '+' : ''}${dif}%.` : ''),
    top && top.clientes ? `La antigüedad que más vendió fue ${top.tramo} (${top.clientes} clientes, ${money(top.venta)} de venta, ${money(top.ventaPorCliente)} por cliente).` : 'Sin ventas de retenidos ese día.',
    `LO QUE COSTÓ ANTES: esos ${historico.clientes} retenidos ` + (costo != null ? `costaron ${money(costo)} traerlos (${money(cac)} por cliente) y ` : '') + `recibieron ${money(historico.regalos)} en regalos en toda su vida; dejaron ${money(historico.venta)} de VENTA histórica → NETO histórico ${money(historico.neto)}` + (historico.resultado != null ? ` = ${historico.resultado >= 0 ? 'ya pagaron su costo ' + historico.vecesElCosto + ' veces' : 'todavía no cubren su costo (faltan ' + money(-historico.resultado) + ')'}.` : '.'),
    `Los nuevos de ese día (${hoy.nuevos}) dejaron ${money(hoy.ventaNuevos)} de venta y ${money(hoy.regalosNuevos)} de regalos: se miran aparte porque llevan bono de primera carga.`
  ];
  return { dia: dayKey, moneda: { cur: F.usd ? 'usd' : 'ars', usdRate: F.rate || null }, hoy, porAntiguedad, historico, promedio30, serie, lectura, timings: T };
}

// #500: números de UN día para el cierre automático (liviano: 3 agregaciones del día + primera carga sólo de los que cargaron).
async function dayTotals(models, dayKey) {
  const { Transaction, BankMovement, PendingPayout } = models;
  const d0 = new Date(dayKey + 'T03:00:00.000Z'), d1 = new Date(d0.getTime() + DAY - 1);
  const okStatus = { $nin: ['failed', 'cancelled'] };
  const realDep = { type: 'deposit', status: okStatus, 'metadata.source': { $nin: GIFT_SOURCES } };
  const inDay = { timestamp: { $gte: d0, $lte: d1 } };
  const [depU, wdU, prAgg] = await Promise.all([
    Transaction.aggregate([{ $match: { ...realDep, ...inDay } }, { $group: { _id: '$userId', n: { $sum: 1 }, amt: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: 'withdrawal', status: okStatus, ...inDay } }, { $group: { _id: '$userId', n: { $sum: 1 }, amt: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: { $in: PROMO_TYPES }, status: okStatus, ...inDay } }, { $group: { _id: null, amt: { $sum: '$amount' } } }])
  ]);
  // #501 lado BANCO: movimientos entrantes/salientes del banco (webhook) y retiros pagados por banco ese día
  let bankMovsIn = 0, bankMovsOut = 0, payoutsPaid = 0;
  try {
    if (BankMovement) {
      const bm = await BankMovement.aggregate([{ $match: { createdAt: { $gte: new Date(d0.getTime() - DAY), $lte: new Date(d1.getTime() + DAY) } } }, { $addFields: { dd: { $ifNull: ['$date', '$createdAt'] } } }, { $match: { dd: { $gte: d0, $lte: d1 }, status: { $nin: ['rejected', 'failed', 'cancelled', 'REJECTED', 'FAILED', 'CANCELLED'] } } }, { $group: { _id: '$direction', amt: { $sum: '$amount' }, n: { $sum: 1 } } }]);
      bm.forEach((x) => { if (String(x._id).toLowerCase() === 'inbound') bankMovsIn = x.amt; else if (String(x._id).toLowerCase() === 'outbound') bankMovsOut = x.amt; });
    }
    // #913: los pagados por BANCO EXTERNO (other_bank) no salieron de esta cuenta: no cuentan como salida del banco.
    if (PendingPayout) { const pp = await PendingPayout.aggregate([{ $match: { status: 'paid', paidAt: { $gte: d0, $lte: d1 }, paidVia: { $ne: 'other_bank' } } }, { $group: { _id: null, amt: { $sum: '$amount' } } }]); payoutsPaid = (pp[0] && pp[0].amt) || 0; }
  } catch (_) {}
  const ids = depU.map((x) => x._id).filter(Boolean);
  const firsts = ids.length ? await Transaction.aggregate([{ $match: { ...realDep, userId: { $in: ids } } }, { $group: { _id: '$userId', first: { $min: '$timestamp' } } }]) : [];
  const firstById = new Map(firsts.map((u) => [u._id, u.first]));
  const isNew = (uid) => { const f = firstById.get(uid); return !f || dateKeyART(f) === dayKey; };
  const depositos = depU.reduce((s, x) => s + x.amt, 0), cargas = depU.reduce((s, x) => s + x.n, 0);
  const retiros = wdU.reduce((s, x) => s + x.amt, 0), retirosN = wdU.reduce((s, x) => s + x.n, 0);
  const regalos = (prAgg[0] && prAgg[0].amt) || 0;
  const newSet = new Set(depU.filter((x) => isNew(x._id)).map((x) => x._id));
  const depN = depU.filter((x) => newSet.has(x._id)).reduce((s, x) => s + x.amt, 0), wdN = wdU.filter((x) => newSet.has(x._id)).reduce((s, x) => s + x.amt, 0);
  return { dateKey: dayKey, depositos: r0(depositos), cargas, cargadores: depU.length, retiros: r0(retiros), retirosN, venta: r0(depositos - retiros), regalos: r0(regalos), neto: r0(depositos - retiros - regalos), nuevos: newSet.size, retenidos: depU.length - newSet.size, ventaNuevos: r0(depN - wdN), ventaRetenidos: r0((depositos - depN) - (retiros - wdN)), bankMovsIn: r0(bankMovsIn), payoutsPaid: r0(payoutsPaid), bankInAuto: r0(bankMovsIn), bankOutAuto: r0(Math.max(bankMovsOut, payoutsPaid)) };
}

module.exports = { analyze, compare, project, review, dailyRetained, dayTotals, dateKeyART };
