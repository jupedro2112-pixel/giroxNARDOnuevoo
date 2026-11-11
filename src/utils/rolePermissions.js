/**
 * #232 PERMISOS POR ROL editables (panel → 🛡️ Seguridad → "🔐 Permisos por rol").
 *
 * Lógica PURA (sin Mongo): catálogo de permisos, valores por defecto y normalización de lo que llega del panel.
 * La tabla la guarda/lee server.js en Config['rolePermissions'] y la edita SOLO el dueño de Seguridad (PANEL_OWNER).
 *
 * Reglas:
 *  - Los DEFAULTS son exactamente lo que hacía el código antes de esta tabla (post #231): deployar no cambia nada.
 *  - Roles editables: admin (admin general), depositor, withdrawer, comunidad. publisher_admin tiene su vista propia y
 *    no entra acá. El dueño de Seguridad (PANEL_OWNER) tiene SIEMPRE todo (lo resuelve server.js, no este módulo): así
 *    nadie puede dejar la sala sin quien administre.
 *  - PERMS (claves/cuentas/plata/chats): los controla el SERVER (cada ruta pregunta `_can(req, key)`), se pueden dar o quitar.
 *  - SECTIONS (menú del panel): solo se pueden QUITAR respecto de hoy (`possible`), salvo las marcadas con más roles
 *    posibles porque el server ya las sirve para esos roles. Esconden la sección del menú; lo que se puede HACER adentro
 *    lo siguen decidiendo el server y los PERMS.
 *
 * ⚠️ No reordenar ni renombrar las `key`: quedan guardadas en Config. Una key nueva arranca con su `def`.
 */
'use strict';

const ROLES = ['admin', 'depositor', 'withdrawer', 'comunidad'];
const ROLE_LABELS = { admin: 'Admin general', depositor: 'Depositor (cargas)', withdrawer: 'Withdrawer (retiros)', comunidad: 'Comunidad' };

const ALL = ROLES.slice();

const PERMS = [
  // ── Claves y cuentas ──
  { key: 'pwd_client', group: 'Claves y cuentas', label: 'Cambiar la clave de CLIENTES', def: ['admin'] },
  { key: 'pwd_staff', group: 'Claves y cuentas', label: 'Cambiar la clave de STAFF (depositor / withdrawer / comunidad / publicista)', def: ['admin'] },
  { key: 'pwd_admin', group: 'Claves y cuentas', label: 'Cambiar la clave de ADMINS GENERALES', def: ['admin'] },
  { key: 'pwd_owner', group: 'Claves y cuentas', label: 'Cambiar la clave de DUEÑOS de Publicidad (👑)', def: ['admin'] },
  { key: 'create_user', group: 'Claves y cuentas', label: 'Crear clientes', def: ['admin', 'depositor'] },
  { key: 'create_staff', group: 'Claves y cuentas', label: 'Crear cuentas de staff / admin', def: ['admin'] },
  { key: 'edit_account', group: 'Claves y cuentas', label: 'Editar cuentas a mano (teléfono, email, rol, activa)', def: ['admin'] },
  { key: 'access_link', group: 'Claves y cuentas', label: '🔗 Generar link de acceso de un cliente', def: ['admin', 'depositor'] },
  { key: 'verify_phone', group: 'Claves y cuentas', label: 'Marcar el teléfono de un CLIENTE como verificado', def: ALL },
  { key: 'login_nopass', group: 'Claves y cuentas', label: 'Habilitar "entrar sin clave" a un cliente', def: ['admin', 'depositor'] },
  { key: 'block_user', group: 'Claves y cuentas', label: 'Bloquear / desbloquear clientes', def: ['admin', 'depositor'] },
  { key: 'export_csv', group: 'Claves y cuentas', label: 'Exportar la lista de usuarios (CSV)', def: ['admin'] },
  // ── Plata ──
  { key: 'deposit', group: 'Plata', label: 'Cargar fichas', def: ['admin', 'depositor', 'comunidad'] },
  { key: 'bonus', group: 'Plata', label: 'Dar bonificación directa', def: ['admin', 'depositor', 'comunidad'] },
  { key: 'withdraw', group: 'Plata', label: 'Retiro manual de fichas', def: ['admin', 'withdrawer'] },
  { key: 'payout_pay', group: 'Plata', label: 'Pagar retiros (banco automático y "pagado por otro banco")', def: ['admin', 'withdrawer'] },
  { key: 'payout_cancel', group: 'Plata', label: 'Rechazar retiros (devuelve las fichas)', def: ['admin', 'withdrawer'] },
  // ── Chats (pestañas) ──
  { key: 'tab_open', group: 'Chats', label: 'Ver chats ABIERTOS', def: ['admin', 'depositor', 'comunidad'] },
  { key: 'tab_closed', group: 'Chats', label: 'Ver chats CERRADOS', def: ['admin', 'depositor', 'comunidad'] },
  { key: 'tab_payments', group: 'Chats', label: 'Ver chats de PAGOS', def: ['admin', 'withdrawer'] },
  { key: 'tab_comunidad', group: 'Chats', label: 'Ver chats de COMUNIDAD', def: ['admin', 'comunidad'] }
];

// Secciones del menú del panel (data-section). `def` = quién la ve hoy; `possible` = a quién se le puede dar.
// No están: Chats (siempre), 🛡️ Seguridad (PANEL_OWNER), Publicidad (dueños 👑, #221) ni las funciones de COMANDOS → 🧩.
const SECTIONS = [
  { key: 'users', label: 'Usuarios (y Crear usuario)', def: ['admin', 'depositor'], possible: ALL },
  { key: 'transactions', label: 'Transacciones', def: ALL, possible: ALL },
  { key: 'commands', label: 'Comandos y Configuración', def: ALL, possible: ALL },
  { key: 'banksConfig', label: '🏛️ Bancos — Configuración', def: ['admin'], possible: ['admin'] },
  { key: 'datos', label: 'Datos', def: ALL, possible: ALL },
  { key: 'datos2', label: 'Datos 2.0', def: ALL, possible: ALL },
  { key: 'centralIngresos', label: 'Central de ingresos', def: ALL, possible: ALL },
  { key: 'centralAppUsers', label: 'Usuarios con la app', def: ALL, possible: ALL },
  { key: 'centralWelcomeBonus', label: 'Bono de bienvenida', def: ALL, possible: ALL },
  { key: 'suspiciousAccounts', label: 'Cuentas sospechosas', def: ALL, possible: ALL },
  { key: 'reembolsos', label: 'Reembolsos', def: ALL, possible: ALL },
  { key: 'cronograma', label: '📅 Cronograma', def: ALL, possible: ALL },
  { key: 'roulette', label: 'Ruleta', def: ALL, possible: ALL },
  { key: 'reviews', label: 'Reseñas', def: ALL, possible: ALL },
  { key: 'referrals', label: 'Referidos', def: ALL, possible: ALL },
  { key: 'chatDelays', label: '⏱️ Demoras', def: ['admin'], possible: ['admin'] },
  { key: 'sms', label: 'SMS masivo', def: ['admin'], possible: ['admin'] },
  { key: 'notifications', label: 'Notificaciones (manual)', def: ALL, possible: ALL },
  { key: 'encuesta', label: 'Encuesta', def: ALL, possible: ALL },
  { key: 'inactivos', label: 'Inactivos', def: ALL, possible: ALL },
  { key: 'automations', label: 'Automatización', def: ALL, possible: ALL },
  { key: 'bonusStrategy', label: 'Estrategia de bonos', def: ALL, possible: ALL }
];

const PERM_KEYS = new Set(PERMS.map((p) => p.key));
const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));

function defaults() {
  const perms = {}; for (const p of PERMS) perms[p.key] = p.def.slice();
  const sections = {}; for (const s of SECTIONS) sections[s.key] = s.def.slice();
  return { perms, sections };
}

function _roleList(v, allowed) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const r of v) { const x = String(r || '').trim(); if (allowed.includes(x) && !out.includes(x)) out.push(x); }
  return allowed.filter((r) => out.includes(r)); // orden estable
}

/**
 * Mezcla lo guardado con los defaults: key desconocida = se ignora, key que falta = su default,
 * rol inválido = se descarta, sección = solo roles de `possible`.
 */
function normalize(saved) {
  const d = defaults();
  const src = (saved && typeof saved === 'object') ? saved : {};
  const sp = (src.perms && typeof src.perms === 'object') ? src.perms : {};
  const ss = (src.sections && typeof src.sections === 'object') ? src.sections : {};
  for (const p of PERMS) { const l = _roleList(sp[p.key], ROLES); if (l) d.perms[p.key] = l; }
  for (const s of SECTIONS) { const l = _roleList(ss[s.key], s.possible); if (l) d.sections[s.key] = l; }
  return d;
}

function roleHas(matrix, role, key) {
  const m = matrix || defaults();
  if (PERM_KEYS.has(key)) return !!(m.perms[key] && m.perms[key].includes(role));
  if (SECTION_BY_KEY.has(key)) return !!(m.sections[key] && m.sections[key].includes(role));
  return false; // permiso desconocido = NO (fail-closed)
}

/** Lo que ve el panel para la cuenta logueada: { perms: {key: bool}, sections: {key: bool} }. */
function forRole(matrix, role, all) {
  const m = matrix || defaults();
  const perms = {}; for (const p of PERMS) perms[p.key] = !!all || roleHas(m, role, p.key);
  const sections = {}; for (const s of SECTIONS) sections[s.key] = !!all || roleHas(m, role, s.key);
  return { perms, sections };
}

/** Diferencias contra los defaults (para el registro y el aviso de Telegram). */
function diff(before, after) {
  const out = [];
  const cmp = (kind, list) => {
    for (const it of list) {
      const a = (before[kind][it.key] || []), b = (after[kind][it.key] || []);
      const added = b.filter((r) => !a.includes(r)), removed = a.filter((r) => !b.includes(r));
      if (added.length || removed.length) out.push({ kind, key: it.key, label: it.label, added, removed });
    }
  };
  cmp('perms', PERMS); cmp('sections', SECTIONS);
  return out;
}

function catalog() {
  return {
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] })),
    perms: PERMS.map((p) => ({ key: p.key, group: p.group, label: p.label, def: p.def })),
    sections: SECTIONS.map((s) => ({ key: s.key, label: s.label, def: s.def, possible: s.possible }))
  };
}

module.exports = { ROLES, ROLE_LABELS, PERMS, SECTIONS, defaults, normalize, roleHas, forRole, diff, catalog };
