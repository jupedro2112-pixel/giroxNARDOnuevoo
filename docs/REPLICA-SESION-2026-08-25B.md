# RÉPLICA sesión 2026-08-25 tanda B (#202 del original) — burbuja 🎧 del casino ARRASTRABLE

> Para la repo gemela, que ya aplicó todo hasta el #201 del original (las 3
> correcciones: bono sin ${amount}, retiro real desde el casino, header "Carga
> rápida"). Copiá TODO este documento como prompt inicial en una sesión parada
> en esa repo. Es UN solo cambio, solo front (`public/js/ui.js` + bump del SW
> de la PWA). Convenciones de siempre: grep antes de tocar, `node --check`,
> WORKLOG, commit + push, deploy de estáticos.

---

## Qué pasa

**Reporte de un cliente (captura):** la burbuja de soporte 🎧 fija abajo a la
derecha TAPA controles de algunos juegos (ej. la botonera de la ruleta) y "no
hay cómo eliminarla" — lo que queda debajo es imposible de tocar.

**Solución elegida por el owner (entre arrastrable / colapsable /
auto-achicar):** burbuja **ARRASTRABLE** con imán al borde, estilo burbuja de
Messenger.

## Implementación (`public/js/ui.js`)

Dentro de la creación del overlay del casino (el bloque `if (!overlay)` de
`_showCasinoFrame`, después de armar el innerHTML y el listener de `load` del
iframe), agregar una IIFE que hace draggable a `#casinoSupportBubble`:

```js
// BURBUJA ARRASTRABLE: la burbuja fija tapaba controles de algunos juegos
// (ej. la botonera de la ruleta) y el jugador no tenía forma de tocar lo que
// quedaba debajo. Ahora se arrastra con el dedo (o mouse); al soltarla se pega
// al borde izquierdo o derecho (imán) y queda ahí mientras el casino siga
// abierto. Un toque SIN arrastre sigue abriendo el chat como siempre.
(function _makeBubbleDraggable() {
  const b = overlay.querySelector('#casinoSupportBubble');
  if (!b || !window.PointerEvent) return; // sin pointer events → fija como antes
  b.style.touchAction = 'none'; // sin esto, el navegador scrollea en vez de arrastrar
  let startX = 0, startY = 0, startRect = null, dragging = false;
  b.addEventListener('pointerdown', function(e) {
    startX = e.clientX; startY = e.clientY;
    startRect = b.getBoundingClientRect();
    dragging = false;
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
  });
  b.addEventListener('pointermove', function(e) {
    if (!startRect) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    // Umbral tap/arrastre: menos de 8px de movimiento sigue siendo un toque.
    if (!dragging && (Math.abs(dx) + Math.abs(dy)) < 8) return;
    dragging = true;
    const x = Math.min(Math.max(4, startRect.left + dx), window.innerWidth - startRect.width - 4);
    const y = Math.min(Math.max(10, startRect.top + dy), window.innerHeight - startRect.height - 10);
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    b.style.right = 'auto';
    b.style.bottom = 'auto';
  });
  const end = function() {
    if (startRect && dragging) {
      // Imán al borde horizontal más cercano; la altura queda donde la dejó.
      const r = b.getBoundingClientRect();
      const toLeft = (r.left + r.width / 2) < window.innerWidth / 2;
      if (toLeft) { b.style.left = '16px'; b.style.right = 'auto'; }
      else { b.style.left = 'auto'; b.style.right = '16px'; }
      VIP.ui._bubbleSide = toLeft ? 'left' : 'right';
      // El click que dispara el navegador justo después del arrastre NO debe
      // abrir el chat: se marca y se limpia solo a los 400ms (por si el click
      // nunca llega, no queda un toque "muerto").
      VIP.ui._bubbleWasDragged = true;
      setTimeout(function() { VIP.ui._bubbleWasDragged = false; }, 400);
    }
    startRect = null; dragging = false;
  };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
})();
```

Y en `VIP.ui.toggleCasinoChat` (lo que abre/cierra el panel del chat sobre el
casino), al principio:

```js
// Si lo que hubo fue un ARRASTRE de la burbuja, el click posterior no abre.
if (VIP.ui._bubbleWasDragged) return;
```

y antes de mostrar el panel, que se abra del MISMO lado en que quedó la
burbuja (el drawer `#casinoChatDrawer` está anclado con `right:16px` inline):

```js
if (VIP.ui._bubbleSide === 'left') { drawer.style.left = '16px'; drawer.style.right = 'auto'; }
else if (VIP.ui._bubbleSide === 'right') { drawer.style.left = 'auto'; drawer.style.right = '16px'; }
```

**Notas para la gemela:** verificá con grep los ids reales
(`casinoSupportBubble`, `casinoChatDrawer`) y que la burbuja tenga el onclick
de `toggleCasinoChat` — si su widget divergió, adaptá los nombres. La posición
dura mientras el overlay viva (se crea una sola vez); al reingresar al casino
la burbuja arranca en su rincón por defecto, y eso está bien.

## Cierre

Bump del SW de la PWA (en el original quedó **v111**). `node --check` de
ui.js. WORKLOG. Commit + push. Deploy de estáticos.

**PROBAR** (celu, tras 2 aperturas de la app): en el casino, arrastrar la
burbuja a la izquierda → se pega a ese borde y el control que tapaba queda
usable; un toque la abre igual que siempre; con la burbuja a la izquierda el
panel se abre de ese lado; en PC también se arrastra con el mouse.
