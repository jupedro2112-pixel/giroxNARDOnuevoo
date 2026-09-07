
/**
 * Modelo de Transacciones
 * Registra depósitos, retiros, bonos y reembolsos
 */
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  id: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  type: { 
    type: String, 
    // 'rakeback' = rakeback semanal VIP (% del apostado); 'vip_levelup' = bono
    // one-time por alcanzar un nivel VIP; 'roulette' = premio de la ruleta diaria
    // (2026-09-07 — antes la ruleta NO escribía Transaction y era invisible en
    // el panel). Ninguno es 'deposit' a propósito: la analítica de
    // publicistas/clientes cuenta cargas reales. En 1girox todos estos regalos
    // van como BONO (ver ARCHITECTURE §4.5); `metadata.creditedAs` guarda cómo
    // salió de verdad ('bonus' | 'deposit' si hubo fallback).
    enum: ['deposit', 'withdrawal', 'bonus', 'refund', 'transfer', 'referral_commission', 'fire_reward', 'rakeback', 'vip_levelup', 'roulette'],
    required: true,
    index: true
  },
  amount: { 
    type: Number, 
    required: true,
    min: 0
  },
  bonus: { 
    type: Number, 
    default: 0,
    min: 0
  },
  username: { 
    type: String, 
    required: true, 
    index: true,
    trim: true
  },
  userId: { 
    type: String, 
    default: null,
    index: true
  },
  description: { 
    type: String, 
    default: '',
    trim: true
  },
  adminId: { 
    type: String, 
    default: null 
  },
  adminUsername: { 
    type: String, 
    default: null 
  },
  adminRole: { 
    type: String, 
    default: null 
  },
  transactionId: { 
    type: String, 
    default: null,
    index: true
  },
  externalId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'completed',
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  timestamp: { 
    type: Date, 
    default: Date.now, 
    index: true,
    immutable: true
  }
}, {
  timestamps: true
});

// Índices para consultas frecuentes
transactionSchema.index({ type: 1, timestamp: -1 });
transactionSchema.index({ username: 1, timestamp: -1 });
transactionSchema.index({ userId: 1, timestamp: -1 });
transactionSchema.index({ timestamp: -1 });

// Índice para consultas por fecha
transactionSchema.index({ 
  timestamp: 1, 
  type: 1 
});

// Método estático para obtener resumen por período
transactionSchema.statics.getSummary = async function(startDate, endDate) {
  const matchStage = {};
  
  if (startDate || endDate) {
    matchStage.timestamp = {};
    if (startDate) matchStage.timestamp.$gte = new Date(startDate);
    if (endDate) matchStage.timestamp.$lte = new Date(endDate);
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' }
      }
    }
  ]);
};

// Método estático para obtener transacciones de hoy
transactionSchema.statics.getTodayTransactions = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return this.find({ timestamp: { $gte: today } })
    .sort({ timestamp: -1 })
    .lean();
};

// Método estático para obtener totales de hoy
transactionSchema.statics.getTodayTotals = async function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const result = await this.aggregate([
    { $match: { timestamp: { $gte: today } } },
    {
      $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  const totals = {
    deposits: 0,
    withdrawals: 0,
    bonuses: 0,
    refunds: 0
  };
  
  result.forEach(item => {
    totals[item._id + 's'] = item.total;
  });
  
  return totals;
};

module.exports = mongoose.models['Transaction'] || mongoose.model('Transaction', transactionSchema);