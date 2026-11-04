#!/usr/bin/env node
/**
 * Test en frío de la PÁGINA DEL CASINO editable en COMANDOS (`/sys_casino_url`, #228):
 *   - `_cleanCasinoUrl` (server.js): qué se acepta al guardar el comando.
 *   - `girox.createSession`: con otra página cargada, el link de SSO sale con ESE dominio y
 *     conserva `/auth/sso?code=…` (el cliente sigue entrando logueado).
 *   - CSP: el iframe del casino acepta el dominio nuevo y vuelve a la normalidad al vaciarlo.
 * No toca la red ni la base (axios/uuid/logger stubeados; en Tails no hay node_modules).
 *   node scripts/test-casino-url.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let lastAxiosCall = null;
const fakeAxios = async function (cfg) {
  lastAxiosCall = cfg;
  return { status: 200, data: { token: '1|abc', redirect_url: 'https://1girox.com/auth/sso?code=Xy7UNSOLOUSO', logout_url: 'https://1girox.com/logout' } };
};
const _origLoad = Module._load;
const noop = () => {};
Module._load = function (request) {
  if (request === '../utils/logger') return { info: noop, warn: noop, error: noop, debug: noop };
  if (request === 'axios') return fakeAxios;
  try { return _origLoad.apply(this, arguments); } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && request === 'uuid') return { v4: () => '00000000-0000-4000-8000-000000000000' };
    throw e;
  }
};
process.env.GIROX_API_URL = 'https://api.test/api/v1';
process.env.GIROX_API_KEY = 'pk_test';
delete process.env.GIROX_PLAY_URL;
const girox = require('../src/services/giroxService');

// Las funciones de server.js se sacan del archivo REAL (server.js no se puede requerir sin dependencias).
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function grab(re, name) { const m = src.match(re); assert(m, 'no encontré ' + name + ' en server.js'); return m[0]; }
const cleanSrc = grab(/function _cleanCasinoUrl\(raw\) \{[\s\S]*?\n\}/, '_cleanCasinoUrl');
const cspSrc = grab(/function _buildCspHeader\(extraFrameSrc\) \{[\s\S]*?\n\}\nlet CSP_HEADER_VALUE = _buildCspHeader\(''\);[\s\S]*?function _setCasinoFrameOrigin\(origin\) \{[\s\S]*?\n\}/, 'CSP');
// eslint-disable-next-line no-new-func
const env = new Function(cleanSrc + '\n' + cspSrc + '\nreturn { _cleanCasinoUrl, _setCasinoFrameOrigin, csp: () => CSP_HEADER_VALUE };')();

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('  ✓ ' + name); }
const frameSrc = () => env.csp().split('; ').find(p => p.startsWith('frame-src '));

(async () => {
  console.log('Validación del comando:');
  await t('vacío = la de siempre', () => assert.strictEqual(env._cleanCasinoUrl('  '), ''));
  await t('dominio solo → https://', () => assert.strictEqual(env._cleanCasinoUrl('1girox.net'), 'https://1girox.net'));
  await t('barra final y texto de más se ignoran', () => assert.strictEqual(env._cleanCasinoUrl('https://www.1girox.net/ hola'), 'https://www.1girox.net'));
  await t('http se rechaza (embebido en la PWA lo bloquea el navegador)', () => assert.strictEqual(env._cleanCasinoUrl('http://1girox.net'), null));
  await t('texto sin dominio se rechaza', () => assert.strictEqual(env._cleanCasinoUrl('casino nuevo'), null));
  await t('otro esquema se rechaza', () => assert.strictEqual(env._cleanCasinoUrl('javascript:alert(1)'), null));

  console.log('SSO:');
  await t('sin página en COMANDOS el link queda igual', async () => {
    girox.setPlayUrlOverride(null);
    const r = await girox.createSession('juan123');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.redirectUrl, 'https://1girox.com/auth/sso?code=Xy7UNSOLOUSO');
    assert.strictEqual(girox.getPlayUrl(), 'https://1girox.com');
    assert.strictEqual(lastAxiosCall.url, 'https://api.test/api/v1/players/juan123/session');
  });
  await t('con página nueva: mismo /auth/sso?code=… en el dominio nuevo', async () => {
    girox.setPlayUrlOverride('https://www.1girox.net');
    const r = await girox.createSession('juan123');
    assert.strictEqual(r.redirectUrl, 'https://www.1girox.net/auth/sso?code=Xy7UNSOLOUSO');
    assert.strictEqual(r.platformRedirectUrl, 'https://1girox.com/auth/sso?code=Xy7UNSOLOUSO');
    assert.strictEqual(girox.getPlayUrl(), 'https://www.1girox.net');
    // Donde el cliente usa el logout del casino (se carga en el iframe antes del SSO) va al MISMO dominio.
    if ('logoutUrl' in r) assert.strictEqual(r.logoutUrl, 'https://www.1girox.net/logout');
  });
  await t('el camino de la página nueva no pisa el del SSO', () => {
    girox.setPlayUrlOverride('https://casino.test/jugar');
    assert.strictEqual(girox.applyPlayDomain('https://1girox.com/auth/sso?code=A&embed=1'), 'https://casino.test/auth/sso?code=A&embed=1');
  });
  await t('vaciar el comando vuelve a GIROX_PLAY_URL / default', () => {
    girox.setPlayUrlOverride(null);
    assert.strictEqual(girox.getPlayUrl(), 'https://1girox.com');
    assert.strictEqual(girox.applyPlayDomain('https://1girox.com/auth/sso?code=B'), 'https://1girox.com/auth/sso?code=B');
  });

  console.log('CSP del iframe:');
  await t('de base solo 1girox', () => assert(!/1girox\.net/.test(frameSrc()) && /https:\/\/\*\.1girox\.com/.test(frameSrc())));
  await t('con página nueva suma el dominio y su comodín', () => {
    env._setCasinoFrameOrigin('https://www.1girox.net');
    assert(/ https:\/\/www\.1girox\.net https:\/\/\*\.1girox\.net$/.test(frameSrc()), frameSrc());
    assert(env.csp().includes("frame-ancestors 'none'"));
  });
  await t('vaciar vuelve al CSP de siempre', () => {
    env._setCasinoFrameOrigin('');
    assert(!/1girox\.net/.test(frameSrc()));
  });

  console.log(`\n✅ ${n} pruebas OK`);
})().catch(e => { console.error('❌', e && e.stack || e); process.exit(1); });
