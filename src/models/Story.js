/**
 * Story — "historias" de la app (réplica #224 del #361 de PICA ROJA): contenido que publica el ADMIN
 * desde el panel y que los clientes ven arriba a la derecha de la app (al lado de Perfil),
 * estilo historias de Instagram/WhatsApp: pantalla completa, barra de progreso, pasa sola.
 *
 * Cada historia vence sola: `expiresAt = publishedAt + hours` (horas configurables por
 * historia; default Config['storiesDefaultHours'], 24). Vencida ⇒ no se muestra en la app
 * pero queda en el panel (se puede "extender" o borrar).
 *
 * Media: o bien una URL (ruta del repo "/images/…" o https) o bien el archivo subido desde
 * el panel guardado como data URL en `mediaData` (se sirve en GET /api/stories/:id/media).
 * Se guarda en Mongo a propósito: el disco de EB/Render es efímero y hay N instancias.
 *
 * ⚠️ No confundir con `InfluencerStory` (placements pagos de influencers, analítica de
 * publicistas): nada que ver.
 */
const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: '', trim: true, maxlength: 60 },
  text: { type: String, default: '', trim: true, maxlength: 300 },
  // 'image' | 'video' | 'none' (solo texto sobre color)
  mediaType: { type: String, enum: ['image', 'video', 'none'], default: 'none' },
  // Ruta del repo o https (si viene de acá no se usa mediaData).
  mediaUrl: { type: String, default: '', maxlength: 500 },
  // data URL del archivo subido desde el panel (imagen ≤ 4 MB / video mp4 ≤ 8 MB).
  mediaData: { type: String, default: '', select: false },
  mediaMime: { type: String, default: '' },
  bgColor: { type: String, default: '#06070d', maxlength: 20 },
  linkUrl: { type: String, default: '', maxlength: 500 },
  linkLabel: { type: String, default: '', maxlength: 40 },
  // Segundos que se muestra cada historia (imagen/texto). El video usa su propia duración.
  durationSec: { type: Number, default: 6, min: 2, max: 60 },
  hours: { type: Number, default: 24, min: 1, max: 720 },
  publishedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  // #591 (owner): programación SEMANAL: cada 7 días desde publishedAt se vuelve a publicar sola (mientras esté activa).
  repeatWeekly: { type: Boolean, default: false, index: true },
  // #742 (owner): HISTORIA CON BONO — % extra en la próxima carga de quien toque "Reclamar ahora", vigente `bonusHours` desde la
  // publicación (`bonusUntil`). `notifyAll` = al publicar se mandó push a todos. `bonusClaims` = cuántos lo reclamaron.
  bonusPct: { type: Number, default: 0, min: 0, max: 200 },
  bonusHours: { type: Number, default: 1, min: 1, max: 72 },
  bonusUntil: { type: Date, default: null },
  notifyAll: { type: Boolean, default: false },
  bonusClaims: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  // #971: interacción — toques en el botón de la historia y reacciones (una por cliente; reactedBy no viaja a la app).
  clicks: { type: Number, default: 0 },
  reactions: { fire: { type: Number, default: 0 }, heart: { type: Number, default: 0 }, laugh: { type: Number, default: 0 }, like: { type: Number, default: 0 } },
  reactedBy: { type: [String], default: [], select: false },
  clickedBy: { type: [String], default: [], select: false }, // #979
  // #827 HISTORIAS AUTOMÁTICAS: 'sa-YYYY-MM-DD-<slot>' (única ⇒ multi-instancia sin duplicar) y qué es ('servicio' | 'deporte').
  // #886 (owner): historia PERSONAL (sólo la ve ese cliente): bono de bienvenida a los N días de registrarse (5 / 15 / 30).
  audienceUserId: { type: String, default: null, index: true },
  newbieDay: { type: Number, default: null, index: true },
  autoKey: { type: String, default: undefined },
  autoKind: { type: String, default: null },
  // #834: FOTO de la historia automática (spec para storyImage.renderSvg, con los escudos/fotos ya embebidos en base64). Se sirve en
  // GET /api/stories/:id/auto.svg. select:false: pesa (escudos ~80 KB) y no hace falta en los listados.
  autoImg: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  // #858: versión del diseño con la que se armó autoImg (si cambia STORY_IMG_VER en server.js, el motor la rearma desde el plan del día).
  autoImgVer: { type: String, default: null },
  // #827: respuesta a la historia con bono: cuántos lo usaron en una carga, bono entregado y lo que cargaron; resultado de la push a todos.
  bonusUses: { type: Number, default: 0 },
  bonusUsedTotal: { type: Number, default: 0 },
  bonusDepositTotal: { type: Number, default: 0 },
  pushStats: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

storySchema.index({ isActive: 1, expiresAt: 1, publishedAt: 1 });
storySchema.index({ autoKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Story || mongoose.model('Story', storySchema);
