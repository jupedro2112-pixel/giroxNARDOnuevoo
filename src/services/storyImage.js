/**
 * storyImage — FOTOS de las historias automáticas (#834, owner 2026-10-22).
 *
 * "Las fotos de las historias armalas automáticamente, con el mismo estilo de las historias que ya teníamos manuales y con el logo de
 * CARGAS 1GIROX" + "en las de partido poné foto del partido, algo prolijo que se vea e incentive, no sólo texto".
 *
 * Arma un SVG 1080×1920 con el estilo de `public/images/stories/st2-*.png`: fondo blanco, la pica + "CARGAS 1GIROX" arriba, subtítulo espaciado,
 * tarjeta gris con un ícono, titular negro + línea roja, texto, píldora negra y "Gracias por confiar en CARGAS 1GIROX" abajo.
 * Los partidos van con una tarjeta oscura tipo cancha con los ESCUDOS de los dos equipos (ESPN), la liga, la hora y el estadio.
 * Las imágenes externas (escudos, foto del juego) se guardan embebidas en base64 al publicar (`Story.autoImg`): un <img> con SVG no
 * puede pedir recursos de afuera. Puro: no toca la base ni la red (salvo `fetchImageData`).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const W = 1080, H = 1920;
const RED = '#e60023', BLACK = '#111111', GRAY = '#f1f1f3', MUTED = '#6b6b73', WHITE = '#ffffff', GREEN = '#16a34a';
const FONT = "'DejaVu Sans','Helvetica Neue',Arial,'Roboto',sans-serif";

let _spade = '';
// #224 (réplica): el logo de arriba es el ÍCONO de esta app (allá era la pica de CARGAS 1GIROX).
try { _spade = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../../public/icons/icon-192x192.png')).toString('base64'); } catch (_) { _spade = ''; }

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Sin emojis en la imagen (cada teléfono los dibuja distinto y algunos no los tienen en SVG).
const clean = (t) => String(t == null ? '' : t).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim();

// Ancho aproximado del texto (no hay medición real en el server): mayúsculas/dígitos más anchos que minúsculas.
function estW(t, size, bold) {
  let w = 0;
  for (const ch of String(t)) {
    if (ch === ' ') w += 0.32; else if (/[iljI.,:;'!|·]/.test(ch)) w += 0.3; else if (/[mwMW]/.test(ch)) w += 0.92;
    else if (/[A-ZÁÉÍÓÚÑ0-9%$+]/.test(ch)) w += 0.72; else w += 0.58;
  }
  return w * size * (bold ? 1.06 : 0.96);
}
// Texto centrado; si la estimación pasa el ancho, se comprime para que entre SIEMPRE (textLength).
function ctext(y, t, size, fill, { bold = true, maxw = 900, weight, spacing = 0 } = {}) {
  const s = esc(t); const est = estW(t, size, bold) + spacing * String(t).length;
  const fit = est > maxw ? ` textLength="${maxw}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight || (bold ? 800 : 400)}" fill="${fill}"${spacing ? ` letter-spacing="${spacing}"` : ''}${fit}>${s}</text>`;
}
function wrap(t, size, maxw, bold) {
  const out = []; let line = '';
  for (const w of String(t).split(' ')) { const test = (line + ' ' + w).trim(); if (estW(test, size, bold) > maxw && line) { out.push(line); line = w; } else line = test; }
  if (line) out.push(line);
  return out;
}
// Tamaño de titular que entra en una línea (máx. 120 como las manuales).
const fitSize = (t, max, maxw) => Math.max(56, Math.min(max, Math.floor(max * maxw / Math.max(1, estW(t, max, true)))));

function pill(y, t, { bg = BLACK, fg = WHITE, size = 30 } = {}) {
  const tw = Math.min(900, estW(t, size, true)); const h = size + 44; const x0 = (W - tw) / 2 - 44;
  return { svg: `<rect x="${x0}" y="${y}" width="${tw + 88}" height="${h}" rx="${h / 2}" fill="${bg}"/>` + ctext(y + 22 + size * 0.82, t, size, fg, { maxw: 880 }), bottom: y + h };
}

// ── Íconos (zona de la tarjeta: centro 540,800) ──────────────────────────────
const cx = 540, cy = 800;
function check(x, y, r) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="${GREEN}"/><polyline points="${x - r * .45},${y} ${x - r * .12},${y + r * .33} ${x + r * .5},${y - r * .35}" fill="none" stroke="#fff" stroke-width="${r * .2}" stroke-linecap="round" stroke-linejoin="round"/>`; }
function avatar(x, y, r, name) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffe3e7"/><ellipse cx="${x}" cy="${y - r * .07}" rx="${r * .48}" ry="${r * .48}" fill="#f3c9a8"/>` +
    `<path d="M${x - r * .5},${y - r * .2} A${r * .5},${r * .42} 0 0 1 ${x + r * .5},${y - r * .2} Z" fill="#2b1b12"/>` +
    `<rect x="${x - r * .62}" y="${y + r * .3}" width="${r * 1.24}" height="${r * .65}" rx="24" fill="${RED}"/>` +
    `<circle cx="${x - r * .17}" cy="${y - r * .02}" r="6" fill="${BLACK}"/><circle cx="${x + r * .17}" cy="${y - r * .02}" r="6" fill="${BLACK}"/>` +
    `<text x="${x}" y="${y + r + 40}" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="800" fill="${MUTED}">${esc(name)}</text>`;
}
function slotMachine(label) {
  const reel = (x, t, c) => `<rect x="${x}" y="${cy - 75}" width="120" height="150" rx="18" fill="#fff"/><text x="${x + 60}" y="${cy + 30}" text-anchor="middle" font-family="${FONT}" font-size="96" font-weight="900" fill="${c}">${t}</text>`;
  return `<rect x="${cx - 230}" y="${cy - 150}" width="460" height="300" rx="40" fill="${RED}"/>` + reel(cx - 200, '7', RED) + reel(cx - 60, '7', BLACK) + reel(cx + 80, '7', RED) +
    `<rect x="${cx + 238}" y="${cy - 120}" width="18" height="150" rx="9" fill="#999"/><circle cx="${cx + 247}" cy="${cy - 130}" r="26" fill="${BLACK}"/>` +
    (label ? `<text x="${cx}" y="${cy + 190}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="${MUTED}">${esc(label)}</text>` : '');
}
function gift(txt) {
  return `<rect x="${cx - 160}" y="${cy - 70}" width="320" height="220" rx="24" fill="${RED}"/><rect x="${cx - 185}" y="${cy - 130}" width="370" height="80" rx="20" fill="#ff3352"/>` +
    `<rect x="${cx - 24}" y="${cy - 130}" width="48" height="280" fill="#ffd166"/>` +
    `<path d="M${cx},${cy - 130} C${cx - 120},${cy - 250} ${cx - 190},${cy - 140} ${cx},${cy - 130} C${cx + 190},${cy - 140} ${cx + 120},${cy - 250} ${cx},${cy - 130} Z" fill="none" stroke="#ffd166" stroke-width="22"/>` +
    (txt ? `<circle cx="${cx + 200}" cy="${cy - 140}" r="78" fill="${BLACK}"/><text x="${cx + 200}" y="${cy - 124}" text-anchor="middle" font-family="${FONT}" font-size="${txt.length > 4 ? 34 : 46}" font-weight="900" fill="#fff">${esc(txt)}</text>` : '');
}
const ICONS = {
  carga: () => `<circle cx="${cx}" cy="${cy}" r="150" fill="${RED}"/><polygon points="${cx + 20},${cy - 110} ${cx - 70},${cy + 15} ${cx - 5},${cy + 15} ${cx - 25},${cy + 115} ${cx + 70},${cy - 15} ${cx + 5},${cy - 15}" fill="#fff"/>`,
  reembolso: () => `<path d="M${cx + 70},${cy - 121} A140,140 0 1 0 ${cx + 121},${cy + 70}" fill="none" stroke="${RED}" stroke-width="34" stroke-linecap="round"/>` +
    `<polygon points="${cx + 40},${cy - 165} ${cx + 135},${cy - 120} ${cx + 45},${cy - 70}" fill="${RED}"/><text x="${cx}" y="${cy + 34}" text-anchor="middle" font-family="${FONT}" font-size="100" font-weight="900" fill="${BLACK}">%</text>`,
  seguro: () => `<rect x="${cx - 150}" y="${cy - 160}" width="300" height="330" rx="40" fill="${BLACK}"/><rect x="${cx - 134}" y="${cy - 120}" width="268" height="260" rx="24" fill="#fff"/>` +
    `<rect x="${cx - 122}" y="${cy - 80}" width="244" height="70" rx="22" fill="${GRAY}"/><text x="${cx}" y="${cy - 35}" text-anchor="middle" font-family="${FONT}" font-size="27" font-weight="800" fill="${BLACK}">Código: 4 8 2 1</text>` +
    `<rect x="${cx - 110}" y="${cy + 10}" width="220" height="60" rx="22" fill="${RED}"/><text x="${cx}" y="${cy + 50}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="800" fill="#fff">CONFIRMAR</text>` + check(cx + 182, cy - 170, 54),
  referidos: () => avatar(cx - 160, cy - 20, 92, 'VOS') + avatar(cx + 160, cy - 20, 92, 'TU AMIGO') +
    `<line x1="${cx - 55}" y1="${cy - 20}" x2="${cx + 40}" y2="${cy - 20}" stroke="${RED}" stroke-width="12"/><polygon points="${cx + 40},${cy - 44} ${cx + 72},${cy - 20} ${cx + 40},${cy + 4}" fill="${RED}"/>`,
  misiones: () => `<circle cx="${cx - 190}" cy="${cy}" r="120" fill="${RED}"/><circle cx="${cx - 190}" cy="${cy}" r="86" fill="#fff"/><circle cx="${cx - 190}" cy="${cy}" r="54" fill="${RED}"/><circle cx="${cx - 190}" cy="${cy}" r="22" fill="#fff"/>` +
    ['3 cargas en la semana', 'Cargar 3 días distintos', 'Llegar a un total'].map((t, i) => { const y = cy - 110 + i * 82; return `<rect x="${cx - 20}" y="${y}" width="380" height="62" rx="16" fill="#fff"/>` + (i < 2 ? check(cx + 14, y + 31, 20) : `<circle cx="${cx + 14}" cy="${y + 31}" r="18" fill="none" stroke="#bbb" stroke-width="4"/>`) + `<text x="${cx + 48}" y="${y + 41}" font-family="${FONT}" font-size="26" font-weight="800" fill="${BLACK}">${t}</text>`; }).join(''),
  app: () => `<rect x="${cx - 300}" y="${cy - 160}" width="250" height="320" rx="34" fill="${BLACK}"/><rect x="${cx - 286}" y="${cy - 124}" width="222" height="254" rx="20" fill="#fff"/>` +
    [0, 1, 2].map((c) => [0, 1].map((r) => `<rect x="${cx - 270 + c * 68}" y="${cy - 104 + r * 76}" width="52" height="52" rx="12" fill="${c === 2 && r === 1 ? RED : '#e5e5ea'}"/>`).join('')).join('') +
    `<text x="${cx - 175}" y="${cy + 100}" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="800" fill="${BLACK}">CARGAS 1GIROX</text>` + check(cx - 60, cy - 150, 46) +
    `<circle cx="${cx + 160}" cy="${cy - 30}" r="110" fill="#fff"/><path d="M${cx + 100},${cy + 20} L${cx + 100},${cy - 40} A60,60 0 0 1 ${cx + 220},${cy - 40} L${cx + 220},${cy + 20} L${cx + 236},${cy + 36} L${cx + 84},${cy + 36} Z" fill="${RED}"/><circle cx="${cx + 160}" cy="${cy + 52}" r="16" fill="${RED}"/>` +
    `<text x="${cx + 160}" y="${cy + 125}" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="800" fill="${MUTED}">TE AVISAMOS</text>`,
  como: () => ['CARGÁS', 'JUGÁS', 'RETIRÁS'].map((t, i) => { const x = cx - 280 + i * 280; return `<circle cx="${x}" cy="${cy - 30}" r="92" fill="${i === 1 ? BLACK : RED}"/><text x="${x}" y="${cy + 6}" text-anchor="middle" font-family="${FONT}" font-size="100" font-weight="900" fill="#fff">${i + 1}</text><text x="${x}" y="${cy + 120}" text-anchor="middle" font-family="${FONT}" font-size="32" font-weight="800" fill="${BLACK}">${t}</text>`; }).join('') +
    `<line x1="${cx - 175}" y1="${cy - 30}" x2="${cx - 105}" y2="${cy - 30}" stroke="#bbb" stroke-width="8" stroke-dasharray="6 10"/><line x1="${cx + 105}" y1="${cy - 30}" x2="${cx + 175}" y2="${cy - 30}" stroke="#bbb" stroke-width="8" stroke-dasharray="6 10"/>`,
  retiro: () => `<polygon points="${cx - 40},${cy - 70} ${cx + 260},${cy - 70} ${cx + 110},${cy - 150}" fill="${BLACK}"/>` +
    [0, 1, 2, 3].map((i) => `<rect x="${cx - 18 + i * 76}" y="${cy - 50}" width="44" height="150" fill="${BLACK}"/>`).join('') + `<rect x="${cx - 40}" y="${cy + 105}" width="300" height="36" rx="8" fill="${BLACK}"/>` +
    `<circle cx="${cx - 230}" cy="${cy + 10}" r="95" fill="${RED}"/><text x="${cx - 230}" y="${cy + 48}" text-anchor="middle" font-family="${FONT}" font-size="110" font-weight="900" fill="#fff">$</text>` +
    `<polygon points="${cx - 128},${cy - 6} ${cx - 98},${cy - 6} ${cx - 98},${cy - 30} ${cx - 60},${cy + 10} ${cx - 98},${cy + 50} ${cx - 98},${cy + 26} ${cx - 128},${cy + 26}" fill="${GREEN}"/>`,
  soporte: () => `<rect x="${cx - 300}" y="${cy - 140}" width="380" height="150" rx="40" fill="#fff"/><polygon points="${cx - 250},${cy + 8} ${cx - 270},${cy + 60} ${cx - 200},${cy + 8}" fill="#fff"/>` +
    `<text x="${cx - 110}" y="${cy - 50}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="800" fill="${BLACK}">¿Cómo cargo?</text>` +
    `<rect x="${cx - 60}" y="${cy + 10}" width="360" height="150" rx="40" fill="${RED}"/><polygon points="${cx + 230},${cy + 158} ${cx + 270},${cy + 205} ${cx + 180},${cy + 158}" fill="${RED}"/>` +
    `<text x="${cx + 120}" y="${cy + 100}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="800" fill="#fff">¡Te ayudo ya!</text>`,
  vip: () => `<polygon points="${cx - 170},${cy - 60} ${cx - 90},${cy - 150} ${cx + 90},${cy - 150} ${cx + 170},${cy - 60} ${cx},${cy + 150}" fill="${RED}"/>` +
    `<polygon points="${cx - 170},${cy - 60} ${cx + 170},${cy - 60} ${cx},${cy + 150}" fill="#b8001c"/><polygon points="${cx - 90},${cy - 150} ${cx},${cy - 60} ${cx + 90},${cy - 150}" fill="#ff4d6a"/>` +
    `<text x="${cx}" y="${cy + 200}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="800" fill="${MUTED}">BRONCE · PLATA · ORO · BLACK</text>`,
  juegos: (o) => slotMachine(o && o.gameName),
  deportes: () => `<circle cx="${cx}" cy="${cy}" r="150" fill="#fff" stroke="${BLACK}" stroke-width="10"/><polygon points="${cx},${cy - 55} ${cx + 52},${cy - 17} ${cx + 32},${cy + 45} ${cx - 32},${cy + 45} ${cx - 52},${cy - 17}" fill="${BLACK}"/>` +
    [[0, -150], [143, -46], [88, 121], [-88, 121], [-143, -46]].map(([dx, dy]) => `<line x1="${cx + dx * .37}" y1="${cy + dy * .37}" x2="${cx + dx * .86}" y2="${cy + dy * .86}" stroke="${BLACK}" stroke-width="10"/>`).join(''),
  regalo: (o) => gift(o && o.badge)
};

// Tarjeta de PARTIDO: cancha oscura con los dos escudos, VS, liga, hora y estadio.
function matchCard(m) {
  const y0 = 590, y1 = 1100, x0 = 70, x1 = W - 70;
  const crest = (x, img, name, color) => {
    const ring = `<circle cx="${x}" cy="${y0 + 215}" r="128" fill="#fff"/><circle cx="${x}" cy="${y0 + 215}" r="128" fill="none" stroke="#${/^[0-9a-f]{6}$/i.test(color || '') ? color : 'e60023'}" stroke-width="10"/>`;
    const pic = img ? `<image href="${img}" x="${x - 95}" y="${y0 + 120}" width="190" height="190" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="${x}" y="${y0 + 250}" text-anchor="middle" font-family="${FONT}" font-size="96" font-weight="900" fill="${BLACK}">${esc(clean(name).charAt(0).toUpperCase())}</text>`;
    const nm = clean(name); const sz = Math.min(44, Math.floor(44 * 330 / Math.max(1, estW(nm, 44, true))));
    return ring + pic + `<text x="${x}" y="${y0 + 410}" text-anchor="middle" font-family="${FONT}" font-size="${sz}" font-weight="900" fill="#fff">${esc(nm)}</text>`;
  };
  const stripes = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${x0}" y="${y0 + i * 85}" width="${x1 - x0}" height="42" fill="#ffffff" opacity="0.035"/>`).join('');
  return `<defs><linearGradient id="pitch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3d22"/><stop offset="1" stop-color="#062414"/></linearGradient>` +
    `<clipPath id="pc"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="44"/></clipPath></defs>` +
    `<g clip-path="url(#pc)"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="url(#pitch)"/>${stripes}` +
    `<line x1="${W / 2}" y1="${y0}" x2="${W / 2}" y2="${y1}" stroke="#fff" stroke-opacity=".18" stroke-width="6"/><circle cx="${W / 2}" cy="${y0 + 215}" r="110" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/>` +
    `<rect x="${x0 - 3}" y="${y0 + 95}" width="120" height="240" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/><rect x="${x1 - 117}" y="${y0 + 95}" width="120" height="240" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/></g>` +
    crest(270, m.homeImg, m.home, m.homeColor) + crest(W - 270, m.awayImg, m.away, m.awayColor) +
    `<circle cx="${W / 2}" cy="${y0 + 215}" r="62" fill="${RED}"/><text x="${W / 2}" y="${y0 + 233}" text-anchor="middle" font-family="${FONT}" font-size="46" font-weight="900" fill="#fff">VS</text>` +
    `<rect x="${W / 2 - 190}" y="${y0 + 32}" width="380" height="54" rx="27" fill="#000" fill-opacity=".45"/>` +
    ctext(y0 + 69, clean(m.league || 'FÚTBOL').toUpperCase(), 26, '#ffd166', { maxw: 350, spacing: 2 }) +
    `<rect x="${W / 2 - 150}" y="${y0 + 440}" width="300" height="50" rx="25" fill="#fff"/>` + ctext(y0 + 475, 'HOY · ' + clean(m.hour) + ' HS', 30, BLACK, { maxw: 280 }) +
    `<rect x="${x0}" y="${y1 - 4}" width="0" height="0"/>`;
}

/**
 * spec: { kicker, h1, h2, text, pill, note, icon, iconOpts, match }
 *   match = { home, away, league, hour, venue, homeImg, awayImg (data URL), homeColor, awayColor } ⇒ tarjeta de partido.
 */
function renderSvg(spec) {
  spec = spec || {};
  if (spec.style === 'premium') return renderPremium(spec); // #845
  if (spec.style === 'page') return renderPage(spec); // #931
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${WHITE}"/>`);
  if (_spade) parts.push(`<image href="${_spade}" x="${(W - 150) / 2}" y="250" width="150" height="150"/>`);
  parts.push(ctext(448, 'CARGAS 1GIROX', 38, BLACK));
  parts.push(ctext(486, 'oficial · cargas automáticas', 24, MUTED, { bold: false }));
  const kicker = clean(spec.kicker).toUpperCase();
  if (kicker) parts.push(ctext(565, kicker, 32, MUTED, { maxw: 940, spacing: 7 }));
  let y;
  if (spec.match) {
    parts.push(matchCard(spec.match));
    y = 1140;
  } else {
    parts.push(`<rect x="90" y="600" width="${W - 180}" height="410" rx="44" fill="${GRAY}"/>`);
    const ic = ICONS[spec.icon] || ICONS.carga; parts.push(ic(spec.iconOpts || {}));
    y = 1040;
  }
  const h1 = clean(spec.h1), h2 = clean(spec.h2);
  const hs = Math.min(h1 ? fitSize(h1, spec.match ? 96 : 120, 920) : 120, h2 ? fitSize(h2, spec.match ? 96 : 120, 920) : 120);
  if (h1) { parts.push(ctext(y + hs * 0.86, h1, hs, BLACK, { maxw: 940, weight: 900 })); y += hs + 10; }
  if (h2) { parts.push(ctext(y + hs * 0.86, h2, hs, RED, { maxw: 940, weight: 900 })); y += hs + 10; }
  const text = clean(spec.text);
  if (text) {
    const lines = wrap(text, 40, 880, false).slice(0, 3);
    for (const ln of lines) { parts.push(ctext(y + 46, ln, 40, BLACK, { bold: false, maxw: 900, weight: 400 })); y += 52; }
  }
  const pl = clean(spec.pill);
  if (pl) { const p = pill(y + 20, pl.toUpperCase()); parts.push(p.svg); y = p.bottom; }
  const note = clean(spec.note);
  if (note) parts.push(ctext(y + 46, note, 24, MUTED, { maxw: 900 }));
  parts.push(ctext(1668, 'Gracias por confiar en CARGAS 1GIROX', 28, MUTED));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

// ───────────────────────── #845 ESTILO PREMIUM (como la historia vieja de Telegram, st2-7) ─────────────────────────
// Owner: "estilo prolijo con el logo de la marca e imágenes ilustrativas como la de Telegram; si mostrás slots, foto de los slots; bien
// profesional". Fondo blanco con la pica + CARGAS 1GIROX arriba, TARJETA OSCURA con degradé y borde dorado, subtítulo dorado espaciado, ilustración
// (ícono en círculo con anillo dorado, fotos reales de juegos o la cancha con escudos), titular blanco + línea grande dorada, 3 beneficios con
// íconos dorados, botón dorado y nota. spec.style = 'premium'.
const GOLD = '#e6b422', GOLD2 = '#ffd166', DARK = '#0f0f12', MUT2 = '#b9b9c3';
const PX0 = 70, PY0 = 540, PX1 = W - 70, PY1 = 1590;
function _glyph(kind, color) {
  const c = 790, x = W / 2;
  const ring = `<circle cx="${x}" cy="${c}" r="140" fill="${color || RED}"/><circle cx="${x}" cy="${c}" r="149" fill="none" stroke="${GOLD}" stroke-width="3"/>`;
  const wt = (t, sz, dy) => `<text x="${x}" y="${c + (dy || 0)}" text-anchor="middle" font-family="${FONT}" font-size="${sz}" font-weight="900" fill="#fff">${t}</text>`;
  const G = {
    carga: `<polygon points="${x + 22},${c - 105} ${x - 66},${c + 14} ${x - 4},${c + 14} ${x - 24},${c + 108} ${x + 68},${c - 14} ${x + 6},${c - 14}" fill="#fff"/>`,
    reembolso: `<path d="M${x + 60},${c - 82} A100,100 0 1 0 ${x + 88},${c + 46}" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/><polygon points="${x + 34},${c - 120} ${x + 104},${c - 86} ${x + 38},${c - 50}" fill="#fff"/>` + wt('%', 84, 30),
    retiro: wt('$', 150, 52),
    soporte: `<rect x="${x - 86}" y="${c - 74}" width="172" height="112" rx="30" fill="#fff"/><polygon points="${x - 48},${c + 34} ${x - 64},${c + 82} ${x - 10},${c + 34}" fill="#fff"/><circle cx="${x - 40}" cy="${c - 18}" r="11" fill="${color}"/><circle cx="${x}" cy="${c - 18}" r="11" fill="${color}"/><circle cx="${x + 40}" cy="${c - 18}" r="11" fill="${color}"/>`,
    misiones: `<circle cx="${x}" cy="${c}" r="96" fill="#fff"/><circle cx="${x}" cy="${c}" r="66" fill="${color}"/><circle cx="${x}" cy="${c}" r="38" fill="#fff"/><circle cx="${x}" cy="${c}" r="14" fill="${color}"/>`,
    vip: `<polygon points="${x - 100},${c - 30} ${x - 52},${c - 86} ${x + 52},${c - 86} ${x + 100},${c - 30} ${x},${c + 96}" fill="#fff"/><polygon points="${x - 100},${c - 30} ${x + 100},${c - 30} ${x},${c + 96}" fill="#ffe7a8"/>`,
    referidos: `<circle cx="${x - 46}" cy="${c - 36}" r="34" fill="#fff"/><rect x="${x - 96}" y="${c + 6}" width="100" height="70" rx="34" fill="#fff"/><circle cx="${x + 50}" cy="${c - 24}" r="28" fill="#ffe7a8"/><rect x="${x + 8}" y="${c + 12}" width="86" height="60" rx="30" fill="#ffe7a8"/>`,
    app: `<rect x="${x - 62}" y="${c - 104}" width="124" height="208" rx="22" fill="#fff"/><rect x="${x - 50}" y="${c - 82}" width="100" height="160" rx="10" fill="${color}"/>` + (_spade ? `<image href="${_spade}" x="${x - 32}" y="${c - 36}" width="64" height="64"/>` : ''),
    seguro: `<path d="M${x},${c - 104} L${x + 84},${c - 70} L${x + 84},${c + 4} C${x + 84},${c + 58} ${x + 44},${c + 92} ${x},${c + 108} C${x - 44},${c + 92} ${x - 84},${c + 58} ${x - 84},${c + 4} L${x - 84},${c - 70} Z" fill="#fff"/><polyline points="${x - 40},${c + 2} ${x - 8},${c + 34} ${x + 46},${c - 28}" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>`,
    regalo: `<rect x="${x - 86}" y="${c - 30}" width="172" height="124" rx="14" fill="#fff"/><rect x="${x - 100}" y="${c - 70}" width="200" height="50" rx="12" fill="#ffe7a8"/><rect x="${x - 15}" y="${c - 70}" width="30" height="164" fill="${color}"/><path d="M${x},${c - 70} C${x - 70},${c - 140} ${x - 110},${c - 80} ${x},${c - 70} C${x + 110},${c - 80} ${x + 70},${c - 140} ${x},${c - 70} Z" fill="none" stroke="#ffe7a8" stroke-width="14"/>`,
    como: wt('1·2·3', 74, 26),
    juegos: wt('777', 96, 34),
    deportes: `<circle cx="${x}" cy="${c}" r="98" fill="#fff"/><polygon points="${x},${c - 36} ${x + 34},${c - 11} ${x + 21},${c + 29} ${x - 21},${c + 29} ${x - 34},${c - 11}" fill="${DARK}"/>` +
      [[0, -98], [93, -30], [58, 79], [-58, 79], [-93, -30]].map(([dx, dy]) => `<line x1="${x + dx * .38}" y1="${c + dy * .38}" x2="${x + dx * .9}" y2="${c + dy * .9}" stroke="${DARK}" stroke-width="8"/>`).join('')
  };
  return ring + (G[kind] || G.carga);
}
// Fotos reales de juegos: la del medio más grande, las de los costados atrás; esquinas redondeadas y borde dorado fino.
function _photos(list) {
  const imgs = (list || []).filter(Boolean).slice(0, 3); if (!imgs.length) return _glyph('juegos', RED);
  const card = (img, x, y, w, id, rot) => { const h = Math.round(w * 1.047); return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26"/></clipPath></defs>` +
    `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"><rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="30" fill="${GOLD}" opacity=".9"/><image href="${img}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/></g>`; };
  if (imgs.length === 1) return card(imgs[0], W / 2 - 128, 652, 256, 'ph0', 0); // #845: no toca el titular
  let out = '';
  if (imgs[1]) out += card(imgs[1], 150, 680, 230, 'ph1', -7);
  if (imgs[2]) out += card(imgs[2], W - 380, 680, 230, 'ph2', 7);
  out += card(imgs[0], W / 2 - 140, 630, 280, 'ph0', 0);
  return out;
}
function _matchHero(m) {
  const cy = 790;
  const crest = (x, img, name, color) => `<circle cx="${x}" cy="${cy - 20}" r="112" fill="#fff"/><circle cx="${x}" cy="${cy - 20}" r="119" fill="none" stroke="${GOLD}" stroke-width="3"/>` +
    (img ? `<image href="${img}" x="${x - 82}" y="${cy - 102}" width="164" height="164" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${x}" y="${cy + 14}" text-anchor="middle" font-family="${FONT}" font-size="90" font-weight="900" fill="${DARK}">${esc(clean(name).charAt(0).toUpperCase())}</text>`) +
    ctext(cy + 140, clean(name), 40, '#fff', { maxw: 360, weight: 900 }).replace(`x="${W / 2}"`, `x="${x}"`);
  return crest(285, m.homeImg, m.home, m.homeColor) + crest(W - 285, m.awayImg, m.away, m.awayColor) +
    `<circle cx="${W / 2}" cy="${cy - 20}" r="56" fill="${RED}"/><circle cx="${W / 2}" cy="${cy - 20}" r="63" fill="none" stroke="${GOLD}" stroke-width="3"/><text x="${W / 2}" y="${cy - 4}" text-anchor="middle" font-family="${FONT}" font-size="44" font-weight="900" fill="#fff">VS</text>`;
}
function renderPremium(spec) {
  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="${WHITE}"/>`);
  if (_spade) P.push(`<image href="${_spade}" x="${(W - 150) / 2}" y="250" width="150" height="150"/>`);
  P.push(ctext(448, 'CARGAS 1GIROX', 38, BLACK));
  P.push(ctext(486, 'oficial · cargas automáticas', 24, MUTED, { bold: false }));
  // tarjeta oscura con degradé + brillo detrás de la ilustración + borde dorado
  const accent = /^#[0-9a-f]{6}$/i.test(spec.accent || '') ? spec.accent : RED;
  P.push(`<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1c22"/><stop offset="1" stop-color="#0c0c10"/></linearGradient>` +
    `<radialGradient id="pglow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${accent}" stop-opacity=".45"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="pcard"><rect x="${PX0}" y="${PY0}" width="${PX1 - PX0}" height="${PY1 - PY0}" rx="48"/></clipPath></defs>`);
  P.push(`<rect x="${PX0}" y="${PY0}" width="${PX1 - PX0}" height="${PY1 - PY0}" rx="48" fill="url(#pg)"/>`);
  P.push(`<g clip-path="url(#pcard)"><circle cx="${W / 2}" cy="790" r="330" fill="url(#pglow)"/></g>`);
  const kicker = clean(spec.kicker).toUpperCase();
  if (kicker) P.push(ctext(612, kicker, 30, GOLD, { maxw: 880, spacing: 8 }));
  if (spec.match) P.push(_matchHero(spec.match));
  else if (spec.photos && spec.photos.length) P.push(_photos(spec.photos));
  else P.push(_glyph(spec.icon, accent));
  const h1 = clean(spec.h1), h2 = clean(spec.h2).toUpperCase();
  let y = spec.match ? 1010 : 1012;
  if (h1) { const sz = Math.min(64, fitSize(h1, 64, 860)); P.push(ctext(y, h1, sz, '#fff', { maxw: 880, weight: 900 })); y += 18; }
  if (h2) { const sz = Math.min(104, fitSize(h2, 104, 880)); P.push(ctext(y + sz * 0.86, h2, sz, GOLD2, { maxw: 900, weight: 900 })); y += sz + 22; }
  // #858: CUOTAS de referencia (1 · X · 2) en tres recuadros; con cuotas van 2 beneficios y la aclaración abajo.
  const od = spec.odds && spec.odds.home && spec.odds.away ? spec.odds : null;
  if (od && spec.match) {
    const cells = [[clean(spec.match.home), od.home], ['Empate', od.draw], [clean(spec.match.away), od.away]].filter((c) => c[1]);
    const bw = 258, gap = 22, tot = cells.length * bw + (cells.length - 1) * gap; let bx = (W - tot) / 2; const oy = Math.max(y + 6, 1150);
    for (const [lab, val] of cells) {
      const cxx = bx + bw / 2;
      P.push(`<rect x="${bx}" y="${oy}" width="${bw}" height="112" rx="20" fill="#ffffff" fill-opacity=".06" stroke="${GOLD}" stroke-opacity=".55" stroke-width="2"/>`);
      const ls = Math.min(26, Math.floor(26 * (bw - 30) / Math.max(1, estW(lab, 26, true))));
      P.push(`<text x="${cxx}" y="${oy + 38}" text-anchor="middle" font-family="${FONT}" font-size="${ls}" font-weight="700" fill="${MUT2}">${esc(lab)}</text>`);
      P.push(`<text x="${cxx}" y="${oy + 92}" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="900" fill="${GOLD2}">${Number(val).toFixed(2)}</text>`);
      bx += bw + gap;
    }
    y = oy + 112 + 6;
  }
  const bl = (spec.bullets || []).slice(0, od && spec.match ? 2 : 3);
  let by = Math.max(y + 8, od && spec.match ? y + 14 : 1150);
  for (const b of bl) {
    const sym = esc(String(b[0] || '✓').slice(0, 2)), t = clean(b[1]), sub = clean(b[2]);
    P.push(`<circle cx="182" cy="${by + 32}" r="32" fill="${GOLD}"/><text x="182" y="${by + 47}" text-anchor="middle" font-family="${FONT}" font-size="${sym.length > 1 ? 26 : 38}" font-weight="900" fill="${DARK}">${sym}</text>`);
    const fit1 = estW(t, 34, true) > 700 ? ` textLength="700" lengthAdjust="spacingAndGlyphs"` : '';
    const fit2 = estW(sub, 26, false) > 700 ? ` textLength="700" lengthAdjust="spacingAndGlyphs"` : '';
    P.push(`<text x="240" y="${by + 28}" font-family="${FONT}" font-size="34" font-weight="800" fill="#fff"${fit1}>${esc(t)}</text>`);
    if (sub) P.push(`<text x="240" y="${by + 66}" font-family="${FONT}" font-size="26" font-weight="600" fill="${MUT2}"${fit2}>${esc(sub)}</text>`);
    by += 90;
  }
  // #853 (owner): "ese botón dorado no va, va el de abajo rojo": la foto NO lleva botón (no se puede tocar y confundía); el botón real es
  // el rojo de la historia (linkLabel). En su lugar, una flecha suave que invita a tocar abajo.
  const ctaY = Math.min(PY1 - 150, Math.max(by + 20, 1440));
  P.push(ctext(ctaY + 50, 'Tocá el botón de abajo  ↓', 30, GOLD2, { maxw: 760, weight: 800 }));
  const note = od && spec.match ? 'Cuota de referencia · puede variar en Girox según el horario' : clean(spec.note);
  if (note) P.push(ctext(ctaY + 110, note, 23, MUT2, { maxw: 880, bold: false, weight: 600 }));
  P.push(ctext(1672, 'Gracias por confiar en CARGAS 1GIROX', 28, MUTED));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

// ───────────────────────── #931 ESTILO DE LA PÁGINA (owner: "un estilo más del estilo de la página, todo") ─────────────────────────
// Como la app (pin.css): fondo BLANCO, pica + CARGAS 1GIROX arriba, subtítulo en píldora roja suave, tarjeta GRIS CLARO redondeada con la
// ilustración en círculo rojo (sin dorado ni fondo negro), titular negro + línea grande ROJA, 3 beneficios con marcador rojo sobre filas
// blancas, flecha roja al botón de abajo y nota gris. spec.style = 'page'. Mismos campos que 'premium'.
const SOFT = '#ffe9ec', LINE = '#e5e5ea', TXT2 = '#3f3f46';
function renderPage(spec) {
  const P = [];
  P.push(`<rect width="${W}" height="${H}" fill="${WHITE}"/>`);
  if (_spade) P.push(`<image href="${_spade}" x="${(W - 150) / 2}" y="250" width="150" height="150"/>`);
  P.push(ctext(448, 'CARGAS 1GIROX', 38, BLACK));
  P.push(ctext(486, 'oficial · cargas automáticas', 24, MUTED, { bold: false }));
  const accent = /^#[0-9a-f]{6}$/i.test(spec.accent || '') ? spec.accent : RED;
  P.push(`<rect x="${PX0}" y="${PY0}" width="${PX1 - PX0}" height="${PY1 - PY0}" rx="48" fill="${GRAY}" stroke="${LINE}" stroke-width="2"/>`);
  const kicker = clean(spec.kicker).toUpperCase();
  if (kicker) { const kw = Math.min(880, estW(kicker, 28, true) + 10 * (kicker.length - 1) + 80); P.push(`<rect x="${(W - kw) / 2}" y="${PY0 + 44}" width="${kw}" height="58" rx="29" fill="${SOFT}"/>`); P.push(ctext(PY0 + 84, kicker, 28, RED, { maxw: 840, spacing: 6 })); }
  if (spec.match) P.push(_matchHero(spec.match).split(GOLD).join(LINE));
  else if (spec.photos && spec.photos.length) P.push(_photos(spec.photos).split(GOLD).join('#ffffff'));
  else P.push(_glyph(spec.icon, accent).split(GOLD).join('#ffffff'));
  const h1 = clean(spec.h1), h2 = clean(spec.h2).toUpperCase();
  let y = spec.match ? 1010 : 1012;
  if (h1) { const sz = Math.min(64, fitSize(h1, 64, 860)); P.push(ctext(y, h1, sz, BLACK, { maxw: 880, weight: 900 })); y += 18; }
  if (h2) { const sz = Math.min(104, fitSize(h2, 104, 880)); P.push(ctext(y + sz * 0.86, h2, sz, RED, { maxw: 900, weight: 900 })); y += sz + 22; }
  const od = spec.odds && spec.odds.home && spec.odds.away ? spec.odds : null;
  if (od && spec.match) {
    const cells = [[clean(spec.match.home), od.home], ['Empate', od.draw], [clean(spec.match.away), od.away]].filter((c) => c[1]);
    const bw = 258, gap = 22, tot = cells.length * bw + (cells.length - 1) * gap; let bx = (W - tot) / 2; const oy = Math.max(y + 6, 1150);
    for (const [lab, val] of cells) {
      const cxx = bx + bw / 2;
      P.push(`<rect x="${bx}" y="${oy}" width="${bw}" height="112" rx="20" fill="#fff" stroke="${LINE}" stroke-width="2"/>`);
      const ls = Math.min(26, Math.floor(26 * (bw - 30) / Math.max(1, estW(lab, 26, true))));
      P.push(`<text x="${cxx}" y="${oy + 38}" text-anchor="middle" font-family="${FONT}" font-size="${ls}" font-weight="700" fill="${MUTED}">${esc(lab)}</text>`);
      P.push(`<text x="${cxx}" y="${oy + 92}" text-anchor="middle" font-family="${FONT}" font-size="50" font-weight="900" fill="${RED}">${Number(val).toFixed(2)}</text>`);
      bx += bw + gap;
    }
    y = oy + 112 + 6;
  }
  const bl = (spec.bullets || []).slice(0, od && spec.match ? 2 : 3);
  let by = Math.max(y + 8, od && spec.match ? y + 14 : 1150);
  for (const b of bl) {
    const sym = esc(String(b[0] || '✓').slice(0, 2)), t = clean(b[1]), sub = clean(b[2]);
    P.push(`<rect x="${PX0 + 40}" y="${by - 6}" width="${PX1 - PX0 - 80}" height="78" rx="18" fill="#fff" stroke="${LINE}" stroke-width="2"/>`);
    P.push(`<circle cx="182" cy="${by + 32}" r="30" fill="${RED}"/><text x="182" y="${by + 46}" text-anchor="middle" font-family="${FONT}" font-size="${sym.length > 1 ? 24 : 34}" font-weight="900" fill="#fff">${sym}</text>`);
    const fit1 = estW(t, 33, true) > 690 ? ` textLength="690" lengthAdjust="spacingAndGlyphs"` : '';
    const fit2 = estW(sub, 25, false) > 690 ? ` textLength="690" lengthAdjust="spacingAndGlyphs"` : '';
    P.push(`<text x="236" y="${by + 27}" font-family="${FONT}" font-size="33" font-weight="800" fill="${BLACK}"${fit1}>${esc(t)}</text>`);
    if (sub) P.push(`<text x="236" y="${by + 61}" font-family="${FONT}" font-size="25" font-weight="600" fill="${TXT2}"${fit2}>${esc(sub)}</text>`);
    by += 92;
  }
  const ctaY = Math.min(PY1 - 150, Math.max(by + 16, 1440));
  P.push(ctext(ctaY + 50, 'Tocá el botón de abajo  ↓', 30, RED, { maxw: 760, weight: 900 }));
  const note = od && spec.match ? 'Cuota de referencia · puede variar en Girox según el horario' : clean(spec.note);
  if (note) P.push(ctext(ctaY + 110, note, 23, MUTED, { maxw: 880, bold: false, weight: 600 }));
  P.push(ctext(1672, 'Gracias por confiar en CARGAS 1GIROX', 28, MUTED));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${P.join('')}</svg>`;
}

/** Baja una imagen (escudo / foto del juego) y la devuelve como data URL (≤ 600 KB, 8 s). null si falla. */
async function fetchImageData(url) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  const first = await _fetchImageDataOnce(url); return first || _fetchImageDataOnce(url); // #845: un reintento (cortes de red)
}
async function _fetchImageDataOnce(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) return null;
    const type = String(r.headers.get('content-type') || 'image/png').split(';')[0];
    if (!/^image\/(png|jpe?g|webp)$/i.test(type)) return null; // #844 (seguridad): sólo mapas de bits (nada de SVG externo)
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 600 * 1024) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (_) { return null; } finally { clearTimeout(t); }
}

/** #845: foto LOCAL del repo (ej. /images/games/x.jpg) como data URL, para embeberla en la historia. */
function localImageData(relPath) {
  try {
    if (!/^\/images\/[\w.\-\/]+\.(jpg|jpeg|png|webp)$/i.test(String(relPath || ''))) return null;
    const f = path.join(__dirname, '../../public', relPath); const buf = fs.readFileSync(f);
    const ext = relPath.split('.').pop().toLowerCase(); const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}
module.exports = { renderSvg, fetchImageData, localImageData, W, H };
