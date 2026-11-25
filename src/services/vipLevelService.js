/**
 * vipLevelService.js — Motor de NIVELES VIP: acumula el apostado por mes y
 * sube de nivel (con bono) a quien cruza un umbral. Ver src/utils/vipLevels.js.
 *
 * CÓMO ACUMULA (diseño anti-doble-conteo, seguro en multi-instancia):
 *   La Partner API no tiene "apostado histórico" — sólo stats por rango (≤92 días).
 *   Por eso el acumulado se arma con buckets mensuales (VipWagerMonth): cada sync
 *   pide a la plataforma el apostado del MES (batch de hasta 100 usuarios por
 *   request) y lo escribe con $set — recalcular es idempotente, dos instancias
 *   pisándose escriben lo mismo. lifetimeWagered = suma de los buckets, y se
 *   actualiza con $max (nunca baja, ni con datos parciales).
 *
 * DOS MODOS:
 *   - 'tick' (cada ~30 min): refresca SOLO el mes corriente de los usuarios
 *     activos recientes (VIP_ACTIVE_DAYS, default 3) — barato en requests.
 *   - 'sweep' (1 vez por día, instancia única vía claim en Config): TODOS los
 *     usuarios; además cierra los meses pasados que falten desde VIP_WAGER_EPOCH
 *     (default 2026-07, cuando arrancó 1girox) → es el backfill automático:
 *     no hace falta ningún script aparte.
 *
 * BONO DE NIVEL: reference `vip-lvl-{userId}-{idx}` — idempotente PARA SIEMPRE en
 * la plataforma. Orden a propósito: primero acreditar, después avanzar
 * User.vipLevel. Si el crédito falla, el nivel no avanza y el próximo sync
 * reintenta CON LA MISMA reference (jamás paga dos veces; `duplicate:true`
 * indica que otra instancia ya lo pagó → no se re-notifica).
 *
 * Kill switch: flag `vip_levels_disabled` en Config, editable desde el panel
 * (sección Config, SOLO admin general — POST /api/admin/vip-levels). Se lee de la
 * base en cada tick/request a propósito (sin cache): con multi-instancia en EB, un
 * cache haría que el apagado tarde el TTL en llegar a las otras instancias — misma
 * razón por la que getConfig no cachea (ver WORKLOG #91). Apagarlo NO pierde datos:
 * al reactivar, el sweep recalcula los meses con $set y el acumulado se pone al día.
 */

const { v4: uuidv4 } = require('uuid');
const { getPeriodRange } = require('../utils/periodKey');

const AR_TZ = 'America/Argentina/Buenos_Aires';
const DEFAULT_EPOCH = '2026-07'; // primer mes con datos en 1girox (migración 2026-07-31)
const BATCH_SIZE = 100; // límite del POST /players/stats/batch
const DISABLED_KEY = 'vip_levels_disabled';

/**
 * ¿Los niveles VIP están apagados? Lee el flag de la base (default: ENCENDIDOS).
 * Ante error de DB devuelve false: mejor un tick de más que congelar los niveles
 * por un hipo de conexión.
 */
async function isDisabled(Config) {
  try {
    const doc = await Config.findOne({ key: DISABLED_KEY }).select('value').lean();
    return !!(doc && doc.value === true);
  } catch (e) {
    return false;
  }
}

function _epochMonthKey() {
  const e = String(process.env.VIP_WAGER_EPOCH || '').trim();
  return /^\d{4}-\d{2}$/.test(e) ? e : DEFAULT_EPOCH;
}

function _activeDays() {
  const d = Number(process.env.VIP_ACTIVE_DAYS);
  return Number.isFinite(d) && d > 0 ? d : 3;
}

/** Apostado que cuenta para el nivel. Default: SOLO casino (misma decisión que los
 *  reembolsos: sports afuera). VIP_WAGER_SCOPE=total lo incluye todo. */
function _scopedWagered(stats) {
  if (!stats) return 0;
  if (process.env.VIP_WAGER_SCOPE === 'total') return Number(stats.wagered) || 0;
  const casino = stats.categories && stats.categories.casino;
  return Number(casino && casino.wagered) || 0;
}

/** 'YYYY-MM' de una fecha, en hora ARGENTINA (el server puede correr en UTC). */
function monthKeyAR(date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(date);
  const y = p.find((x) => x.type === 'year').value;
  const m = p.find((x) => x.type === 'month').value;
  return `${y}-${m}`;
}

/** 'YYYY-MM-DD' de una fecha, en hora ARGENTINA (para el claim diario del sweep). */
function todayStrAR(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

/** Hora (0-23) en Argentina — para que el sweep corra en la madrugada. */
function hourAR(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: AR_TZ, hour: '2-digit', hour12: false })
    .format(date));
}

/** Lista de monthKeys desde `fromKey` hasta `toKey` inclusive. */
function listMonthKeys(fromKey, toKey) {
  const out = [];
  let [y, m] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Claim atómico del sweep diario: sólo UNA instancia por día lo gana (el índice
 * único de Config.key es la barrera). Perderlo no es error: otra instancia ya
 * está barriendo.
 */
async function claimDailySweep(Config, todayStr) {
  try {
    await Config.findOneAndUpdate(
      { key: 'vip_sweep_day', value: { $ne: todayStr } },
      { $set: { value: todayStr } },
      { upsert: true }
    );
    return true;
  } catch (e) {
    if (e && e.code === 11000) return false; // otra instancia ganó el claim de hoy
    throw e;
  }
}

/**
 * Corre una pasada de sincronización.
 *
 * @param {object} deps
 *   mode: 'tick' | 'sweep'
 *   girox, vipLevels, logger
 *   models: { User, VipWagerMonth, Transaction, Config }
 *   notifyLevelUp: async (userLean, level) => void  — avisa al cliente (chat+push).
 *     Sólo se llama cuando ESTA instancia pagó el bono (no en duplicate).
 * @returns resumen para logs
 */
async function runSync(deps) {
  const { mode, girox, models, logger } = deps;
  const { User } = models;

  if (await isDisabled(models.Config)) return { skipped: 'disabled' };
  if (!girox.isEnabled()) return { skipped: 'girox-off' };

  const now = new Date();
  const curKey = monthKeyAR(now);

  const filter = { role: 'user' };
  if (mode === 'tick') {
    filter.lastLogin = { $gte: new Date(now.getTime() - _activeDays() * 24 * 60 * 60 * 1000) };
  }

  const users = await User.find(filter)
    .select('id username vipLevel giroxUserId createdAt')
    .lean();

  const summary = { mode, users: users.length, buckets: 0, closed: 0, levelUps: 0, errors: 0 };
  if (users.length === 0) return summary;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const chunk = users.slice(i, i + BATCH_SIZE);
    try {
      await _syncChunk(chunk, { ...deps, now, curKey, summary });
    } catch (e) {
      summary.errors += 1;
      logger.error(`[vip] chunk ${i / BATCH_SIZE} (${mode}): ${e.message}`);
    }
  }

  return summary;
}

async function _syncChunk(chunk, ctx) {
  const { mode, girox, models, logger, now, curKey, summary } = ctx;
  const { VipWagerMonth } = models;

  const byLower = new Map(chunk.map((u) => [String(u.username).toLowerCase(), u]));
  const usernames = chunk.map((u) => u.username);

  // 1) Mes CORRIENTE (siempre): desde el día 1 hasta ahora.
  const curRange = getPeriodRange(curKey);
  const curRes = await girox.getPlayersStatsBatch(usernames, curRange.fromDate, now, 'vip-cur');
  if (!curRes.success) {
    logger.warn(`[vip] batch mes corriente falló: ${curRes.error || 's/detalle'}`);
    summary.errors += 1;
    return; // sin datos frescos no hay nada que recalcular en este chunk
  }
  await _storeBatch(curRes.players, byLower, curKey, false, ctx);

  // 2) Sólo en el sweep: cerrar los meses PASADOS que falten (backfill automático).
  if (mode === 'sweep') {
    const pastKeys = listMonthKeys(_epochMonthKey(), curKey).filter((k) => k !== curKey);
    if (pastKeys.length > 0) {
      const ids = chunk.map((u) => u.id);
      const have = await VipWagerMonth.find({
        userId: { $in: ids }, monthKey: { $in: pastKeys }, closed: true
      }).select('userId monthKey').lean();
      const haveSet = new Set(have.map((b) => `${b.userId}|${b.monthKey}`));

      for (const mk of pastKeys) {
        const range = getPeriodRange(mk);
        // Usuarios sin bucket cerrado de ese mes Y que ya existían (margen 45 días
        // por si la cuenta en la plataforma es anterior al alta local).
        const pending = chunk.filter((u) =>
          !haveSet.has(`${u.id}|${mk}`) &&
          (!u.createdAt || new Date(u.createdAt).getTime() - 45 * 24 * 60 * 60 * 1000 <= range.toDate.getTime())
        );
        if (pending.length === 0) continue;
        const r = await girox.getPlayersStatsBatch(pending.map((u) => u.username), range.fromDate, range.toDate, `vip-${mk}`);
        if (!r.success) {
          logger.warn(`[vip] batch ${mk} falló: ${r.error || 's/detalle'}`);
          summary.errors += 1;
          continue;
        }
        await _storeBatch(r.players, byLower, mk, true, ctx);
        summary.closed += Object.keys(r.players || {}).length;
      }
    }
  }

  // 3) Recalcular el acumulado del chunk y aplicar subas de nivel.
  const ids = chunk.map((u) => u.id);
  const totals = await VipWagerMonth.aggregate([
    { $match: { userId: { $in: ids } } },
    { $group: { _id: '$userId', total: { $sum: '$wagered' } } }
  ]);
  const totalById = new Map(totals.map((t) => [t._id, t.total]));

  for (const u of chunk) {
    try {
      await _applyLevels(u, totalById.get(u.id) || 0, ctx);
    } catch (e) {
      summary.errors += 1;
      logger.error(`[vip] level-up ${u.username}: ${e.message}`);
    }
  }
}

/** Guarda los buckets de un batch de stats ($set idempotente — NUNCA $inc). */
async function _storeBatch(players, byLower, monthKey, closed, ctx) {
  const { models, summary } = ctx;
  const { VipWagerMonth, User } = models;

  for (const [uname, stats] of Object.entries(players || {})) {
    const u = byLower.get(String(uname).toLowerCase());
    if (!u) continue;
    const wagered = Math.max(0, _scopedWagered(stats));
    try {
      await VipWagerMonth.updateOne(
        { userId: u.id, monthKey },
        { $set: { wagered, username: u.username, closed } },
        { upsert: true }
      );
      summary.buckets += 1;
    } catch (e) {
      // E11000 = dos instancias upserteando el mismo bucket a la vez; el próximo
      // tick lo pisa con $set así que se ignora sin drama.
      if (!e || e.code !== 11000) throw e;
    }
    // El batch devuelve el ID numérico del jugador: se persiste gratis (mismo
    // hábito que los reembolsos).
    if (stats.playerId && !u.giroxUserId) {
      User.updateOne({ id: u.id, giroxUserId: null }, { $set: { giroxUserId: stats.playerId } }).catch(() => {});
    }
  }
}

/**
 * Actualiza el acumulado del usuario y, si cruzó umbrales, paga el bono de CADA
 * nivel nuevo y recién después avanza vipLevel. Ver el header del archivo por el
 * razonamiento de idempotencia.
 */
async function _applyLevels(u, total, ctx) {
  const { girox, vipLevels, models, logger, notifyLevelUp, summary } = ctx;
  const { User, Transaction } = models;

  // $max: un total parcial (meses sin backfillear todavía) nunca pisa uno mayor.
  await User.updateOne({ id: u.id }, { $max: { lifetimeWagered: total } });

  const target = vipLevels.getVipLevel(total).levelIndex;
  const cur = u.vipLevel || 0;
  if (target <= cur) return;

  let reached = cur;
  for (let idx = cur + 1; idx <= target; idx += 1) {
    const level = vipLevels.getLevel(idx);
    if (!level) break;
    const ref = `vip-lvl-${u.id}-${idx}`;
    const r = await girox.creditUserBalance(u.username, level.levelUpBonusArs, ref, {
      description: `BONO — Premio por alcanzar el nivel VIP ${level.name}` // #238 el tipo va primero (lo lee quien audita en 1girox)
    });
    if (!r.success) {
      logger.warn(`[vip] bono nivel ${level.name} de ${u.username} no se pudo acreditar (${r.error || 's/detalle'}) — se reintenta en el próximo sync con la MISMA reference`);
      break;
    }
    reached = idx;
    summary.levelUps += 1;
    logger.info(`[vip] ${u.username} alcanzó ${level.emoji} ${level.name} — bono $${level.levelUpBonusArs}${r.duplicate ? ' (duplicate: ya pagado por otra instancia)' : ''}`);

    // Registro y aviso SOLO si esta instancia pagó de verdad (duplicate = otra ya lo hizo).
    if (!r.duplicate) {
      try {
        await Transaction.create({
          id: uuidv4(),
          type: 'vip_levelup',
          userId: u.id,
          username: u.username,
          amount: level.levelUpBonusArs,
          description: `Nivel VIP ${level.name} alcanzado ${level.emoji}`,
          transactionId: (r.data && (r.data.transfer_id || r.data.transferId)) || null,
          // #238 por qué vía salió en 1girox (solo si NO fue bono normal): unificado con el bono anterior / depósito (figura como Carga)
          ...(r.mergedOld ? { metadata: { creditedAs: 'bonus', mergedBonus: Number(r.mergedOld) } }
            : (r.creditedAs === 'deposit' ? { metadata: { creditedAs: 'deposit', ...(r.fallbackReason ? { giftFallback: String(r.fallbackReason).slice(0, 200) } : {}) } } : {})),
          timestamp: new Date()
        });
      } catch (e) {
        logger.warn(`[vip] no se pudo guardar la Transaction del nivel ${level.name} de ${u.username}: ${e.message}`);
      }
      if (notifyLevelUp) {
        try { await notifyLevelUp(u, level); } catch (e) {
          logger.warn(`[vip] aviso de nivel a ${u.username} falló: ${e.message}`);
        }
      }
    }
  }

  if (reached > cur) {
    // $lt como guard: nunca retrocede aunque dos instancias terminen a destiempo.
    await User.updateOne(
      { id: u.id, vipLevel: { $lt: reached } },
      { $set: { vipLevel: reached, vipLevelUpdatedAt: new Date() } }
    );
  }
}

module.exports = {
  runSync,
  claimDailySweep,
  isDisabled,
  DISABLED_KEY,
  monthKeyAR,
  todayStrAR,
  hourAR,
  listMonthKeys
};
