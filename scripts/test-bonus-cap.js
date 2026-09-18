#!/usr/bin/env node
/**
 * test-bonus-cap.js — tope de los bonos automáticos (owner 2026-09-18):
 * "si es un bono de 50%, aplica hasta $20.000 de carga; sobre lo que cargue de
 * más va el 20%". Corre con node pelado: node scripts/test-bonus-cap.js
 */
const assert = require('assert');
const cap = require('../src/utils/bonusCap');
const casos = [
  ['50% · carga $10.000 → $5.000 (no pasa el tope)', () => assert.strictEqual(cap.bonusWithCap(10000, 50), 5000)],
  ['50% · carga $20.000 → $10.000 (justo el tope)', () => assert.strictEqual(cap.bonusWithCap(20000, 50), 10000)],
  ['50% · carga $50.000 → $10.000 + 20% de $30.000 = $16.000', () => assert.strictEqual(cap.bonusWithCap(50000, 50), 16000)],
  ['25% (bono app) · carga $50.000 → $5.000 + $6.000 = $11.000', () => assert.strictEqual(cap.bonusWithCap(50000, 25), 11000)],
  ['20% · carga $50.000 → $10.000 (igual al % del resto: sin tope)', () => assert.strictEqual(cap.bonusWithCap(50000, 20), 10000)],
  ['10% · carga $50.000 → $5.000 (menor al % del resto: sin tope)', () => assert.strictEqual(cap.bonusWithCap(50000, 10), 5000)],
  ['100% (reclamo viejo) · carga $30.000 → $20.000 + $2.000 = $22.000', () => assert.strictEqual(cap.bonusWithCap(30000, 100), 22000)],
  ['tope apagado · 50% de $50.000 → $25.000', () => assert.strictEqual(cap.bonusWithCap(50000, 50, { enabled: false }), 25000)],
  ['tope editado ($5.000, resto 20) · 100% de $20.000 → $8.000', () => assert.strictEqual(cap.bonusWithCap(20000, 100, { capArs: 5000, restPct: 20 }), 8000)],
  ['config inválida → defaults', () => assert.deepStrictEqual(cap.normalizeConfig({ capArs: 'x', restPct: 999 }), { enabled: true, capArs: 20000, restPct: 100 })],
  ['texto de la regla', () => assert.strictEqual(cap.describeRule(50), '50% hasta $20.000 de la carga y 20% sobre lo que pase de ahí')],
  ['texto sin tope', () => assert.strictEqual(cap.describeRule(20), '20% de la carga')]
];
let ok = 0;
for (const [n, f] of casos) { try { f(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); } }
console.log(`\n${ok}/${casos.length} casos OK`);
process.exit(ok === casos.length ? 0 : 1);
