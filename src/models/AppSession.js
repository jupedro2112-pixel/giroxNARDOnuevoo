// #459 (owner 2026-10-18): SESIONES de la app (medidor de tiempo). La PWA manda POST /api/activity/ping cada 60 s mientras
// está abierta y visible; si el último ping fue hace más de 3 min, arranca una sesión nueva. Duración = lastPingAt − startedAt.
// Sirve para "cuánto tiempo dura en la app / cuántas veces entra" (Datos IA). TTL 180 días.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, default: null },
  dateKey: { type: String, required: true, index: true },   // YYYY-MM-DD hora argentina (día de inicio)
  startedAt: { type: Date, default: Date.now, index: true },
  lastPingAt: { type: Date, default: Date.now },
  pings: { type: Number, default: 1 },
  installed: { type: Boolean, default: false },              // app instalada (standalone)
  mode: { type: String, default: null }                      // easy | full | mini | play (dónde estaba)
});
schema.index({ userId: 1, lastPingAt: -1 });
schema.index({ startedAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
module.exports = mongoose.models['AppSession'] || mongoose.model('AppSession', schema);
