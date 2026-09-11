#!/usr/bin/env node
/**
 * test-cashback-spec.js — valida la implementación del reembolso acumulativo
 * contra la TABLA DE CASOS de docs/ESPEC-REEMBOLSO-1GIROX.md §7.
 *
 * Corre con `node` pelado (sin node_modules, sin Mongo, sin 1girox):
 *   node scripts/test-cashback-spec.js
 *
 * - Los casos de FÓRMULA (1-5, 8) y de PLEGADO (9) pegan directo contra
 *   src/utils/cashbackFormula.js, que es EXACTAMENTE lo que usa server.js
 *   (`_cashbackStateToday`).
 * - Los casos de RECLAMO (6 doble click, 7 timeout+reintento) no se pueden
 *   correr contra Mongo acá, así que se simulan con una "colección" en memoria
 *   con el índice único (userId, dateKey, seq) y una plataforma falsa que
 *   registra las references y responde `duplicate:true` a una repetida. El
 *   flujo simulado ESPEJA paso a paso el de `POST /api/cashback/claim`
 *   (server.js): guard 20s → reserva → guard 20s → acreditar → marcar/borrar.
 *   Si se cambia el flujo real, actualizar el espejo.
 */
const assert = require('assert');
const f = require('../src/utils/cashbackFormula');

const PCT = 5;
let passed = 0;
const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ---------- helper: mismo cálculo que _cashbackStateToday, sin DB ----------
function reclamable({ carryNet = 0, liveNet, localBefore = 0, localLive = 0, carryGranted = 0, liveGranted = 0, paidLife = 0, paidToday = 0, maxDailyArs = 0, minArs = 0, pct = PCT }) {
  const giftedLife = f.giftedLife({ localBefore, localLive, carryGranted, liveGranted });
  return f.computeReclamable({ pct, carryNet, liveNet, giftedLife, paidLife, paidToday, maxDailyArs, minArs });
}

// 1) Carga $20k, regalo $20k, pierde $40k, pct 5% → $1.000 (no $2.000)
caso('1. Carga $20k, regalo $20k, pierde $40k, pct 5% → reclamable $1.000 (no $2.000)', () => {
  // El netwin de la plataforma no distingue plata propia de bono: perdió 40k en
  // total. El regalo (20k) está en nuestra base (Transaction) y en el granted
  // oficial → se descuenta UNA vez (máximo tramo a tramo, no suma).
  const r = reclamable({ liveNet: 40000, localLive: 20000, liveGranted: 20000 });
  assert.strictEqual(r.lossLife, 20000);
  assert.strictEqual(r.reclamable, 1000);
  // Sin descontar el regalo daría 2000 — es justamente lo que NO queremos.
  assert.strictEqual(reclamable({ liveNet: 40000 }).reclamable, 2000);
});

// 2) Gana $10M, después pierde $4M → $0 (neto de por vida −6M)
caso('2. Gana $10M, después pierde $4M → $0 (neto de por vida −6M)', () => {
  // Ganancia consolidada en un tramo plegado (carryNet negativo) + pérdida viva.
  const r = reclamable({ carryNet: -10000000, liveNet: 4000000 });
  assert.strictEqual(r.lifeNet, -6000000);
  assert.strictEqual(r.lossLife, 0);
  assert.strictEqual(r.reclamable, 0);
  // Mismo resultado si todo cae en el tramo vivo (netwin = −10M + 4M).
  assert.strictEqual(reclamable({ liveNet: -6000000 }).reclamable, 0);
  // Recién cobra cuando pierde MÁS de los 10M ganados: 10M + 100k → 5% de 100k.
  assert.strictEqual(reclamable({ carryNet: -10000000, liveNet: 10100000 }).reclamable, 5000);
});

// 3) Pierde $100k, cobra $5k, pierde esos $5k → $0 (sin reembolso del reembolso)
caso('3. Pierde $100k, cobra $5k, pierde esos $5k → $0 (sin reembolso del reembolso)', () => {
  // Paso a paso: pierde 100k → reclamable 5000.
  assert.strictEqual(reclamable({ liveNet: 100000 }).reclamable, 5000);
  // Cobra 5000 (Transaction bonus/instant_cashback → regalado local +5000;
  // el /bonus también sube el granted oficial +5000). Queda en 0.
  assert.strictEqual(reclamable({ liveNet: 100000, localLive: 5000, liveGranted: 5000, paidLife: 5000 }).reclamable, 0);
  // Pierde esos 5000: netwin 105000 y regalado 5000 se cancelan → sigue en 0.
  const r = reclamable({ liveNet: 105000, localLive: 5000, liveGranted: 5000, paidLife: 5000 });
  assert.strictEqual(r.lossLife, 100000);
  assert.strictEqual(r.reclamable, 0);
});

// 4) Pierde $100k, cobra $5k, pierde $100k más → $5.000
caso('4. Pierde $100k, cobra $5k, pierde $100k más → $5.000', () => {
  // Continuación del caso 3: ya perdió los 5k del reembolso; ahora pierde
  // 100k MÁS de su plata → netwin 205k, regalado 5k → base 200k → 5% = 10k,
  // menos los 5k cobrados = 5.000.
  const r = reclamable({ liveNet: 205000, localLive: 5000, liveGranted: 5000, paidLife: 5000 });
  assert.strictEqual(r.lossLife, 200000);
  assert.strictEqual(r.reclamable, 5000);
  // Al reclamar esos 5000 vuelve EXACTO a 0 (y el nuevo cobro pasa a regalado).
  assert.strictEqual(reclamable({ liveNet: 205000, localLive: 10000, liveGranted: 10000, paidLife: 10000 }).reclamable, 0);
});

// 5) Regalo $20k bloqueado (no jugado), pierde $10k reales → $0 hasta perder > $20k
caso('5. Regalo $20k bloqueado (no jugado), pierde $10k reales → $0 hasta que pierda más de $20k', () => {
  // `granted` cuenta el bono OTORGADO aunque siga bloqueado (still_locked): se
  // descuenta completo. Conservador a propósito (§2.2 / §6).
  const r = reclamable({ liveNet: 10000, localLive: 20000, liveGranted: 20000 });
  assert.strictEqual(r.lossLife, 0);
  assert.strictEqual(r.reclamable, 0);
  // Perdió 20k exactos → todavía 0. Perdió 30k → 5% de los 10k que exceden el regalo.
  assert.strictEqual(reclamable({ liveNet: 20000, localLive: 20000, liveGranted: 20000 }).reclamable, 0);
  assert.strictEqual(reclamable({ liveNet: 30000, localLive: 20000, liveGranted: 20000 }).reclamable, 500);
});

// 8) Bono dado a mano en el panel de 1girox (no está en nuestra base) → igual se descuenta
caso('8. Bono dado a mano en el panel de 1girox (no está en nuestra base) → igual se descuenta (granted)', () => {
  // local = 0 (no lo vimos), granted = 20000 (lo vio la plataforma).
  const r = reclamable({ liveNet: 40000, localLive: 0, liveGranted: 20000 });
  assert.strictEqual(r.lossLife, 20000);
  assert.strictEqual(r.reclamable, 1000);
  // Y al revés (§3.5): regalo que fue como DEPÓSITO antes del 2026-09-07 —
  // granted no lo ve, la base local sí → también se descuenta.
  assert.strictEqual(reclamable({ liveNet: 40000, localLive: 20000, liveGranted: 0 }).reclamable, 1000);
  // Tramo a tramo (§3.3): local viejo 30k vs granted viejo 10k, local vivo 0 vs
  // granted vivo 5k → 30k + 5k = 35k (NO max(30k, 15k) = 30k).
  assert.strictEqual(f.giftedLife({ localBefore: 30000, localLive: 0, carryGranted: 10000, liveGranted: 5000 }), 35000);
});

// 9) 100 días desde el alta → plegado: un tramo de 60 días al carry, ancla avanza
caso('9. 100 días desde el alta → plegado: un tramo de 60 días al carry, ancla avanza', () => {
  const alta = new Date('2026-06-01T00:00:00-03:00');
  // El ancla nunca es anterior al arranque en 1girox (2026-07-31).
  const anchor0 = f.initialAnchor(alta);
  assert.strictEqual(anchor0.getTime(), f.STATS_EPOCH.getTime());

  const hoy = new Date(anchor0.getTime() + 100 * 86400000);
  assert.strictEqual(f.needsFold(anchor0, hoy), true);
  const plan = f.foldPlan(anchor0, hoy);
  assert.strictEqual(plan.chunks.length, 1, 'un solo tramo de 60 días');
  const c = plan.chunks[0];
  assert.strictEqual(c.from.getTime(), anchor0.getTime());
  assert.strictEqual((c.next.getTime() - anchor0.getTime()) / 86400000, 60, 'el ancla avanza 60 días');
  assert.strictEqual((c.next.getTime() - c.to.getTime()) / 86400000, 1, 'el tramo termina el día ANTERIOR a la ancla nueva (sin solaparse)');
  assert.strictEqual((hoy.getTime() - plan.anchor.getTime()) / 86400000, 40, 'tramo vivo de 40 días (< 92)');
  // Con 84 días no pliega; con 200 días pliega 2 tramos (80 vivo).
  assert.strictEqual(f.foldPlan(anchor0, new Date(anchor0.getTime() + 84 * 86400000)).chunks.length, 0);
  assert.strictEqual(f.foldPlan(anchor0, new Date(anchor0.getTime() + 200 * 86400000)).chunks.length, 2);
  // Y el neto de por vida se reconstruye igual: carry (tramo viejo) + vivo.
  // Ej.: perdió 50k en el tramo plegado y ganó 20k en el vivo → 30k → 1.500.
  assert.strictEqual(reclamable({ carryNet: 50000, liveNet: -20000 }).reclamable, 1500);
});

// Tope diario y mínimo (§3, última línea de la fórmula)
caso('Extra. Tope diario y mínimo para cobrar', () => {
  const r = reclamable({ liveNet: 2000000, maxDailyArs: 50000, paidToday: 30000 });
  assert.strictEqual(r.reclamable, 20000, 'tope − cobrado hoy');
  const m = reclamable({ liveNet: 5000, minArs: 300 });
  assert.strictEqual(m.reclamable, 250);
  assert.strictEqual(m.belowMin, true);
  assert.strictEqual(m.faltaParaMinimo, 50);
  // floor: 5% de 33.333 = 1666,65 → 1666
  assert.strictEqual(reclamable({ liveNet: 33333 }).reclamable, 1666);
});

// ---------- Simulación del RECLAMO (casos 6 y 7) ----------
// Espejo de POST /api/cashback/claim con una colección en memoria (índice único
// userId+dateKey+seq) y una plataforma falsa idempotente por reference.
function makeWorld({ reclamableAmount, platformBehaviour }) {
  const docs = []; // CashbackClaim en memoria
  const platform = { credited: [], calls: 0 };
  const now = () => Date.now();
  const col = {
    recent(userId, excludeId) {
      return docs.find((d) => d.userId === userId && d.id !== excludeId && d.createdAt >= now() - 20000) || null;
    },
    count(userId, dateKey) { return docs.filter((d) => d.userId === userId && d.dateKey === dateKey).length; },
    create(doc) {
      if (docs.some((d) => d.userId === doc.userId && d.dateKey === doc.dateKey && d.seq === doc.seq)) {
        const e = new Error('E11000 duplicate key'); e.code = 11000; throw e;
      }
      docs.push(doc); return doc;
    },
    delete(id) { const i = docs.findIndex((d) => d.id === id); if (i >= 0) docs.splice(i, 1); },
    paidLife(userId) { return docs.filter((d) => d.userId === userId).reduce((a, d) => a + d.amount, 0); }
  };
  // Plataforma: paga UNA vez por reference. `platformBehaviour(ref, nth)` puede
  // devolver 'timeout' para simular que acreditó pero la respuesta se perdió.
  function credit(ref) {
    platform.calls++;
    if (platform.credited.includes(ref)) return { success: true, duplicate: true };
    const beh = platformBehaviour ? platformBehaviour(ref, platform.calls) : 'ok';
    platform.credited.push(ref); // la plata YA se movió...
    if (beh === 'timeout') throw new Error('ETIMEDOUT'); // ...pero no nos enteramos
    return { success: true, duplicate: false };
  }
  let seqCounter = 0;
  // ESPEJO del handler (mismo orden de pasos que server.js).
  async function claim(userId, dateKey) {
    const st = { reclamable: Math.max(0, reclamableAmount - col.paidLife(userId)) }; // pendientes cuentan como cobrado
    const amount = st.reclamable;
    if (!(amount > 0)) return { status: 400 };
    if (col.recent(userId, null)) return { status: 409, why: 'recent-pre' };
    let doc = null;
    for (let attempt = 0; attempt < 2 && !doc; attempt++) {
      const seq = col.count(userId, dateKey);
      try { doc = col.create({ id: 'c' + (++seqCounter), userId, dateKey, seq, amount, createdAt: now(), status: 'pending' }); }
      catch (e) { if (e.code !== 11000) throw e; }
    }
    if (!doc) return { status: 409, why: 'no-seq' };
    await new Promise((r) => setImmediate(r)); // cede el turno (simula I/O)
    if (col.recent(userId, doc.id)) { col.delete(doc.id); return { status: 409, why: 'concurrent' }; }
    const ref = `vip-cbk-${userId}-${dateKey}-${doc.seq}`;
    let res;
    try { res = credit(ref); } catch (e) { res = { success: false, error: e.message }; }
    if (!res.success) { col.delete(doc.id); return { status: 502, ref }; }
    doc.status = 'credited';
    return { status: 200, ref, duplicate: !!res.duplicate, amount };
  }
  return { claim, platform, docs, col };
}

caso('6. Doble click en RECLAMAR → un solo pago (índice único + reference idempotente)', async () => {
  // Dos requests "a la vez" (mismo tick): sólo una puede terminar pagando.
  const w = makeWorld({ reclamableAmount: 5000 });
  const [a, b] = await Promise.all([w.claim('u1', '2026-09-11'), w.claim('u1', '2026-09-11')]);
  const oks = [a, b].filter((r) => r.status === 200);
  assert.ok(oks.length <= 1, 'nunca dos pagos');
  assert.strictEqual(w.platform.credited.length, oks.length, 'la plataforma pagó exactamente lo que se marcó credited');
  // Dos requests secuenciales (doble click con ~100ms entre medio): la segunda
  // ve el reclamo pending/credited (cobrado) y/o el guard de 20s → no paga.
  const w2 = makeWorld({ reclamableAmount: 5000 });
  const r1 = await w2.claim('u1', '2026-09-11');
  const r2 = await w2.claim('u1', '2026-09-11');
  assert.strictEqual(r1.status, 200);
  assert.notStrictEqual(r2.status, 200);
  assert.strictEqual(w2.platform.credited.length, 1);
  assert.deepStrictEqual(w2.platform.credited, ['vip-cbk-u1-2026-09-11-0']);
});

caso('7. Timeout de la API al acreditar, reintento → un solo pago (duplicate:true)', async () => {
  // 1ª llamada: la plataforma acredita pero la respuesta se pierde (timeout).
  // El handler borra la reserva → el reintento recalcula el MISMO seq → MISMA
  // reference → la plataforma responde duplicate:true y no vuelve a pagar.
  const w = makeWorld({ reclamableAmount: 5000, platformBehaviour: (ref, nth) => (nth === 1 ? 'timeout' : 'ok') });
  const r1 = await w.claim('u1', '2026-09-11');
  assert.strictEqual(r1.status, 502);
  assert.strictEqual(w.docs.length, 0, 'la reserva se liberó para poder reintentar');
  assert.strictEqual(w.platform.credited.length, 1, 'la plata ya se movió una vez');
  // (el reintento del usuario llega después de los 20s del guard)
  w.docs.forEach((d) => { d.createdAt -= 30000; });
  const r2 = await w.claim('u1', '2026-09-11');
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.ref, r1.ref, 'misma reference en el reintento');
  assert.strictEqual(r2.duplicate, true, 'la plataforma dedupe');
  assert.strictEqual(w.platform.credited.length, 1, 'UN solo pago');
  assert.strictEqual(w.platform.calls, 2);
});

(async () => {
  for (const c of casos) {
    try {
      await c.fn();
      passed++;
      console.log(`✅ ${c.nombre}`);
    } catch (e) {
      console.log(`❌ ${c.nombre}\n   ${e.message}`);
    }
  }
  console.log(`\n${passed}/${casos.length} casos OK`);
  process.exit(passed === casos.length ? 0 : 1);
})();
