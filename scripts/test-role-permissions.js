#!/usr/bin/env node
// #232 Test en frío de src/utils/rolePermissions.js (sin Mongo). Uso: node scripts/test-role-permissions.js
'use strict';
const assert = require('assert');
const rp = require('../src/utils/rolePermissions');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// 1) Los defaults reproducen lo que hacía el código antes de la tabla (post #231)
const d = rp.defaults();
const has = (role, key) => rp.roleHas(d, role, key);
ok(has('admin', 'pwd_client') && !has('depositor', 'pwd_client'), 'solo el admin general cambia claves de clientes (#231)');
ok(['pwd_staff', 'pwd_admin', 'pwd_owner'].every((k) => has('admin', k) && !has('depositor', k) && !has('withdrawer', k) && !has('comunidad', k)), 'claves de staff/admin/dueño: solo admin');
ok(has('depositor', 'create_user') && !has('withdrawer', 'create_user') && !has('comunidad', 'create_user'), 'crear clientes: admin y depositor');
ok(has('admin', 'create_staff') && !has('depositor', 'create_staff'), 'crear staff: solo admin');
ok(has('comunidad', 'deposit') && has('depositor', 'deposit') && !has('withdrawer', 'deposit'), 'cargar = depositorMiddleware');
ok(has('withdrawer', 'payout_pay') && !has('depositor', 'payout_pay') && !has('comunidad', 'withdraw'), 'pagos = withdrawerMiddleware');
ok(has('withdrawer', 'verify_phone') && has('comunidad', 'verify_phone'), 'verify-phone = adminMiddleware (4 roles)');
ok(has('withdrawer', 'tab_payments') && !has('withdrawer', 'tab_open') && !has('depositor', 'tab_payments') && !has('comunidad', 'tab_payments') && has('comunidad', 'tab_comunidad') && !has('depositor', 'tab_comunidad'), 'pestañas = filtros de /api/admin/conversations');
ok(has('depositor', 'users') && !has('withdrawer', 'users') && has('admin', 'banksConfig') && !has('depositor', 'banksConfig'), 'secciones de hoy');

// 2) normalize: basura afuera, faltantes = default, secciones solo dentro de `possible`
const m = rp.normalize({ perms: { deposit: ['withdrawer', 'hacker', 'withdrawer'], inventada: ['admin'] }, sections: { banksConfig: ['admin', 'depositor'], users: [] } });
ok(m.perms.deposit.length === 1 && m.perms.deposit[0] === 'withdrawer', 'rol inválido y repetido se descartan');
ok(!('inventada' in m.perms), 'key desconocida se ignora');
ok(m.perms.bonus.join() === d.perms.bonus.join(), 'key no mandada = su default');
ok(m.sections.banksConfig.join() === 'admin', 'Bancos no se le puede dar a un depositor (possible = admin)');
ok(m.sections.users.length === 0, 'una sección se puede quitar a todos');
ok(rp.normalize(null).perms.pwd_client.join() === 'admin', 'sin nada guardado = defaults');
ok(!rp.roleHas(m, 'admin', 'no_existe'), 'permiso desconocido = NO');

// 3) forRole y diff
const fr = rp.forRole(m, 'withdrawer');
ok(fr.perms.deposit === true && fr.perms.bonus === false && fr.sections.users === false, 'forRole refleja la tabla');
ok(Object.values(rp.forRole(m, 'comunidad', true).perms).every(Boolean), 'all=true (dueño de Seguridad) = todo');
const df = rp.diff(d, m);
ok(df.some((x) => x.key === 'deposit' && x.added.join() === 'withdrawer' && x.removed.length === 3), 'diff marca altas y bajas');
ok(rp.diff(d, rp.defaults()).length === 0, 'sin cambios = diff vacío');

// 4) catálogo sin keys repetidas
const keys = [...rp.PERMS.map((p) => p.key), ...rp.SECTIONS.map((s) => s.key)];
ok(new Set(keys).size === keys.length, 'keys únicas');
ok(rp.SECTIONS.every((s) => s.def.every((r) => s.possible.includes(r))), 'def ⊆ possible en cada sección');

console.log(`✅ rolePermissions: ${n} pruebas OK`);
