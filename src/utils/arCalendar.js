/**
 * arCalendar — fechas especiales de ARGENTINA para el autopiloto de retención (#817, owner 2026-10-22).
 *
 * "Los días festivos en Argentina armar algo personalizado sobre ese día con un bono; tenelo en cuenta para todos los meses que
 * se programe". Calcula para CUALQUIER año (sin listas a mano que venzan): feriados nacionales en su fecha de celebración (la
 * Pascua sale por cómputo, así Carnaval y Viernes Santo caen bien), fechas comerciales (Día del Padre / Madre / Infancias / Amigo)
 * Los traslados por decreto de los feriados "trasladables" no se siguen a propósito: el
 * mensaje habla de la celebración, que es la fecha de siempre.
 *
 * specialDays(year) → Map 'YYYY-MM-DD' → { name, emoji, pct, title, message, kind }
 *   pct = bono sugerido (el autopiloto lo usa tal cual; 0 = sólo aviso). kind: 'feriado' | 'comercial'.
 */
'use strict';

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Domingo de Pascua (algoritmo anónimo gregoriano / Meeus).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);
const dkey = (dt) => key(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
// N-ésimo domingo del mes (n = 1..5).
function nthSunday(y, m, n) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const off = (7 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(y, m - 1, 1 + off + (n - 1) * 7));
}

function specialDays(y) {
  const out = new Map();
  const add = (k, o) => {
    // Si dos fechas caen el mismo día, gana la de bono más alto (y se nombran las dos).
    const prev = out.get(k);
    if (prev) { if ((o.pct || 0) > (prev.pct || 0)) out.set(k, Object.assign({}, o, { name: o.name + ' + ' + prev.name })); else prev.name += ' + ' + o.name; return; }
    out.set(k, o);
  };
  const E = easter(y);
  // ── Feriados nacionales ──
  add(key(y, 1, 1), { kind: 'feriado', emoji: '🎆', name: 'Año Nuevo', pct: 100, title: '🎆 ¡Feliz Año Nuevo!', message: 'Arrancamos el año a lo grande: cargá en las próximas {h} horas y te DUPLICAMOS la carga automático (con el tope de bonos). ¡Que este año sea tuyo! 🔴' });
  add(dkey(addDays(E, -48)), { kind: 'feriado', emoji: '🎭', name: 'Carnaval', pct: 50, title: '🎭 ¡Es Carnaval!', message: 'Fin de semana largo de Carnaval 🎉 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(dkey(addDays(E, -47)), { kind: 'feriado', emoji: '🎭', name: 'Carnaval', pct: 30, title: '🎭 Último día de Carnaval', message: 'Seguimos de fiesta 🎉 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(key(y, 3, 24), { kind: 'feriado', emoji: '🇦🇷', name: 'Día de la Memoria', pct: 20, title: '🇦🇷 Feriado nacional', message: 'Hoy es feriado: aprovechá el día libre. Cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(key(y, 4, 2), { kind: 'feriado', emoji: '🇦🇷', name: 'Día de Malvinas', pct: 20, title: '🇦🇷 Feriado nacional', message: 'Hoy es feriado 🇦🇷 Cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(dkey(addDays(E, -2)), { kind: 'feriado', emoji: '🐣', name: 'Viernes Santo', pct: 50, title: '🐣 ¡Finde largo de Pascuas!', message: 'Arranca el finde largo 🐣 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(dkey(E), { kind: 'feriado', emoji: '🐰', name: 'Pascuas', pct: 30, title: '🐰 ¡Felices Pascuas!', message: 'Te dejamos un huevo de Pascua 🥚 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(key(y, 5, 1), { kind: 'feriado', emoji: '🛠️', name: 'Día del Trabajador', pct: 50, title: '🛠️ Feliz Día del Trabajador', message: 'Hoy descansás vos 💪 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(key(y, 5, 25), { kind: 'feriado', emoji: '🇦🇷', name: 'Revolución de Mayo', pct: 30, title: '🇦🇷 ¡Feliz 25 de Mayo!', message: 'Locro, empanadas y un regalo patrio 🇦🇷 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(key(y, 6, 17), { kind: 'feriado', emoji: '🇦🇷', name: 'Paso a la Inmortalidad de Güemes', pct: 20, title: '🇦🇷 Feriado nacional', message: 'Hoy es feriado: cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(key(y, 6, 20), { kind: 'feriado', emoji: '🇦🇷', name: 'Día de la Bandera', pct: 30, title: '🇦🇷 Día de la Bandera', message: 'Celeste y blanco 🇦🇷 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(key(y, 7, 9), { kind: 'feriado', emoji: '🇦🇷', name: 'Día de la Independencia', pct: 50, title: '🇦🇷 ¡Feliz 9 de Julio!', message: 'Festejamos la Independencia con un regalo 🇦🇷 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(key(y, 8, 17), { kind: 'feriado', emoji: '🇦🇷', name: 'Paso a la Inmortalidad de San Martín', pct: 20, title: '🇦🇷 Feriado nacional', message: 'Hoy es feriado: cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(key(y, 10, 12), { kind: 'feriado', emoji: '🌎', name: 'Día de la Diversidad Cultural', pct: 20, title: '🌎 Feriado nacional', message: 'Hoy es feriado: cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(key(y, 11, 20), { kind: 'feriado', emoji: '🇦🇷', name: 'Día de la Soberanía', pct: 20, title: '🇦🇷 Feriado nacional', message: 'Hoy es feriado: cargá en las próximas {h} horas y te sumamos un 20% EXTRA automático.' });
  add(key(y, 12, 8), { kind: 'feriado', emoji: '🎄', name: 'Inmaculada Concepción', pct: 30, title: '🎄 ¡Arranca la temporada de fiestas!', message: 'Armamos el arbolito con un regalo 🎄 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(key(y, 12, 24), { kind: 'feriado', emoji: '🎅', name: 'Nochebuena', pct: 50, title: '🎅 ¡Feliz Nochebuena!', message: 'Papá Noel se adelantó 🎁 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(key(y, 12, 25), { kind: 'feriado', emoji: '🎄', name: 'Navidad', pct: 100, title: '🎄 ¡Feliz Navidad!', message: 'Nuestro regalo de Navidad: cargá en las próximas {h} horas y te DUPLICAMOS la carga automático (con el tope de bonos) 🎁' });
  add(key(y, 12, 31), { kind: 'feriado', emoji: '🥂', name: 'Fin de Año', pct: 100, title: '🥂 ¡Último día del año!', message: 'Despedimos el año a lo grande 🥂 Cargá en las próximas {h} horas y te DUPLICAMOS la carga automático (con el tope de bonos).' });
  // ── Fechas comerciales ──
  add(dkey(nthSunday(y, 6, 3)), { kind: 'comercial', emoji: '👨', name: 'Día del Padre', pct: 50, title: '👨 ¡Feliz Día del Padre!', message: 'Para todos los papás 💪 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  add(key(y, 7, 20), { kind: 'comercial', emoji: '🤝', name: 'Día del Amigo', pct: 50, title: '🤝 ¡Feliz Día del Amigo!', message: 'Festejalo con nosotros 🍻 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático. Invitá a tus amigos con tu link de referidos.' });
  add(dkey(nthSunday(y, 8, 3)), { kind: 'comercial', emoji: '🧸', name: 'Día de las Infancias', pct: 30, title: '🧸 Domingo de las Infancias', message: 'Día para disfrutar en familia 🧸 Cargá en las próximas {h} horas y te sumamos un 30% EXTRA automático.' });
  add(dkey(nthSunday(y, 10, 3)), { kind: 'comercial', emoji: '💐', name: 'Día de la Madre', pct: 50, title: '💐 ¡Feliz Día de la Madre!', message: 'Para todas las mamás 💐 Cargá en las próximas {h} horas y te sumamos un 50% EXTRA automático.' });
  // #821 (owner): sin "días de plata" (aguinaldo, sueldos): no sabemos la economía de cada uno; los mensajes hablan del producto.
  return out;
}

module.exports = { specialDays, easter };
