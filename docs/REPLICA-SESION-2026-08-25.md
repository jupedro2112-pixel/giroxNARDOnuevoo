# RÉPLICA sesión 2026-08-25 (#201 del original) — 3 correcciones del owner

> Para la repo gemela, que ya aplicó todo hasta el #200 del original (fix
> about:blank del casino). Copiá TODO este documento como prompt inicial en una
> sesión parada en esa repo. Convenciones de siempre: verificá con grep antes
> de tocar (las repos pueden divergir), `node --check` en cada JS tocado, bump
> de SW de la PWA (UNO para todo esto), WORKLOG, commit + push. Los fixes 2 y 3
> son front; el 1 es backend → **necesita redeploy del back, no solo estáticos**.

---

## FIX 1 — El mensaje del bono por instalar la app mostraba "${amount}" LITERAL

**Síntoma (captura del owner):** el cliente reclama el bono de la app y el chat
le dice "Te acreditamos tu BONO DE ${amount} por instalar la app".

**Causa:** el comando `/sys_install_bonus` guardado en la BASE quedó de la era
en que ese bono acreditaba un monto fijo. El flujo actual (100% en la PRÓXIMA
carga, lo aplica el agente — no se acredita monto al reclamar) renderiza con
`renderSystemCommand('/sys_install_bonus', fallback, { username })` → solo
reemplaza `{username}`; el `{amount}` del texto viejo queda sin reemplazar y el
cliente ve "${amount}" tal cual.

**Fix (server.js, 2 partes):**

1. **Seed actualizado** — en la lista de comandos de sistema sembrados
   (`systemCmds` dentro de `initializeData`; el seed usa `$setOnInsert`, así
   que solo aplica a instalaciones frescas), la entrada `/sys_install_bonus`
   pasa a:
   - description: `'Mensaje cuando el usuario reclama el bono por instalar la
     app (100% en su PRÓXIMA carga — no se acredita monto, lo aplica el
     agente). Variables: {username}'`
   - response: `'🎁 ¡Listo {username}! Tenés un *100% de bono en tu próxima
     carga*.\n\nCuando vayas a cargar, avisale al agente que tenés el bono del
     100% por instalar la app y te lo aplica en el momento. 🥳\n\n⚠️ Es por
     única vez.'`
2. **Migración one-shot al boot** — al final de `initializeData`, después de la
   migración existente de `/sys_reminder` (mismo patrón):

   ```js
   try {
     const r = await Command.updateOne(
       { name: '/sys_install_bonus', response: /\{amount\}/ },
       { $set: { response: '🎁 ¡Listo {username}! Tenés un *100% de bono en tu próxima carga*.\n\nCuando vayas a cargar, avisale al agente que tenés el bono del 100% por instalar la app y te lo aplica en el momento. 🥳\n\n⚠️ Es por única vez.' } }
     );
     if (r.modifiedCount) console.log('✅ /sys_install_bonus con "${amount}" viejo → texto vigente (100% próxima carga)');
   } catch (e) {
     console.warn(`⚠️ Migración /sys_install_bonus: ${e.message}`);
   }
   ```

   Idempotente: tras pisarlo deja de matchear; un texto editado a mano sin
   `{amount}` no se toca. El owner NO tiene que borrar/editar nada.

   ⚠️ Antes de replicar, verificá en la gemela cómo se llama su flujo del bono
   de instalación y si su texto también quedó con `{amount}` — si su comando ya
   está bien, solo actualizá el seed por prolijidad.

**PROBAR:** redeploy del back → el primer boot loguea la línea de la migración
→ reclamar el bono con un usuario de prueba → el mensaje sale con el texto
nuevo, sin "${amount}". En panel → COMANDOS → `/sys_install_bonus` se ve el
texto vigente.

---

## FIX 2 — "💸 Solicitar Retiro" del casino abre el FORMULARIO REAL de retiro (→ sector Pagos)

**Síntoma:** en el widget del casino, "Solicitar Retiro" solo mandaba el texto
"Quiero retirar mi premio" al chat de CARGAS — el pedido nunca llegaba al
sector PAGOS, no cargaba los datos bancarios y alentecía todo. En el chat
normal de la página SÍ existe el flujo bueno: botón "💸 RETIRAR MI PREMIO" →
modal autogestionado (titular + CBU/alias + verificación SMS) →
`/api/withdrawal/request` → bandeja de Pagos.

**Fix (`public/js/ui.js`, en `VIP.ui.casinoQuickAction`, case `'retirar'`):**
en vez de `_casinoSendQuick(...)`, abrir el MISMO modal del chat normal:

```js
case 'retirar': {
  // FORMULARIO REAL de retiro: antes solo mandaba "quiero retirar" al chat de
  // CARGAS — el pedido nunca llegaba al sector PAGOS. Ahora abre el MISMO modal
  // autogestionado del chat normal (datos bancarios + SMS →
  // /api/withdrawal/request → bandeja de Pagos).
  try {
    if (VIP.withdraw && VIP.withdraw.openWithdrawModal) {
      // El overlay del casino vive en z-index 99999 y los modales en 10000:
      // se eleva el modal para que se vea ENCIMA del casino.
      const m = document.getElementById('withdrawModal');
      if (m) m.style.zIndex = '100001';
      VIP.withdraw.openWithdrawModal();
      break;
    }
  } catch (e) { /* si el módulo no está, cae al mensaje de siempre */ }
  VIP.ui._casinoSendQuick('💸 Quiero retirar mi premio');
  break;
}
```

⚠️ Verificá en la gemela los nombres reales con grep: el módulo del retiro
autogestionado (`VIP.withdraw.openWithdrawModal` en el original, archivo
`public/js/withdraw.js`), el id del modal (`withdrawModal`) y los z-index de su
overlay del casino (99999) y sus modales (10000) — el número elevado tiene que
quedar POR ENCIMA del overlay del casino.

**PROBAR:** entrar al casino embebido → widget → "Solicitar Retiro" → el
formulario se abre ENCIMA del juego → completar datos + SMS → el retiro
aparece en la pestaña de PAGOS del panel con los datos bancarios, igual que
desde el chat normal. Cancelar el modal devuelve al casino intacto.

---

## FIX 3 — Header del widget del casino: "Soporte <MARCA>" → "Carga rápida <MARCA>"

**Motivo:** los clientes confundían el widget nuestro con el soporte propio de
la página del casino.

**Fix (`ui.js`, en el HTML inline del widget/drawer del casino):** el título
del header verde pasa de `Soporte <MARCA>` a **`Carga rápida <MARCA>`** (en el
original: "Carga rápida 1GIROX" — usar la marca de la gemela). El subtítulo
"EN LÍNEA", la burbuja 🎧 y todo lo demás quedan igual.

**PROBAR:** abrir el widget en el casino → el header dice "Carga rápida
<MARCA>".

---

## CIERRE

UN bump del SW de la PWA para los fixes 2 y 3 (en el original quedó v110).
`node --check` de server.js y ui.js. WORKLOG con una entrada por fix (o una
sola con los 3). Commit + push. Deploy del BACK (por el fix 1) y correr los
tres "PROBAR".
