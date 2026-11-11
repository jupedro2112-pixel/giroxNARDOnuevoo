/**
 * #245 Registro de AUDITORÍA del staff (seguridad interna entre admins).
 *
 * Una fila por cada cosa que hace una cuenta de staff (admin/depositor/withdrawer/comunidad/publisher_admin):
 * ingresos (y los intentos fallidos con un usuario de staff), cambios de clave (quién a quién), y TODA acción
 * que escribe en /api/* (cargas, retiros, bonos, pagos, altas…) con la IP real del que la hizo.
 *
 * PERMANENTE a propósito (sin TTL): es la evidencia para encontrar a quien opera con cuentas ajenas.
 * Nunca guarda contraseñas, tokens ni secretos (el body se sanea antes de guardar: `_auditSafeBody` en server.js).
 */
const mongoose = require('mongoose');

const staffAuditSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  // login | login_failed | login_blocked | password_change | password_change_denied | session_revoke | api
  action: { type: String, required: true, index: true },

  actorId: { type: String, default: null, index: true },
  actorUsername: { type: String, default: null, index: true },
  actorRole: { type: String, default: null },
  actorTeam: { type: String, default: null },

  targetId: { type: String, default: null, index: true },
  targetUsername: { type: String, default: null },
  targetRole: { type: String, default: null },

  // IP real del cliente (#245c `_reqIpInfo`: x-forwarded-for de derecha a izquierda; cf-connecting-ip solo vía Cloudflare) + la cadena cruda.
  ip: { type: String, default: null, index: true },
  ipChain: { type: String, default: null },
  userAgent: { type: String, default: null },
  // #246 huella del dispositivo (headers X-Device-Id / X-Device-Fp que manda el panel). deviceId = id guardado en ese navegador;
  // fp = huella del equipo (igual con VPN y casi siempre en incógnito). Misma huella en dos cuentas = probablemente la misma persona.
  deviceId: { type: String, default: null, index: true },
  fp: { type: String, default: null, index: true },

  method: { type: String, default: null },
  path: { type: String, default: null },
  status: { type: Number, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: null }
}, { versionKey: false });

staffAuditSchema.index({ actorUsername: 1, at: -1 });
staffAuditSchema.index({ ip: 1, at: -1 });
staffAuditSchema.index({ action: 1, at: -1 });

module.exports = mongoose.models.StaffAudit || mongoose.model('StaffAudit', staffAuditSchema);
