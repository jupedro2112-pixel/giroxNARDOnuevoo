/**
 * CashbackClaim — REEMBOLSO ACUMULATIVO de por vida (ESPEC-REEMBOLSO-1GIROX §3/§4,
 * réplica de la gemela PAUTANUEVAsantino #254→#275; acá desde 2026-09-11).
 *
 * Cada reclamo paga lo que tenga acumulado el jugador:
 *   reclamable = floor( pct% × max(0, netoDePorVida − regalado) − cobrado )
 * con tope por día (maxDailyArs) y mínimo para cobrar (minArs). Se acredita en
 * 1girox como BONO con rollover (multiplier del panel).
 *
 * IDEMPOTENCIA: reference = vip-cbk-<userId>-<dateKey>-<seq>. `seq` sale del
 * índice único (userId, dateKey, seq): si la acreditación falla y se borra el
 * doc, el reintento reusa el MISMO seq → misma reference → la plataforma
 * deduplica y jamás se paga dos veces (mismo patrón que los reembolsos por
 * período). Los `pending` cuentan como cobrado (cierra la carrera del doble
 * click junto con el guard de 20s del claim).
 *
 * Lo cobrado acá se DESCUENTA del reembolso semanal/mensual del período (§5) y
 * cuenta como REGALO en la base (§3.2: sin "reembolso del reembolso").
 */
const mongoose = require('mongoose');

const cashbackClaimSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true, trim: true, index: true },
  dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD ART
  seq: { type: Number, required: true },
  amount: { type: Number, required: true, min: 0 },       // ARS acreditados
  pct: { type: Number, default: 0 },                      // % vigente al reclamar
  rolloverX: { type: Number, default: 0 },
  netwinAtClaim: { type: Number, default: 0 },            // pérdida real acumulada al reclamar
  status: { type: String, enum: ['pending', 'credited'], default: 'pending', index: true },
  creditedAs: { type: String, default: null },            // 'bonus' | 'deposit' (cómo salió en 1girox)
  transactionId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true }
});

// ⚠️ Candado de idempotencia multi-instancia — NO quitar (ver ARCHITECTURE §7/§9).
cashbackClaimSchema.index({ userId: 1, dateKey: 1, seq: 1 }, { name: 'unique_user_day_seq', unique: true });
cashbackClaimSchema.index({ userId: 1, createdAt: 1 });

module.exports = mongoose.models['CashbackClaim'] ||
  mongoose.model('CashbackClaim', cashbackClaimSchema);
