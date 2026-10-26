/**
 * storyAutopilot — HISTORIAS AUTOMÁTICAS (#827, owner 2026-10-22).
 *
 * "Un plan de historias automáticas que funcione igual que el cronograma: 4-5 historias diarias, siempre del lado del servicio que
 * ofrecemos; la idea es que conozcan todo nuestro servicio, entendiendo que siempre entra gente nueva a jugar; un poco de todo lo que
 * ofrecemos y los mejores partidos de la semana con equipos de primera línea; lo de deportes que lleve directo a jugar".
 *
 * Este módulo sólo ARMA el contenido (no toca la base): server.js lo publica en sus horarios.
 *  - THEMES: catálogo de historias de servicio (texto sobre color, botón a la sección de la app con `app:<sección>`).
 *  - topMatches(dayKey): partidos del día (hora AR) de las ligas que sigue la gente en Argentina, puntuados por la importancia de los
 *    equipos. Fuente: el scoreboard PÚBLICO de ESPN (la Partner API de 1girox no expone eventos y su sección de Deportes es un widget de
 *    Digitain que sólo abre con un jugador logueado). Cache en memoria por día; si la fuente falla, el día sale sólo con historias de servicio.
 */
'use strict';

// Equipos de "primera línea" (nombre EXACTO de ESPN → peso). Un partido entra si suma ≥ 12 y al menos uno pesa ≥ 8.
const TEAM_W = {
  // Argentina
  'River Plate': 10, 'Boca Juniors': 10, 'Racing Club': 8, 'Independiente': 8, 'San Lorenzo': 7, 'Estudiantes de La Plata': 6,
  'Vélez Sarsfield': 6, 'Rosario Central': 6, "Newell's Old Boys": 5, 'Talleres (Córdoba)': 5, 'Huracán': 4, 'Lanús': 4,
  'Argentinos Juniors': 4, 'Belgrano (Córdoba)': 4, 'Argentina': 10,
  // Sudamérica
  'Flamengo': 8, 'Palmeiras': 8, 'Corinthians': 6, 'São Paulo': 6, 'Fluminense': 5, 'Botafogo': 5, 'Grêmio': 5, 'Internacional': 5,
  'Atlético-MG': 5, 'Santos': 5, 'Peñarol': 5, 'Nacional': 5, 'Brazil': 8, 'Uruguay': 6, 'Colombia': 5, 'Chile': 5,
  // Europa / MLS
  'Real Madrid': 10, 'Barcelona': 10, 'Atlético Madrid': 7, 'Manchester City': 9, 'Liverpool': 9, 'Arsenal': 8, 'Manchester United': 8,
  'Chelsea': 8, 'Tottenham Hotspur': 6, 'Bayern Munich': 8, 'Borussia Dortmund': 6, 'Paris Saint-Germain': 8, 'Juventus': 7,
  'Internazionale': 7, 'AC Milan': 7, 'Napoli': 6, 'Inter Miami CF': 8
};
const LEAGUES = [
  ['arg.1', 'Liga Profesional'], ['arg.copa', 'Copa Argentina'], ['conmebol.libertadores', 'Copa Libertadores'],
  ['conmebol.sudamericana', 'Copa Sudamericana'], ['fifa.worldq.conmebol', 'Eliminatorias'], ['uefa.champions', 'Champions League'],
  ['eng.1', 'Premier League'], ['esp.1', 'LaLiga'], ['ita.1', 'Serie A'], ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['usa.1', 'MLS']
];
// Nombres cortos como los dice la gente.
const SHORT = { 'River Plate': 'River', 'Boca Juniors': 'Boca', 'Racing Club': 'Racing', 'Vélez Sarsfield': 'Vélez', 'Estudiantes de La Plata': 'Estudiantes',
  "Newell's Old Boys": "Newell's", 'Talleres (Córdoba)': 'Talleres', 'Belgrano (Córdoba)': 'Belgrano', 'Rosario Central': 'Central', 'Manchester City': 'Man. City',
  'Manchester United': 'Man. United', 'Tottenham Hotspur': 'Tottenham', 'Paris Saint-Germain': 'PSG', 'Internazionale': 'Inter', 'Inter Miami CF': 'Inter Miami',
  'Bayern Munich': 'Bayern', 'Borussia Dortmund': 'Dortmund', 'Atlético Madrid': 'Atlético', 'Brazil': 'Brasil' };
const short = (n) => SHORT[n] || n;

const _cache = new Map(); // dayKey → { at, matches }
const _urlCache = new Map(); // url → { at, data } (1 h): un día ART usa dos fechas UTC y la segunda es la primera del día siguiente
async function _fetchJson(url) {
  const hit = _urlCache.get(url); if (hit && Date.now() - hit.at < 3600000) return hit.data;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }); if (!r.ok) return null;
    const data = await r.json(); _urlCache.set(url, { at: Date.now(), data }); if (_urlCache.size > 400) _urlCache.delete(_urlCache.keys().next().value);
    return data;
  } catch (_) { return null; } finally { clearTimeout(t); }
}
// #858 (owner: "las historias de deportes con la cuota; si no es la misma de Digitain está ok, ponemos abajo que puede variar por horario"):
// cuota 1X2 de REFERENCIA del scoreboard público de ESPN (casa de apuestas que publica ahí, p. ej. DraftKings), americana ⇒ decimal.
function _american(x) { const n = Number(String(x == null ? '' : x).replace(/[^\d+-]/g, '')); if (!Number.isFinite(n) || n === 0) return null; const d = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n); return Math.round(d * 100) / 100; }
function _decOdds(list) {
  try {
    const o = (Array.isArray(list) ? list : []).find((x) => x && x.moneyline) || (Array.isArray(list) ? list[0] : null); if (!o) return null;
    const ml = o.moneyline || {}; const pick = (side) => side && ((side.close && side.close.odds) || (side.open && side.open.odds));
    const home = _american(pick(ml.home)), away = _american(pick(ml.away)), draw = _american(pick(ml.draw) || (o.drawOdds && o.drawOdds.moneyLine));
    if (!home || !away) return null;
    return { home, draw: draw || null, away, source: (o.provider && (o.provider.displayName || o.provider.name)) || '' };
  } catch (_) { return null; }
}
const _artKey = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const _artHM = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(11, 16);

/** Partidos destacados del día ART `dayKey` (YYYY-MM-DD), de mayor a menor importancia. */
async function topMatches(dayKey) {
  const hit = _cache.get(dayKey);
  if (hit && Date.now() - hit.at < 3 * 3600000) return hit.matches;
  // Un día ART cruza dos fechas UTC (los partidos de la noche figuran al día siguiente en UTC).
  const next = new Date(new Date(dayKey + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const dates = [dayKey.replace(/-/g, ''), next.replace(/-/g, '')];
  const out = []; const seen = new Set();
  const jobs = []; for (const [lg, lgName] of LEAGUES) for (const dt of dates) jobs.push([lg, lgName, dt]);
  const res = await Promise.all(jobs.map(([lg, , dt]) => _fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${dt}`)));
  for (let k = 0; k < jobs.length; k++) {
    const [lg, lgName] = jobs[k];
    {
      const j = res[k];
      for (const e of (j && j.events) || []) {
        if (seen.has(e.id) || _artKey(e.date) !== dayKey) continue;
        const st = e.status && e.status.type && e.status.type.state; if (st === 'post') continue;
        const c = (e.competitions || [])[0] || {}; const teams = (c.competitors || []).map((x) => x.team && x.team.displayName).filter(Boolean);
        if (teams.length !== 2) continue;
        const w = teams.map((n) => TEAM_W[n] || 0); const base = w[0] + w[1];
        if (base < 12 || Math.max(w[0], w[1]) < 8) continue;
        // Lo local pesa más para la gente de acá (clásicos argentinos, Copa Argentina, la Selección).
        const score = base + (/^(arg\.|fifa\.worldq\.conmebol)/.test(lg) ? 3 : 0);
        const home = (c.competitors || []).find((x) => x.homeAway === 'home'), away = (c.competitors || []).find((x) => x.homeAway === 'away');
        seen.add(e.id);
        const tm = (x) => (x && x.team) || {};
        out.push({ id: e.id, league: lgName, home: short(home ? home.team.displayName : teams[0]), away: short(away ? away.team.displayName : teams[1]), date: e.date, hour: _artHM(e.date), score,
          // #834: para la foto de la historia (escudos de ESPN, color del club y estadio)
          homeLogo: tm(home).logo || '', awayLogo: tm(away).logo || '', homeColor: tm(home).color || '', awayColor: tm(away).color || '', venue: (c.venue && c.venue.fullName) || '',
          odds: _decOdds(c.odds) });
      }
    }
  }
  out.sort((a, b) => b.score - a.score || new Date(a.date) - new Date(b.date));
  _cache.set(dayKey, { at: Date.now(), matches: out });
  if (_cache.size > 20) _cache.delete(_cache.keys().next().value);
  return out;
}

// Catálogo de historias de SERVICIO (lo que ofrece la app). `{pct}` = bono de la primera carga vigente (Config, nunca fijo en el texto).
const THEMES = [
  { key: 'como', title: '🆕 ¿Sos nuevo? Así funciona', text: '1️⃣ Cargás con una transferencia y mandás la foto del comprobante.\n2️⃣ Jugás en 1Girox: casino y deportes.\n3️⃣ Retirás tus premios a tu cuenta. Todo desde la app.', link: 'app:cargar', label: 'Empezar ahora ›', bg: '#d23a4e', img: { style: 'page', accent: '#e60023', kicker: 'Cómo funciona', icon: 'como', h1: '¿Sos nuevo en CARGAS 1GIROX?', h2: 'Así funciona', bullets: [['1', 'Cargás', 'Transferís y mandás la foto del comprobante'], ['2', 'Jugás', 'Casino y deportes en 1Girox'], ['3', 'Retirás', 'Tus premios van directo a tu cuenta']], cta: 'Empezar ahora' } },
  { key: 'carga', title: '⚡ Carga automática', text: 'Transferís, mandás la foto del comprobante y se acredita SOLA en minutos. Sin esperar a nadie, a cualquier hora.', link: 'app:cargar', label: 'Cargar ahora ›', bg: '#0f766e', img: { style: 'page', accent: '#16a34a', kicker: 'Carga automática', icon: 'carga', h1: 'Cargá en', h2: 'segundos', bullets: [['✓', 'Se acredita sola', 'En minutos, sin esperar a nadie'], ['★', 'A cualquier hora', 'Todos los días, también de noche'], ['$', 'Desde cualquier banco', 'Transferís al alias y mandás la foto']], cta: 'Cargar ahora' } },
  { key: 'retiro', title: '💸 Retiros a tu cuenta', text: 'Pedís tu retiro desde la app y va directo a tu cuenta bancaria. Rápido, simple y seguro.', link: 'app:retirar', label: 'Ver cómo retirar ›', bg: '#1e3a8a', img: { style: 'page', accent: '#2563eb', kicker: 'Retiros', icon: 'retiro', h1: 'Retirá tus premios a', h2: 'tu cuenta', bullets: [['$', 'Directo a tu banco', 'A tu CBU o alias, a tu nombre'], ['✓', 'Rápido y seguro', 'Confirmás con un código por SMS'], ['★', 'Desde la app', 'Sin pedirle a nadie']], cta: 'Ver cómo retirar' } },
  { key: 'reembolso', title: '🔁 Reembolso todos los días', text: 'En CARGAS 1GIROX te devolvemos parte de lo que jugás. Entrá a Reembolso y reclamalo: se acredita al toque.', link: 'app:reembolso', label: 'Ver mi reembolso ›', bg: '#7c2d12', img: { style: 'page', accent: '#e60023', kicker: 'Reembolsos', icon: 'reembolso', h1: '¿Perdiste?', h2: 'Recuperás', bullets: [['%', 'Todos los días', 'Parte de lo que perdiste ayer'], ['★', 'Semanal y mensual', 'Además, el de la semana y el del mes'], ['✓', 'Lo cobrás vos', 'Desde la app, en un toque']], cta: 'Ver mi reembolso', note: 'El reembolso se juega ×{rx} (rollover) para retirarlo' } },
  { key: 'soporte', title: '🛟 Soporte de verdad', text: 'Personas reales te responden todos los días desde el chat de Soporte de la app. Cualquier duda, escribinos.', link: 'app:soporte', label: 'Ir a Soporte ›', bg: '#111827', img: { style: 'page', accent: '#7c3aed', kicker: 'Soporte', icon: 'soporte', h1: 'Te atienden personas', h2: 'reales', bullets: [['✓', 'Te responden rápido', 'Todos los días desde el chat'], ['★', 'Cualquier consulta', 'Cargas, retiros, bonos y más'], ['$', 'Sin vueltas', 'Te acompañamos hasta resolverlo']], cta: 'Ir a soporte' } },
  { key: 'vip', title: '💎 Niveles VIP', text: 'Cuanto más jugás, más subís de nivel. Cada nivel desbloquea beneficios y un regalo al subir.', link: 'app:vip', label: 'Ver niveles ›', bg: '#713f12', img: { style: 'page', accent: '#b45309', kicker: 'Niveles VIP', icon: 'vip', h1: 'Jugá y subí de', h2: 'nivel', bullets: [['★', 'Cuanto más jugás, más subís', 'Bronce, Plata, Oro y Black'], ['$', 'Regalo al subir', 'Cada nivel trae su premio'], ['✦', 'Beneficios exclusivos', 'Para los que más juegan']], cta: 'Ver niveles' } },
  { key: 'referidos', title: '🤝 Jugá con tus amigos', text: 'Invitá a tus amigos con tu link y ganá una comisión por lo que juegan. Todos los días entra gente nueva a CARGAS 1GIROX.', link: 'app:referidos', label: 'Mi link de referidos ›', bg: '#065f46', img: { style: 'page', accent: '#0f766e', kicker: 'Referidos', icon: 'referidos', h1: 'Invitá a tus amigos y', h2: 'cobrá', bullets: [['$', 'Comisión todos los meses', 'Por lo que juegan tus amigos'], ['✓', 'Sin apostar', 'Las comisiones se retiran directo'], ['★', 'Tu link personal', 'Compartilo por WhatsApp']], cta: 'Mi link de referidos' } },
  { key: 'juegos', title: '🎰 Los más jugados', text: "Joker's Jewels, Gates of Olympus, Sweet Bonanza, Sugar Rush y más: los favoritos de la comunidad te esperan en 1Girox.", link: 'app:juegos', label: 'Jugar ahora ›', bg: '#9d174d', img: { style: 'page', accent: '#e60023', kicker: 'Los más jugados', photos: ['/images/games/jokers-jewels.jpg', '/images/games/gates-of-olympus-1000.jpg', '/images/games/sweet-bonanza-2500.jpg'], h1: 'Tus slots', h2: 'favoritos', bullets: [['★', "Joker's Jewels", 'El favorito de la comunidad'], ['✦', 'Gates of Olympus 1000', 'Uno de los más jugados'], ['$', 'Sweet Bonanza 2500', 'Dulces premios en cada giro']], cta: 'Jugar ahora' } },
  { key: 'deportes', title: '⚽ Deportes en vivo', text: 'Fútbol argentino, Libertadores, Champions, Premier y mucho más. Apostá antes y durante el partido desde Deportes.', link: 'app:deportes', label: 'Ir a Deportes ›', bg: '#14532d', img: { style: 'page', accent: '#16a34a', kicker: 'Deportes', icon: 'deportes', h1: 'Apostá al fútbol en', h2: 'vivo', bullets: [['★', 'Fútbol argentino', 'Liga, Copa y la Selección'], ['✦', 'Copas internacionales', 'Libertadores, Champions y más'], ['✓', 'Antes y durante', 'Apostá mientras se juega']], cta: 'Ir a deportes' } },
  { key: 'app', title: '📲 Llevá CARGAS 1GIROX en el celu', text: 'Instalá la app: entrás en un toque, te llegan los avisos de bonos y tenés todo a mano.', link: 'app:instalar', label: 'Instalar la app ›', bg: '#334155', img: { style: 'page', accent: '#e60023', kicker: 'Instalá la app', icon: 'app', h1: 'Llevá CARGAS 1GIROX', h2: 'en tu celu', bullets: [['✓', 'Entrás en un toque', 'Con tu sesión iniciada'], ['★', 'Te avisamos todo', 'Cargas, retiros y bonos'], ['$', 'Regalos para la app', 'Bonos para los que la tienen']], cta: 'Instalar la app' } },
  { key: 'seguro', title: '🔒 Tu cuenta, segura', text: 'Verificación por SMS y retiros sólo a cuentas a tu nombre. Tu plata y tus datos, cuidados.', link: 'app:verificar', label: 'Verificar mi celular ›', bg: '#0c4a6e', img: { style: 'page', accent: '#0284c7', kicker: 'Tu cuenta, segura', icon: 'seguro', h1: 'Verificá tu', h2: 'teléfono', bullets: [['✓', 'Verificación por SMS', 'Sólo vos confirmás tus retiros'], ['$', 'Retiros a tu nombre', 'Sólo a cuentas tuyas'], ['★', 'Datos cuidados', 'Tu plata y tus datos protegidos']], cta: 'Verificar mi celular' } },
  { key: 'primera', title: '🎁 Bienvenida para los nuevos', text: 'Si es tu primera carga, te sumamos un {pct}% extra automático. Todos los días se suman jugadores nuevos.', link: 'app:cargar', label: 'Hacer mi primera carga ›', bg: '#be123c', img: { style: 'page', accent: '#e60023', kicker: 'Bienvenida', icon: 'regalo', h1: 'Tu primera carga con', h2: '+{pct}% extra', bullets: [['$', '+{pct}% automático', 'En tu primera carga'], ['★', 'Después, más regalos', 'Instalando la app y activando notificaciones'], ['✓', 'Todos los días', 'Se suman jugadores nuevos']], cta: 'Hacer mi primera carga', note: 'El bono se juega ×{rx} (rollover) para retirarlo' } }
];
// #909 (owner 2026-10-24: "que publique 5 historias todos los días y que las rote, siempre eran nuevas historias"): cada tema tiene
// OTRAS redacciones; cuando el tema vuelve a tocar (cada ~3 días) sale con la siguiente, así ningún día repite texto con el anterior.
// Textos de SERVICIO (nunca ruleta ni plata/sueldos). `{pct}` = bono de la primera carga (Config).
const ALTS = {
  como: [{ title: '🧭 CARGAS 1GIROX en 3 pasos', text: 'Transferís y mandás la foto del comprobante, jugás en 1Girox y retirás a tu cuenta. Todo desde la app, sin vueltas.' },
    { title: '❓ ¿Cómo se juega acá?', text: 'Cargás con una transferencia (la foto del comprobante alcanza), entrás a 1Girox y tus premios vuelven a tu cuenta cuando quieras.' }],
  carga: [{ title: '🕐 Cargá a cualquier hora', text: 'De día o de madrugada: transferís, mandás la foto y la carga entra sola en minutos. No dependés de nadie.' },
    { title: '📸 Una foto y listo', text: 'Sacale captura al comprobante y mandala por la app: el sistema la lee y acredita tus fichas automáticamente.' }],
  retiro: [{ title: '🏦 Tu premio, en tu banco', text: 'Pedí el retiro desde la app y la plata va a tu CBU a tu nombre. Simple, directo y seguro.' },
    { title: '💸 Retirar es fácil', text: 'Entrá a Retirar premio, elegí el monto y listo: lo ves en tu cuenta bancaria. Sin trámites raros.' }],
  reembolso: [{ title: '🔁 Parte de lo que jugás, vuelve', text: 'Todos los días podés reclamar tu reembolso desde la app. Entrá a Reembolso y tocá reclamar.' },
    { title: '🎯 ¿Ya reclamaste tu reembolso?', text: 'Cada día tenés un reembolso esperándote en la app. Se acredita al toque cuando lo reclamás.' }],
  soporte: [{ title: '💬 Hablá con una persona', text: 'Nuestro equipo te responde desde el chat de Soporte de la app, todos los días. Contanos qué pasó y lo resolvemos.' },
    { title: '🛟 ¿Tenés una duda? Escribinos', text: 'En Soporte te atiende gente real: cargas, retiros, bonos o lo que necesites.' }],
  vip: [{ title: '👑 Subí de nivel', text: 'Cada nivel VIP desbloquea beneficios y un regalo al subir. Cuanto más jugás, más alto llegás.' },
    { title: '💎 ¿En qué nivel estás?', text: 'Mirá tu nivel VIP en la app y cuánto te falta para el siguiente. Cada escalón trae su regalo.' }],
  referidos: [{ title: '🔗 Tu link, tu comisión', text: 'Compartí tu link de referidos: por cada amigo que juega ganás una comisión, todos los meses.' },
    { title: '👥 Traé a tus amigos', text: 'Invitá con tu link y ganá por lo que juegan tus referidos. Lo cobrás directo en tu cuenta.' }],
  juegos: [{ title: '🎰 Lo que más se juega hoy', text: 'Gates of Olympus, Sweet Bonanza, Sugar Rush y los clásicos de siempre te esperan en 1Girox.' },
    { title: '🍀 ¿Ya probaste estos?', text: 'Los slots favoritos de la comunidad están a un toque desde la app. Entrá y elegí el tuyo.' }],
  deportes: [{ title: '🏟️ Apostá en vivo', text: 'Fútbol argentino, Champions, Libertadores y más. Apostá antes y durante el partido desde Deportes.' },
    { title: '⚽ Tu equipo juega, vos jugás', text: 'Entrá a Deportes en la app y apostá en vivo con cuotas que cambian minuto a minuto.' }],
  app: [{ title: '📲 Instalá la app', text: 'Con la app instalada entrás en un toque y te llegan los avisos de bonos y novedades. Mirá cómo en Perfil.' },
    { title: '🔔 No te pierdas nada', text: 'Instalá CARGAS 1GIROX en el celu: avisos de bonos, acceso directo y todo a mano.' }],
  seguro: [{ title: '🛡️ Jugá tranquilo', text: 'Celular verificado por SMS y retiros sólo a cuentas a tu nombre. Tu cuenta está protegida.' },
    { title: '🔒 Seguridad primero', text: 'Verificá tu celular desde Perfil: así tu cuenta y tus retiros quedan protegidos.' }],
  primera: [{ title: '🎁 Tu primera carga, con extra', text: 'Si todavía no hiciste tu primera carga, llevás un {pct}% extra automático. Empezá hoy.' },
    { title: '🆕 Para los que recién llegan', text: 'La primera carga trae un {pct}% extra automático. Bienvenido a CARGAS 1GIROX.' }]
};
// #931 (owner 2026-10-24): "que se publiquen en el cambio de día: se borran y se publican de vuelta a las 00 hs". Las 5 salen juntas apenas
// cambia el día (un minuto de diferencia para que el orden del anillo sea estable); duran 24 h y el motor apaga las del día anterior.
const SLOTS = ['00:05', '00:06', '00:07', '00:08', '00:09'];
const BONUS_TIME = '19:00'; // #971 → #979 (owner): "el mejor horario para activar un bono en Argentina es a las 19 h"
const MATCH_TIME = '00:05'; // #834: los partidos salen apenas cambia el día

/** Slot (juego) favorito: el más jugado de 1girox (catálogo público ordenado por popularidad). La Partner API no da netwin por juego,
 *  así que "favorito" = más partidas. Si hay una foto anterior de los conteos (prev: {gameKey: plays}) gana el que MÁS creció en la semana. */
async function favoriteSlot(prev) {
  const j = await _fetchJson('https://admin.1girox.com/api/games?sort=popular&per_page=24');
  const games = ((j && j.games) || []).filter((g) => /slot/i.test(String(g.category || 'slots')) && g.aggregator_id && g.game_id);
  if (!games.length) return null;
  const key = (g) => g.aggregator_id + '/' + g.game_id;
  let best = games[0], bestDelta = -1;
  if (prev && typeof prev === 'object') for (const g of games) { const d = (Number(g.play_count) || 0) - (Number(prev[key(g)]) || 0); if (prev[key(g)] != null && d > bestDelta) { bestDelta = d; best = g; } }
  const snapshot = {}; for (const g of games) snapshot[key(g)] = Number(g.play_count) || 0;
  return { name: String(best.name || '').replace(/™/g, '').trim(), path: '/play/' + best.aggregator_id + '/' + best.game_id, plays: Number(best.play_count) || 0,
    weekPlays: bestDelta >= 0 ? bestDelta : null, image: best.image_url || best.thumbnail || '', provider: best.provider_name || best.provider || '', snapshot };
}

/** Lo que sale cada horario del día `dayKey`. Determinístico para un mismo día y mismos partidos.
 *  ctx: { firstPct, dow (0=dom), favorite (de favoriteSlot), weeklyBonus: { pct, hours } }
 *  - Partidos: hasta 2 (3 si el tercero es muy fuerte), cada uno en el último horario que sale ≥ 1 h ANTES del partido.
 *  - Lunes: "el slot de la semana" (foto del juego y botón directo a ese juego).
 *  - Miércoles: la historia con BONO semanal (+pct% por `hours` h, con push a todos). */
function planDay(dayKey, matches, ctx) {
  ctx = ctx || {};
  const dayN = Math.floor(new Date(dayKey + 'T12:00:00Z').getTime() / 86400000);
  const pct = ctx.firstPct > 0 ? ctx.firstPct : 0;
  const themes = THEMES.filter((t) => t.key !== 'primera' || pct > 0);
  const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
  const out = new Array(SLOTS.length).fill(null);
  // 1) #834 (owner): "la historia de los partidos publicala apenas cambia el día, siempre" ⇒ los partidos destacados van en horarios PROPIOS
  //    (slot 'm0', 'm1', 'm2' a las 00:05) y los 5 horarios de siempre quedan para el servicio. Foto: cancha con los escudos de ESPN.
  const ms = (matches || []).filter((m, i) => i < 2 || (i === 2 && m.score >= 16)).slice(0, 3);
  const matchItems = ms.map((m, i) => ({ slot: 'm' + i, time: MATCH_TIME, kind: 'deporte', title: `⚽ HOY: ${m.home} vs ${m.away}`.slice(0, 60),
    text: `${m.league} · ${m.hour} hs.\nViví el partido y apostá antes y durante el juego desde Deportes en CARGAS 1GIROX 🟡`, link: 'app:deportes', label: 'Ir a Deportes ›', bg: '#14532d', match: m,
    img: { style: 'page', accent: '#16a34a', kicker: 'Partido de hoy · ' + m.league, match: { home: m.home, away: m.away, league: m.league, hour: m.hour, venue: m.venue, homeColor: m.homeColor, awayColor: m.awayColor },
      matchLogos: { home: m.homeLogo, away: m.awayLogo }, h1: `${m.home} vs ${m.away}`, h2: `Hoy ${m.hour} hs`, odds: m.odds || null,
      bullets: [['★', m.league, m.venue || 'Partido destacado del día'], ['✓', 'Apostá antes y durante', 'Seguilo en vivo desde Deportes'], ['$', 'Cargá y jugá', 'Tus fichas al instante']], cta: 'Apostar ahora' } }));
  const freeSlot = (pref) => { for (const i of [pref, 2, 3, 1, 4, 0]) if (i >= 0 && i < SLOTS.length && !out[i]) return i; return -1; };
  // 2) Lunes: el slot favorito de la semana.
  if (ctx.dow === 1 && ctx.favorite) {
    const f = ctx.favorite, i = freeSlot(2);
    if (i >= 0) out[i] = { kind: 'slot', title: `🔥 El slot de la semana: ${f.name}`.slice(0, 60),
      text: `Es el más jugado de CARGAS 1GIROX${f.weekPlays ? ' esta semana' : ''}${f.provider ? ' (' + f.provider + ')' : ''}. Entrá directo y probá suerte 🍀`, link: 'app:play:' + f.path, label: 'Jugar ' + f.name.slice(0, 22) + ' ›', bg: '#9d174d', game: f,
      img: { style: 'page', accent: '#e60023', kicker: 'El slot de la semana', photos: [f.image || ''], h1: f.name, h2: 'el más jugado', bullets: [['★', f.name, f.provider || 'El favorito de la comunidad'], ['✓', `El más jugado${f.weekPlays ? ' de la semana' : ''}`, 'En CARGAS 1GIROX'], ['$', 'Entrá directo', 'Un toque y estás jugando']], cta: 'Jugar ahora' } };
  }
  // 3) Miércoles: historia con BONO semanal (con notificación a todos).
  if ((ctx.bonusDays || [3]).includes(ctx.dow) && ctx.weeklyBonus && ctx.weeklyBonus.pct > 0) { // #968: días del bono (miércoles; + sábado en el refuerzo)
    const b = ctx.weeklyBonus, i = freeSlot(3);
    if (i >= 0) out[i] = { kind: 'bono', title: `🎁 Bono de la semana: +${b.pct}%`, text: `Sólo por ${b.hours} horas: tocá "Reclamar ahora" y tu próxima carga lleva +${b.pct}% EXTRA automático (con el tope de bonos). ¡Gracias por elegir CARGAS 1GIROX!`,
      link: '', label: '', bg: '#be123c', bonusPct: b.pct, bonusHours: b.hours, notifyAll: true, time: BONUS_TIME, // #971: la push a todos sale al mediodía (antes 00:08 de la madrugada)
      img: { style: 'page', accent: '#e60023', kicker: 'Bono de la semana', icon: 'regalo', h1: `Sólo por ${b.hours} horas`, h2: `+${b.pct}% extra`, bullets: [['✓', 'Tocá "Reclamar ahora"', 'Acá, en esta historia'], ['$', 'Tu próxima carga', `Lleva +${b.pct}% EXTRA automático`], ['★', 'Sin pedirle a nadie', 'Se aplica solo al cargar']], cta: 'Reclamar ahora', note: 'El bono se juega ×{rx} (rollover) para retirarlo' } };
  }
  // 4) El resto, temas de servicio que rotan día a día (sin el genérico de deportes si ese día ya hay partidos).
  //    #909: el cursor avanza 5 temas por día (antes 3 ⇒ dos de las cinco se repetían con el día anterior): con 12-13 temas, los de hoy
  //    nunca son los de ayer. Y cada vuelta completa del catálogo (`cycle`) usa OTRA redacción del tema (ALTS), así tampoco se repite el texto.
  // #931 (owner): "siempre quiero que vaya del lado de la atención" ⇒ el primer lugar de cada día es SIEMPRE Soporte/atención (con sus
  //    redacciones rotando); los otros 4 rotan por el resto del catálogo.
  const rot = themes.filter((t) => t.key !== 'soporte'); const sop = themes.find((t) => t.key === 'soporte');
  const n = rot.length;
  // paso 5 por día aunque se usen 4: con 12 temas (coprimos) hay 12 combinaciones distintas y los de hoy nunca son los de ayer (4/día ⇒ sólo 3)
  const STEP = SLOTS.length;
  let ti = (dayN * STEP) % n;
  const cycle = Math.floor((dayN * STEP) / n);
  if (sop && !out[0]) { const alts = ALTS.soporte || []; const v = dayN % (alts.length + 1); const tt = v > 0 && alts[v - 1] ? Object.assign({}, sop, alts[v - 1]) : sop; out[0] = { kind: 'servicio', theme: 'soporte', variant: v, title: tt.title, text: tt.text, link: sop.link, label: sop.label, bg: sop.bg, img: sop.img ? Object.assign({}, sop.img) : null }; }
  for (let i = 0; i < SLOTS.length; i++) {
    if (out[i]) continue;
    let t = rot[ti % n]; ti++;
    if (t.key === 'deportes' && ms.length) { t = rot[ti % n]; ti++; }
    const alts = ALTS[t.key] || []; const v = cycle % (alts.length + 1);
    const tt = v > 0 && alts[v - 1] ? Object.assign({}, t, alts[v - 1]) : t;
    const im = t.img ? Object.assign({}, t.img, { iconOpts: t.img.badge ? { badge: t.img.badge } : undefined }) : null;
    out[i] = { kind: 'servicio', theme: t.key, variant: v, title: tt.title, text: tt.text.replace('{pct}', String(pct)), link: t.link, label: t.label, bg: t.bg, img: im };
  }
  // {pct} = bono de la 1ª carga, {rx} = rollover global (Config): nunca fijos en el texto.
  const rx = ctx.rolloverX > 0 ? ctx.rolloverX : 5;
  const fill = (v) => (typeof v === 'string' ? v.replace(/\{pct\}/g, String(pct)).replace(/\{rx\}/g, String(rx)) : (Array.isArray(v) ? v.map(fill) : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v))); // #845: también listas (beneficios)
  return matchItems.concat(out.map((x, i) => Object.assign({ slot: i, time: SLOTS[i] }, x))).map((x) => (x.img ? Object.assign(x, { img: fill(x.img) }) : x));
}

module.exports = { topMatches, planDay, favoriteSlot, SLOTS, THEMES, ALTS, MATCH_TIME };
