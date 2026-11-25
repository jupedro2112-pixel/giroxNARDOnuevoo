// #238 (réplica #236–#239 de CARGASGIROXactivo) Regalo con rollover a un jugador que ya tiene un bono activo: por defecto se UNIFICA (un bono nuevo por
// viejo + regalo, con rollover) — nunca como depósito, que 1girox muestra como Carga. En frío: se simula la API de 1girox.   node scripts/test-gift-fallback.js
const assert = require('assert');
const path = require('path');
const Module = require('module');
process.env.GIROX_API_URL = 'https://api.prueba.test/v1'; process.env.GIROX_API_KEY = 'k-prueba'; delete process.env.GIROX_GIFT_AS_BONUS;
const calls = [];
const state = { bonusLocked: 0, cfg: { bonus: { enabled: true, standalone_enabled: true, multipliers: [0, 3, 5], fixed_min: 2, fixed_max: 500000 } }, bonusFail: null };
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'axios') {
    return async ({ method, url, data }) => {
      const p = url.replace(process.env.GIROX_API_URL, ''); const m = String(method).toLowerCase();
      calls.push({ m, p, data });
      if (m === 'get' && p === '/config') return { status: 200, data: state.cfg };
      if (m === 'get' && /^\/players\/[^/]+$/.test(p)) return { status: 200, data: { player: { username: 'jug', balance: 1000, wagering: { available: 1000, locked: state.bonusLocked, bonus_locked: state.bonusLocked, claimable_total: state.claimable || 0 } } } };
      if (m === 'post' && /\/bonus$/.test(p)) {
        if (state.bonusFail && data.multiplier > 0) { const e = new Error('422'); e.response = { status: state.bonusStatus || 422, data: { error: { code: state.bonusFail, message: 'x' }, code: state.bonusFail } }; throw e; }
        // saldo antes = 1000. Con multiplier > 0, 1girox debita el resto del bono viejo y acredita el nuevo.
        const after = data.multiplier > 0 ? 1000 - (state.noDebit ? 0 : state.bonusLocked) + data.amount : 1000 + data.amount;
        return { status: 200, data: { balance: after, operation: { ledger_id: 77, reference: data.reference, type: 'bonus' } } };
      }
      if (m === 'post' && /\/deposit$/.test(p)) return { status: 200, data: { operation: { ledger_id: 88, reference: data.reference, type: 'deposit' } } };
      return { status: 200, data: {} };
    };
  }
  if (/utils\/logger$/.test(req)) return { warn() {}, info() {}, error() {}, debug() {} };
  return origLoad.call(this, req, parent, ...rest);
};
const girox = require(path.join(__dirname, '..', 'src/services/giroxService'));
let mode = undefined;
girox.setRolloverResolver(async () => 3);          // rollover GLOBAL x3 encendido
girox.setGiftFallbackResolver(async () => mode);
const anomalies = [];
girox.setGiftMergeAnomalyHook((a) => anomalies.push(a));
const posts = () => calls.filter((c) => c.m === 'post').map((c) => c.p.split('/').pop() + (c.data.multiplier != null ? ':x' + c.data.multiplier : ''));
const reset = (o) => { calls.length = 0; anomalies.length = 0; Object.assign(state, { bonusLocked: 0, bonusFail: null, bonusStatus: 422, claimable: 0, noDebit: false }, o || {}); };

(async () => {
  let n = 0; const ok = (t) => { n++; console.log('  ✅ ' + t); };

  reset(); mode = undefined;
  let r = await girox.creditUserBalance('jug', 1000, 'vip-rf-1');
  assert.ok(r.success); assert.deepStrictEqual(posts(), ['bonus:x3']); assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(r.rolloverApplied, 3);
  ok('sin bono activo: sale como bono con el rollover global (igual que antes)');

  // ---- UNIFICAR (default) ----
  reset({ bonusLocked: 5000 }); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2');
  assert.ok(r.success); assert.deepStrictEqual(posts(), ['bonus:x3'], 'un solo bono, nunca /deposit');
  let b = calls.filter((c) => c.m === 'post')[0].data;
  assert.strictEqual(b.amount, 6000, 'bono nuevo = resto del viejo (5000) + regalo (1000)'); assert.strictEqual(b.reference, 'vip-rf-2');
  assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(r.rolloverApplied, 3); assert.strictEqual(r.mergedOld, 5000); assert.strictEqual(r.mergedTotal, 6000);
  assert.strictEqual(anomalies.length, 0);
  ok('jugador CON bono activo: se UNIFICA — bono nuevo por viejo + regalo, con rollover, sin depósito');

  reset({ bonusLocked: 5000 }); mode = 'merge';
  r = await girox.creditGift('jug', 500, { rolloverX: 5, reference: 'vip-roulette-1', description: 'Premio ruleta' });
  b = calls.filter((c) => c.m === 'post')[0].data;
  assert.deepStrictEqual(posts(), ['bonus:x3']); assert.strictEqual(b.amount, 5500); assert.ok(/bono anterior/.test(b.description));
  ok('ruleta / fueguito (creditGift) con bono activo: también unifica');

  reset({ bonusLocked: 5000, noDebit: true }); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2b');
  assert.ok(r.success); assert.strictEqual(anomalies.length, 1); assert.strictEqual(anomalies[0].gained, 6000); assert.strictEqual(anomalies[0].old, 5000);
  ok('control: si 1girox NO debita el bono viejo (el saldo sube de más) → avisa para apagar la unificación');

  reset({ bonusLocked: 5000, claimable: 300 }); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2c');
  assert.deepStrictEqual(posts(), ['deposit:x3']); assert.strictEqual(r.creditedAs, 'deposit');
  assert.ok(/^BONO \(contar como BONO, NO como carga\): /.test(calls.filter((c) => c.m === 'post')[0].data.description), '#238 la descripción avisa que es un bono');
  ok('tiene un bono cumplido sin reclamar: no se unifica → depósito con rollover (queda marcado)');

  reset({ bonusLocked: 499500 }); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2d');
  assert.deepStrictEqual(posts(), ['deposit:x3']);
  ok('unificado superaría el máximo de bono de la plataforma: depósito con rollover');

  reset({ bonusLocked: 40 }); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2e');
  assert.deepStrictEqual(posts(), ['bonus:x3']); assert.strictEqual(calls.filter((c) => c.m === 'post')[0].data.amount, 1000); assert.strictEqual(r.mergedOld, undefined);
  ok('resto de bono mínimo (hasta $50): bono normal, como siempre');

  reset({ bonusLocked: 5000 }); mode = 'bonus0';
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-2f');
  assert.deepStrictEqual(posts(), ['bonus:x0']); assert.strictEqual(r.rolloverApplied, 0);
  ok('opción del panel "bono sin rollover": sale como bono 0');

  reset({ bonusLocked: 5000 }); mode = 'deposit';
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-3');
  assert.ok(r.success); assert.deepStrictEqual(posts(), ['deposit:x3']); assert.strictEqual(r.creditedAs, 'deposit'); assert.strictEqual(r.rolloverApplied, 3); assert.ok(r.fallbackReason);
  ok('opción del panel "depósito con rollover": se comporta como antes y avisa que fue depósito');

  reset({ bonusFail: 'bonus_out_of_range' }); mode = 'bonus0';
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-4');
  assert.ok(r.success); assert.deepStrictEqual(posts(), ['bonus:x3', 'bonus:x0']); assert.strictEqual(r.creditedAs, 'bonus');
  assert.strictEqual(calls.filter((c) => c.m === 'post')[0].data.reference, calls.filter((c) => c.m === 'post')[1].data.reference, 'misma reference en los dos intentos');
  ok('la plataforma rechaza el bono con rollover: reintenta como bono sin rollover con la MISMA reference');

  reset({ bonusLocked: 5000 }); mode = 'bonus0';
  r = await girox.creditUserBalance('jug', 1, 'vip-rf-5', { description: 'Reembolso diario (2026-11-25)' });
  assert.ok(r.success); assert.deepStrictEqual(posts(), ['deposit']); assert.strictEqual(r.creditedAs, 'deposit');
  assert.ok(/contar como BONO.*Reembolso diario.*limitación de la API/.test(calls.filter((c) => c.m === 'post')[0].data.description));
  ok('único caso que sigue yendo a depósito: monto fuera de lo que 1girox acepta como bono (ej. $1) — queda marcado');

  reset(); mode = undefined;
  r = await girox.creditUserBalance('jug', 1000, 'vip-payoutref-bonus-1', { ignoreGlobalRollover: true });
  assert.deepStrictEqual(posts(), ['bonus:x0']);
  ok('devolución / comisión (sin rollover global): no cambia');

  reset({ bonusLocked: 5000, bonusFail: 'conflict', bonusStatus: 409 }); mode = undefined; // respuesta que NO es un rechazo de negocio conocido
  r = await girox.creditUserBalance('jug', 1000, 'vip-rf-6', { description: 'x' });
  assert.strictEqual(r.success, false); assert.strictEqual(posts().length >= 1 && posts().every((p) => p === 'bonus:x3'), true, 'nunca cambia de vía sin un rechazo de negocio claro');
  ok('respuesta no concluyente al unificar: se devuelve tal cual (sin depósito ni bono 0) — el caller reintenta con la MISMA reference');

  // ---- cableado de server.js y servicios (estático: no hay node_modules para levantar el server) ----
  const fs = require('fs');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const vip = fs.readFileSync(path.join(__dirname, '..', 'src/services/vipLevelService.js'), 'utf8');
  const referral = fs.readFileSync(path.join(__dirname, '..', 'src/services/referralPayoutService.js'), 'utf8');
  assert.ok(/girox\.setGiftFallbackResolver\(/.test(server) && /girox\.setGiftMergeAnomalyHook\(/.test(server));
  assert.ok(/fallback: 'deposit', mergeOffAt/.test(server), 'la anomalía apaga la unificación (vuelve a depósito)');
  ok('server.js inyecta el modo del panel y el apagado automático por anomalía');

  const fire = server.slice(server.indexOf('async function _creditFireReward('), server.indexOf("app.get('/api/fire/status'"));
  assert.ok(/girox\.creditGift\(username, amount, \{ rolloverX: mult, reference: ref, description: desc \}\)/.test(fire));
  assert.ok(!/depositToUser\(|creditUserBalance\(/.test(fire), 'el fueguito ya no tiene su propia caída a depósito');
  ok('fueguito: delega en creditGift (misma reference, sin caída a depósito propia)');

  assert.strictEqual((server.match(/\.\.\._giftMeta\(depositResult\)/g) || []).length, 3, 'reembolso semanal, mensual y rakeback');
  assert.strictEqual((server.match(/\.\.\._giftMetaFields\((credit|bonusResult)\)/g) || []).length, 3, 'reembolso en vivo, fueguito y ruleta');
  assert.ok(/mergedBonus: Number\(r\.mergedOld\)/.test(vip));
  ok('las Transactions de regalo guardan creditedAs / mergedBonus');

  assert.ok(/giftsAsDeposit, giftsAsDepositCount/.test(server) && /mergedBonus, mergedBonusCount/.test(server));
  ok('resumen de Transacciones: giftsAsDeposit y mergedBonus');

  const descs = [/description: `REEMBOLSO semanal del /, /description: `REEMBOLSO mensual del /, /description: `REEMBOLSO EN VIVO — /, /description: `REGALO — Rakeback semanal VIP del /,
    /description: `BONO manual — /, /description: 'BONO — Bono sorpresa por el código de bienvenida/, /`REGALO — Fueguito \(racha diaria\): /, /description: `REGALO — Fichas de regalo del lote/,
    /description: 'DEVOLUCIÓN de retiro rechazado — /];
  assert.deepStrictEqual(descs.filter((re) => !re.test(server)).map(String), []);
  assert.strictEqual((server.match(/description: `REGALO — Premio de la ruleta diaria: /g) || []).length, 2, 'giro y reintento del panel');
  assert.ok(/description: `BONO — Premio por alcanzar el nivel VIP /.test(vip) && /description: `COMISIÓN de referidos — /.test(referral));
  ok('toda acreditación manda a 1girox una descripción que empieza con el TIPO');

  assert.ok(/vip-payoutref-bonus-\$\{payout\.id\}`, \{ ignoreGlobalRollover: true, description: /.test(server) && /COMISIÓN de referidos[^\n]*ignoreGlobalRollover: true/.test(referral));
  assert.ok(/^\s*description,\s*$/m.test(referral) && /const description = `Ganancias por referidos - /.test(referral), 'la descripción LOCAL de la comisión no cambia');
  ok('devolución de retiro y comisión de referidos: siguen SIN rollover global; el texto local no cambia');

  console.log('\n✅ Todo OK (' + n + ')');
})().catch((e) => { console.error('❌ ' + (e && e.stack || e)); console.error(JSON.stringify(calls.slice(-6))); process.exit(1); });
