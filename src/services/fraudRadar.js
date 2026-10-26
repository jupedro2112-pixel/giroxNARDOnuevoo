/**
 * fraudRadar — ALERTAS DE ESTAFA (#873, owner 2026-10-23).
 *
 * "Armá una sección en admin de alertas de usuarios que quieren estafar: detectar clientes que posiblemente quieran estafar, con los datos de lo
 * que hicieron para verificar el caso y poder bloquearles la cuenta, como usan las plataformas de primera línea, lo más completo posible".
 *
 * Igual que los sistemas antifraude de las casas de apuestas grandes: REGLAS que cruzan los datos (multicuenta por banco, dispositivo e IP,
 * cuentas de terceros, abuso de bonos, ciclos de carga y retiro, cuentas nuevas con retiros grandes) y suman un PUNTAJE de riesgo por cliente.
 * Cada regla deja la EVIDENCIA concreta (qué otras cuentas, qué CBU/CUIT, montos y fechas) para que una persona revise el caso y decida.
 * Nada se bloquea solo: el panel muestra el caso y el agente bloquea (o lo marca legítimo / en observación).
 *
 * Todo por agregaciones de Mongo sobre lo que ya guardamos (sin servicios externos): User, Transaction, PendingPayout, BankMovement.
 */
'use strict';

// Regalos = CASHBACK_GIFT_TX_TYPES de server.js sin las comisiones de referidos (no son bono).
const GIFT_TX = ['bonus', 'fire_reward', 'refund', 'rakeback', 'vip_levelup', 'roulette', 'install_gift', 'mission', 'review_gift'];
const DEP_EXCLUDE = ['install_bonus', 'welcome_gift', 'welcome_code', 'payout_refund'];
const tail = (s, n = 10) => String(s || '').replace(/\D/g, '').slice(-n);
const normName = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
// Dos nombres "son la misma persona" si comparten al menos dos palabras de 3+ letras (nombre + apellido), o uno contiene al otro.
function sameName(a, b) {
  const A = normName(a), B = normName(b); if (!A || !B) return true; if (A === B || A.includes(B) || B.includes(A)) return true;
  const wa = new Set(A.split(' ').filter((w) => w.length >= 3)); let n = 0; for (const w of B.split(' ')) if (w.length >= 3 && wa.has(w)) n++;
  return n >= 2;
}
const RULES = {
  cbu_dep_shared: { pts: 30, label: 'Carga desde una cuenta bancaria que usan OTROS clientes' },
  cbu_wd_shared: { pts: 35, label: 'Retira a una cuenta bancaria que usan OTROS clientes' },
  device_shared: { pts: 40, label: 'Mismo celular que otras cuentas' },
  phone_shared: { pts: 35, label: 'Mismo número de celular que otras cuentas' }, // #952
  third_party_payers: { pts: 20, label: 'Carga desde cuentas de varias personas distintas' },
  wd_other_person: { pts: 30, label: 'Retira a nombre de otra persona (distinta de la que carga)' },
  bonus_abuse: { pts: 25, label: 'Abuso de bonos: recibió mucho en regalos y retira enseguida' },
  no_play_withdraw: { pts: 35, label: 'Retira casi sin haber jugado (pasa la plata)' },
  new_big_wd: { pts: 10, label: 'Cuenta nueva pidiendo un retiro grande sin jugar' },
  fast_cycle: { pts: 15, label: 'Carga y retira enseguida (pasa la plata sin jugar)' },
  referral_farm: { pts: 30, label: 'Trajo referidos desde su MISMO celular (cuentas propias)' },
  flagged: { pts: 20, label: 'Ya marcado por el sistema anti-estafa' },
  no_phone: { pts: 5, label: 'Sin teléfono verificado' }
};
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

/**
 * Escanea a los clientes con movimiento en los últimos `days` días y devuelve las alertas ordenadas por puntaje.
 * deps: { User, Transaction, PendingPayout, BankMovement }
 */
async function scan(deps, opts = {}) {
  const { User, Transaction, PendingPayout, BankMovement } = deps;
  const days = Math.max(1, Math.min(180, Number(opts.days) || 30));
  const since = new Date(Date.now() - days * 86400000);
  const long = new Date(Date.now() - 180 * 86400000);

  // 1) Candidatos: cargaron, pidieron retiro o están marcados.
  const [depUsers, wdUsers, flaggedUsers] = await Promise.all([
    Transaction.distinct('userId', { type: 'deposit', createdAt: { $gte: since } }),
    PendingPayout.distinct('userId', { createdAt: { $gte: since } }),
    User.distinct('id', { fraudFlags: { $exists: true, $ne: [] } })
  ]);
  const ids = [...new Set([...depUsers, ...wdUsers, ...flaggedUsers].filter(Boolean))].slice(0, 5000);
  if (!ids.length) return { days, scanned: 0, alerts: [] };

  const users = await User.find({ id: { $in: ids }, role: 'user' })
    .select('id username createdAt phone phoneVerified isBlocked blockReason registrationIp fcmToken fcmTokens deviceIds lastDevice fraudFlags fraudReview referredByUserId acquisitionSource acquisitionCampaign withdrawalAccount').lean();
  const byId = new Map(users.map((u) => [u.id, u]));

  // 2) Plata por cliente (de por vida, 180 d): cargas reales, regalos, retiros pagados/pedidos.
  const [deps2, gifts, pays, bankIn] = await Promise.all([
    Transaction.aggregate([{ $match: { userId: { $in: ids }, type: 'deposit', createdAt: { $gte: long }, 'metadata.source': { $nin: DEP_EXCLUDE } } },
      { $group: { _id: '$userId', total: { $sum: '$amount' }, n: { $sum: 1 }, last: { $max: '$createdAt' }, first: { $min: '$createdAt' } } }]),
    Transaction.aggregate([{ $match: { userId: { $in: ids }, type: { $in: GIFT_TX }, createdAt: { $gte: long } } },
      { $group: { _id: '$userId', total: { $sum: '$amount' }, n: { $sum: 1 }, last: { $max: '$createdAt' } } }]),
    PendingPayout.find({ userId: { $in: ids }, createdAt: { $gte: long } }).select('userId username amount status cbu resolvedCbu titular lookupName createdAt paidAt').lean(),
    BankMovement.find({ matchedUserId: { $in: ids }, direction: { $ne: 'Outbound' }, createdAt: { $gte: long } }).select('matchedUserId fromCBU fromName fromCUIT amount date createdAt').lean()
  ]);
  const depBy = new Map(deps2.map((d) => [d._id, d])); const giftBy = new Map(gifts.map((g) => [g._id, g]));
  const payBy = new Map(); for (const p of pays) { if (!payBy.has(p.userId)) payBy.set(p.userId, []); payBy.get(p.userId).push(p); }
  const inBy = new Map(); for (const b of bankIn) { if (!inBy.has(b.matchedUserId)) inBy.set(b.matchedUserId, []); inBy.get(b.matchedUserId).push(b); }

  // 3) Cruces: CBU de carga, CBU de retiro, celular (token de notificaciones), IP de alta.
  const depCbus = [...new Set(bankIn.map((b) => tail(b.fromCBU)).filter((c) => c.length >= 10))];
  const wdCbus = [...new Set(pays.map((p) => tail(p.resolvedCbu || p.cbu)).filter((c) => c.length >= 10))];
  const [depCbuOthers, wdCbuOthers] = await Promise.all([
    depCbus.length ? BankMovement.aggregate([{ $match: { matchedUserId: { $ne: null }, fromCBU: { $in: bankIn.map((b) => b.fromCBU).filter(Boolean) } } }, { $group: { _id: '$fromCBU', users: { $addToSet: '$matchedUsername' } } }]) : [],
    wdCbus.length ? PendingPayout.aggregate([{ $match: { $or: [{ cbu: { $in: pays.map((p) => p.cbu).filter(Boolean) } }, { resolvedCbu: { $in: pays.map((p) => p.resolvedCbu).filter(Boolean) } }] } }, { $project: { username: 1, k: { $ifNull: ['$resolvedCbu', '$cbu'] } } }, { $group: { _id: '$k', users: { $addToSet: '$username' } } }]) : []
  ]);
  const depCbuMap = new Map(depCbuOthers.map((x) => [tail(x._id), x.users.filter(Boolean)]));
  const wdCbuMap = new Map(wdCbuOthers.map((x) => [tail(x._id), x.users.filter(Boolean)]));
  const tokens = []; for (const u of users) { if (u.fcmToken) tokens.push(u.fcmToken); for (const t of u.fcmTokens || []) if (t && t.token) tokens.push(t.token); }
  const devOthers = tokens.length ? await User.aggregate([{ $match: { $or: [{ fcmToken: { $in: tokens } }, { 'fcmTokens.token': { $in: tokens } }] } }, { $project: { username: 1, id: 1, t: { $concatArrays: [{ $cond: [{ $ifNull: ['$fcmToken', false] }, ['$fcmToken'], []] }, { $map: { input: { $ifNull: ['$fcmTokens', []] }, as: 'x', in: '$$x.token' } }] } } }, { $unwind: '$t' }, { $match: { t: { $in: tokens } } }, { $group: { _id: '$t', users: { $addToSet: '$username' } } }]) : [];
  const devMap = new Map(devOthers.map((x) => [x._id, x.users]));
  // #952 (owner): "el posible duplicado no por IP: por teléfono y por algo del celular". ID propio del celular (deviceIds, lo manda la app en
  // cada ping) y NÚMERO de teléfono (últimos 10 dígitos) compartidos con otras cuentas.
  const allDevIds = [...new Set(users.flatMap((u) => u.deviceIds || []).filter(Boolean))];
  const devIdOthers = allDevIds.length ? await User.aggregate([{ $match: { deviceIds: { $in: allDevIds } } }, { $unwind: '$deviceIds' }, { $match: { deviceIds: { $in: allDevIds } } }, { $group: { _id: '$deviceIds', users: { $addToSet: '$username' } } }]) : [];
  const devIdMap = new Map(devIdOthers.map((x) => [x._id, x.users]));
  const tel = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const myTels = [...new Set(users.map((u) => tel(u.phone)).filter((t) => t.length === 10))];
  const telOthers = myTels.length ? await User.find({ phone: { $exists: true, $nin: [null, ''] }, role: 'user' }).select('username phone').lean() : [];
  const telMap = new Map(); for (const o of telOthers) { const t = tel(o.phone); if (t.length === 10 && myTels.includes(t)) { if (!telMap.has(t)) telMap.set(t, new Set()); telMap.get(t).add(o.username); } }
  // (#877: sin cruce por IP en el escaneo — se repite mucho; la IP queda en el caso como dato)
  // Referidos de cada candidato (para "granja de referidos").
  const refs = await User.find({ referredByUserId: { $in: ids } }).select('username referredByUserId registrationIp fcmToken fcmTokens').lean();
  const refsBy = new Map(); for (const r of refs) { if (!refsBy.has(r.referredByUserId)) refsBy.set(r.referredByUserId, []); refsBy.get(r.referredByUserId).push(r); }

  // 3b) #877 (owner: "miralo sobre el JUEGO: cargar $5.000 y retirar $30.000 es apostar, no estafa"): cuánto APOSTÓ y ganó/perdió cada uno, de
  // la Partner API (stats batch, `deps.stats`). Sólo para quienes pidieron retirar (máx. 100 ⇒ un pedido agrupado): las consultas comparten el
  // cupo de 60/min con cargas y retiros. Sin stats (API caída) las reglas de juego no se evalúan (no se inventa nada).
  let play = new Map();
  if (typeof deps.stats === 'function') {
    const withWd = users.filter((u) => (payBy.get(u.id) || []).some((p) => !['cancelled', 'rejected'].includes(p.status))).map((u) => u.username).slice(0, 100);
    if (withWd.length) { try { play = (await deps.stats(withWd, new Date(Date.now() - Math.min(days, 90) * 86400000), new Date())) || new Map(); } catch (_) { play = new Map(); } }
  }

  // 4) Reglas por cliente.
  const alerts = [];
  for (const u of users) {
    if (u.fraudReview && u.fraudReview.status === 'legit') continue; // ya revisado y legítimo
    const R = [];
    const add = (key, evidence) => R.push({ key, pts: RULES[key].pts, label: RULES[key].label, evidence });
    const dep = depBy.get(u.id) || { total: 0, n: 0 }; const gift = giftBy.get(u.id) || { total: 0, n: 0 };
    const myPays = payBy.get(u.id) || []; const paid = myPays.filter((p) => p.status === 'paid'); const asked = myPays.filter((p) => !['cancelled', 'rejected'].includes(p.status));
    const wdTotal = asked.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const myIn = inBy.get(u.id) || [];
    const ageDays = u.createdAt ? (Date.now() - new Date(u.createdAt).getTime()) / 86400000 : 999;

    // Multicuenta por banco (carga)
    const cbuDepO = new Set(); for (const b of myIn) for (const o of depCbuMap.get(tail(b.fromCBU)) || []) if (o && o !== u.username) cbuDepO.add(o);
    if (cbuDepO.size) add('cbu_dep_shared', `Cuentas que cargaron desde el mismo CBU: ${[...cbuDepO].slice(0, 8).join(', ')}`);
    // Multicuenta por banco (retiro)
    const cbuWdO = new Set(); const myWdCbus = new Set(); for (const p of myPays) { const c = tail(p.resolvedCbu || p.cbu); if (c.length >= 10) myWdCbus.add(c); for (const o of wdCbuMap.get(c) || []) if (o && o !== u.username) cbuWdO.add(o); }
    if (cbuWdO.size) add('cbu_wd_shared', `Retiran al mismo CBU (…${[...myWdCbus][0] ? [...myWdCbus][0].slice(-6) : ''}): ${[...cbuWdO].slice(0, 8).join(', ')}`);
    // Mismo celular
    const devO = new Set(); const myTok = [u.fcmToken, ...(u.fcmTokens || []).map((t) => t && t.token)].filter(Boolean);
    for (const t of myTok) for (const o of devMap.get(t) || []) if (o && o !== u.username) devO.add(o);
    const devIdO = new Set(); for (const id of u.deviceIds || []) for (const o of devIdMap.get(id) || []) if (o && o !== u.username) devIdO.add(o);
    for (const o of devIdO) devO.add(o);
    if (devO.size) { const ld = u.lastDevice || {}; add('device_shared', `Mismo celular${ld.model ? ' (' + ld.model + (ld.os ? ' · ' + ld.os : '') + ')' : ''}${devIdO.size ? ' · ID del celular ' + String((u.deviceIds || []).slice(-1)[0] || '').slice(-6) : ' · token de notificaciones'} que: ${[...devO].slice(0, 8).join(', ')}`); }
    // Mismo número de teléfono (#952)
    const myTel = tel(u.phone); const telO = new Set(); if (myTel.length === 10) for (const o of telMap.get(myTel) || []) if (o && o !== u.username) telO.add(o);
    if (telO.size) add('phone_shared', `Mismo número (…${myTel.slice(-4)}) que: ${[...telO].slice(0, 8).join(', ')}`);
    // (#877: la IP NO suma — se repite muchísimo: wifi de la casa, datos del celular. Queda como dato en el caso.)
    // Cuentas de terceros (varias personas distintas le cargan)
    const payers = new Map(); for (const b of myIn) { const k = tail(b.fromCUIT, 11) || normName(b.fromName); if (k) payers.set(k, b.fromName || b.fromCUIT); }
    if (payers.size >= 3) add('third_party_payers', `${payers.size} titulares distintos le cargaron: ${[...payers.values()].slice(0, 6).join(' · ')}`);
    // Retira a nombre de otra persona
    const depNames = [...new Set(myIn.map((b) => b.fromName).filter(Boolean))];
    const wdNames = [...new Set(myPays.map((p) => p.lookupName || p.titular).filter(Boolean))];
    if (depNames.length && wdNames.length) {
      const other = wdNames.filter((w) => !depNames.some((d) => sameName(d, w)));
      if (other.length) add('wd_other_person', `Carga: ${depNames.slice(0, 3).join(' · ')} — Retira a: ${other.slice(0, 3).join(' · ')}`);
    }
    // JUEGO (#877): retirar más de lo cargado NO es alerta si apostó (ganó jugando). Sí lo es retirar casi sin haber apostado.
    const st = play.get(u.username) || null; const wag = st ? Math.round(Number(st.wagered) || 0) : null; const nw = st ? Math.round(Number(st.netwin) || 0) : null;
    const lowPlay = wag != null && wag < Math.max(5000, (dep.total + gift.total) * 1.0); // apostó menos de 1 vez lo que cargó + le regalaron
    if (wag != null && lowPlay && wdTotal >= Math.max(10000, dep.total * 0.8)) add('no_play_withdraw', `Pidió retirar ${money(wdTotal)} · cargó ${money(dep.total)} · apostó sólo ${money(wag)} en ${Math.min(days, 90)} días`);
    // Abuso de bonos: muchos regalos, pide retirar y JUGÓ poco (con juego real no es abuso: el rollover ya lo cubre)
    if (gift.total >= 5000 && dep.total > 0 && gift.total >= dep.total * 0.8 && wdTotal >= dep.total * 0.8 && (wag == null || wag < (dep.total + gift.total) * 2)) add('bonus_abuse', `Regalos ${money(gift.total)} (${gift.n}) vs cargas ${money(dep.total)} · pidió retirar ${money(wdTotal)}${wag != null ? ' · apostó ' + money(wag) : ''}`);
    // Cuenta nueva con retiro grande: sólo si casi no jugó
    const bigNew = asked.find((p) => p.amount >= 50000 && (new Date(p.createdAt) - new Date(u.createdAt)) / 86400000 <= 3);
    if (bigNew && (wag == null || lowPlay)) add('new_big_wd', `Retiro de ${money(bigNew.amount)} a las ${Math.max(0, Math.round((new Date(bigNew.createdAt) - new Date(u.createdAt)) / 3600000))} h de crear la cuenta${wag != null ? ' · apostó ' + money(wag) : ''}`);
    // Ciclo rápido carga → retiro (sin jugar)
    const cyc = myPays.find((p) => myIn.some((b) => { const t = new Date(b.date || b.createdAt).getTime(), w = new Date(p.createdAt).getTime(); return w > t && w - t <= 2 * 3600000 && Math.abs((Number(p.amount) || 0) - (Number(b.amount) || 0)) <= Math.max(2000, (Number(b.amount) || 0) * 0.15); }));
    if (cyc && (wag == null || lowPlay)) add('fast_cycle', `Retiro de ${money(cyc.amount)} menos de 2 h después de una carga parecida`);
    // Granja de referidos: SÓLO por el mismo celular (#877: la IP se repite mucho)
    const myRefs = refsBy.get(u.id) || [];
    const farm = myRefs.filter((r) => [r.fcmToken, ...(r.fcmTokens || []).map((t) => t && t.token)].filter(Boolean).some((t) => myTok.includes(t)));
    if (farm.length >= 1) add('referral_farm', `${farm.length} referido(s) desde su mismo celular: ${farm.slice(0, 8).map((r) => r.username).join(', ')}`);
    if ((u.fraudFlags || []).length) add('flagged', `Marcas: ${u.fraudFlags.join(', ')}`);
    if (!u.phoneVerified && R.length) add('no_phone', 'No verificó su celular por SMS');

    const score = R.reduce((a, r) => a + r.pts, 0);
    if (score < (Number(opts.minScore) || 30)) continue;
    alerts.push({
      userId: u.id, username: u.username, score, level: score >= 60 ? 'alto' : 'medio', reasons: R,
      isBlocked: !!u.isBlocked, blockReason: u.blockReason || null, review: u.fraudReview || null, ageDays: Math.round(ageDays),
      phoneVerified: !!u.phoneVerified, source: u.acquisitionSource || null, campaign: u.acquisitionCampaign || null,
      deposits: { n: dep.n, total: Math.round(dep.total) }, gifts: { n: gift.n, total: Math.round(gift.total) }, play: st ? { wagered: wag, netwin: nw } : null,
      withdrawals: { asked: asked.length, askedTotal: Math.round(wdTotal), paid: paid.length, paidTotal: Math.round(paid.reduce((a, p) => a + (Number(p.amount) || 0), 0)), pending: myPays.filter((p) => ['pending_review', 'pending', 'processing', 'failed'].includes(p.status)).length }
    });
  }
  alerts.sort((a, b) => (b.isBlocked === a.isBlocked ? 0 : (a.isBlocked ? 1 : -1)) || b.score - a.score);
  return { days, scanned: users.length, alerts: alerts.slice(0, 300) };
}

/** Caso completo de un cliente: movimientos, quién le cargó, a quién retira, celulares, IP, cuentas vinculadas. */
async function caseFile(deps, userId) {
  const { User, Transaction, PendingPayout, BankMovement } = deps;
  const u = await User.findOne({ id: userId }).select('id username createdAt lastLogin phoneVerified phone isBlocked blockReason blockedAt blockedBy registrationIp registrationUserAgent fcmToken fcmTokens fraudFlags fraudNotes fraudReview referredByUserId referralCode acquisitionSource acquisitionCampaign withdrawalAccount lastDevice').lean();
  if (!u) return null;
  const [txs, pays, ins, refs] = await Promise.all([
    Transaction.find({ $or: [{ userId }, { username: u.username }] }).sort({ createdAt: -1 }).limit(80).select('type amount bonus description createdAt platform metadata.source').lean(),
    PendingPayout.find({ userId }).sort({ createdAt: -1 }).limit(40).select('amount status titular lookupName cbu resolvedCbu alias createdAt paidAt paidBy error').lean(),
    BankMovement.find({ matchedUserId: userId }).sort({ createdAt: -1 }).limit(60).select('amount fromName fromCUIT fromCBU date createdAt matchStatus').lean(),
    User.find({ referredByUserId: userId }).select('username createdAt registrationIp isBlocked').limit(50).lean()
  ]);
  const devices = [...new Set([u.fcmToken, ...(u.fcmTokens || []).map((t) => t && t.token)].filter(Boolean))];
  const sameDevice = devices.length ? await User.find({ id: { $ne: userId }, $or: [{ fcmToken: { $in: devices } }, { 'fcmTokens.token': { $in: devices } }] }).select('username isBlocked createdAt').limit(30).lean() : [];
  const sameIp = u.registrationIp ? await User.find({ id: { $ne: userId }, registrationIp: u.registrationIp }).select('username isBlocked createdAt').limit(30).lean() : [];
  const cbus = [...new Set([...ins.map((b) => b.fromCBU), ...pays.map((p) => p.resolvedCbu || p.cbu)].filter(Boolean))];
  const sameBank = cbus.length ? [...new Set([
    ...(await BankMovement.find({ fromCBU: { $in: cbus }, matchedUserId: { $nin: [null, userId] } }).select('matchedUsername').limit(60).lean()).map((x) => x.matchedUsername),
    ...(await PendingPayout.find({ userId: { $ne: userId }, $or: [{ cbu: { $in: cbus } }, { resolvedCbu: { $in: cbus } }] }).select('username').limit(60).lean()).map((x) => x.username)
  ].filter(Boolean))] : [];
  const mask = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length > 6 ? '…' + d.slice(-6) : (c || ''); };
  return {
    user: { id: u.id, username: u.username, createdAt: u.createdAt, lastLogin: u.lastLogin, phoneVerified: !!u.phoneVerified, phone: u.phone ? String(u.phone).replace(/(\+\d{2})\d+(\d{3})$/, '$1•••$2') : null,
      isBlocked: !!u.isBlocked, blockReason: u.blockReason, blockedAt: u.blockedAt, blockedBy: u.blockedBy, registrationIp: u.registrationIp, registrationUserAgent: (u.registrationUserAgent || '').slice(0, 160),
      devices: devices.length, lastDevice: u.lastDevice || null, fraudFlags: u.fraudFlags || [], fraudNotes: (u.fraudNotes || []).slice(-10), review: u.fraudReview || null,
      source: u.acquisitionSource, campaign: u.acquisitionCampaign, referralCode: u.referralCode, savedAccount: u.withdrawalAccount ? { titular: u.withdrawalAccount.titular, cbu: mask(u.withdrawalAccount.cbu) } : null },
    deposits: ins.map((b) => ({ at: b.date || b.createdAt, amount: b.amount, payer: b.fromName, cuit: b.fromCUIT, cbu: mask(b.fromCBU), status: b.matchStatus })),
    withdrawals: pays.map((p) => ({ at: p.createdAt, amount: p.amount, status: p.status, titular: p.titular, realHolder: p.lookupName, cbu: mask(p.resolvedCbu || p.cbu), alias: p.alias, paidAt: p.paidAt, paidBy: p.paidBy, error: p.error })),
    transactions: txs.map((t) => ({ at: t.createdAt, type: t.type, amount: t.amount, bonus: t.bonus || 0, source: t.metadata && t.metadata.source, description: (t.description || '').slice(0, 120) })),
    linked: { sameDevice, sameIp, sameBank, referrals: refs }
  };
}

module.exports = { scan, caseFile, RULES };
