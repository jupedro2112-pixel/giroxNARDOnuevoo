// ========================================
// REFUNDS - Reembolsos module
// ========================================

window.VIP = window.VIP || {};

VIP.refunds = (function () {

    async function loadRefundStatus() {
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/refunds/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (response.ok) {
                VIP.state.refundStatus = await response.json();
                updateRefundButtons();
            }
        } catch (error) {
            console.error('Error cargando reembolsos:', error);
        }
        // Nivel VIP en background (no bloquea los reembolsos si la plataforma demora).
        loadVipStatus().catch(() => {});
        // Reembolso acumulativo (de por vida), también en background.
        loadCashbackStatus(false).catch(() => {});
    }

    // ============================================
    // REEMBOLSO ACUMULATIVO de por vida (ESPEC-REEMBOLSO-1GIROX §3/§4)
    // pct% de lo que perdió con SU plata (regalos excluidos), se junta hasta
    // que lo reclama y arranca de 0. `fresh` = botón 🔄 (sin cache, cooldown 30s
    // server-side). Devuelve el estado o null.
    // ============================================
    async function loadCashbackStatus(fresh) {
        try {
            const url = `${VIP.config.API_URL}/api/cashback/status` + (fresh ? '?fresh=1' : '');
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            const data = await response.json().catch(() => null);
            if (response.status === 429 && data && data.error) {
                if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast(data.error, 'error');
                return VIP.state.cashbackStatus || null;
            }
            if (response.ok && data) {
                VIP.state.cashbackStatus = data;
                VIP.state.cashbackStatusAt = Date.now();
            }
        } catch (error) {
            console.error('Error cargando reembolso acumulativo:', error);
        }
        return VIP.state.cashbackStatus || null;
    }

    async function refreshCashback() {
        const btn = document.getElementById('cbkRefreshBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        await loadCashbackStatus(true);
        const overlay = document.getElementById('profileModal');
        if (overlay && overlay.style.display !== 'none') showProfileModal();
    }

    async function claimCashback() {
        const st = VIP.state.cashbackStatus || {};
        const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-AR');
        if (!(st.reclamable > 0)) return;
        const roll = st.rolloverX > 0 ? ` Para retirarlo, apostalo x${st.rolloverX} en el casino.` : '';
        if (!confirm(`¿Reclamar tu reembolso de ${money(st.reclamable)}?\nEntra ya a tu saldo para seguir jugando.${roll}`)) return;
        const btn = document.getElementById('cbkClaimBtn');
        if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = '⏳ Acreditando…'; }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/cashback/claim`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast(data.error || 'No se pudo reclamar. Probá de nuevo.', 'error');
            } else {
                if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast(`💸 ¡Reembolso de ${money(data.amount)} acreditado en tu saldo!`, 'success');
                if (VIP.ui && VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) { /* noop */ } }
            }
        } catch (e) {
            if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast('Error de conexión. Probá de nuevo.', 'error');
        }
        await loadCashbackStatus(false);
        await loadRefundStatus();
        const overlay = document.getElementById('profileModal');
        if (overlay && overlay.style.display !== 'none') showProfileModal();
    }

    // ============================================
    // NIVEL VIP (apostado acumulado — NO confundir con los rangos de reembolso)
    // ============================================

    async function loadVipStatus() {
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/vip/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (response.ok) {
                VIP.state.vipStatus = await response.json();
                updateDashVipBadge();
            }
        } catch (error) {
            console.error('Error cargando nivel VIP:', error);
        }
    }

    // El recuadro USUARIO del dashboard muestra la medalla del nivel en lugar del
    // rótulo genérico. Sin nivel todavía, queda "USUARIO" como siempre.
    function updateDashVipBadge() {
        const v = VIP.state.vipStatus;
        const label = document.querySelector('.dash-user-label');
        if (!label || !v || !v.enabled) return;
        if (v.level) {
            label.textContent = `${v.level.emoji} ${v.level.name.toUpperCase()}`;
            label.title = `Nivel VIP ${v.level.name}`;
        } else {
            label.textContent = 'USUARIO';
        }
    }

    async function claimRakeback() {
        const btn = document.getElementById('vipRakebackBtn');
        if (btn) {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = '⏳ Procesando...';
        }
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/vip/rakeback/claim`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            if (data.success) {
                VIP.ui.showToast(`✅ ${data.message}`, 'success');
                if (VIP.ui.syncBalance) VIP.ui.syncBalance();
                // Deja constancia en el chat (mismo patrón que los reembolsos).
                if (VIP.chat && VIP.chat.sendSystemMessage) {
                    VIP.chat.sendSystemMessage(`💸 Rakeback semanal reclamado: $${(data.amount || 0).toLocaleString()}`);
                }
            } else {
                VIP.ui.showToast(`ℹ️ ${data.message}`, 'info');
            }
        } catch (error) {
            VIP.ui.showToast('Error de conexión', 'error');
        }
        // Refrescar y re-dibujar el perfil con el estado nuevo (reclamado o no).
        await loadVipStatus().catch(() => {});
        const overlay = document.getElementById('profileModal');
        if (overlay && overlay.style.display !== 'none') showProfileModal();
    }

    function updateRefundButtons() {
        if (!VIP.state.refundStatus) return;
        // (El reembolso DIARIO se eliminó el 2026-08-07 — solo semanal y mensual.)
        updateRefundButton('weekly', VIP.state.refundStatus.weekly);
        updateRefundButton('monthly', VIP.state.refundStatus.monthly);
        updateRefundLabels();
    }

    // Actualiza los % visibles (tooltips de los botones del dashboard y los spans
    // del modal unificado) con el valor real configurado en el panel.
    function updateRefundLabels() {
        const s = VIP.state.refundStatus;
        if (!s) return;
        const tip = (id, label, t) => {
            const el = document.getElementById(id);
            if (el && s[t] && s[t].percentage != null) el.title = `${label} ${s[t].percentage}%`;
        };
        tip('weeklyRefundBtn', 'Reembolso Semanal (Lun-Mar)', 'weekly');
        tip('monthlyRefundBtn', 'Reembolso Mensual (Desde día 7)', 'monthly');
        const pctSpan = (id, t) => {
            const el = document.getElementById(id);
            if (el && s[t] && s[t].percentage != null) el.textContent = s[t].percentage;
        };
        pctSpan('unifiedWeeklyPct', 'weekly');
        pctSpan('unifiedMonthlyPct', 'monthly');

        // "Información del servicio": el tope de reembolso ya no va hardcodeado
        // en el HTML (los rangos se editan desde el panel) — acá se completa con
        // el % MÁXIMO real de las escaleras que mandó el backend.
        const ladders = s.tiersByPeriod
            ? [s.tiersByPeriod.weekly, s.tiersByPeriod.monthly]
            : [s.tiers];
        let maxPct = 0;
        ladders.forEach((ts) => (ts || []).forEach((t) => { if (t && t.pct > maxPct) maxPct = t.pct; }));
        if (maxPct > 0) {
            const setTxt = (id, txt) => {
                const el = document.getElementById(id);
                if (el) el.textContent = txt;
            };
            setTxt('infoRefundsTitle', `Reembolsos hasta ${maxPct}%`);
            setTxt('adRefundsTitle', `Reembolsos hasta ${maxPct}%`);
        }
    }

    function updateRefundButton(type, data) {
        const btn    = document.getElementById(`${type}RefundBtn`);
        const amount = document.getElementById(`${type}RefundAmount`);
        const timer  = document.getElementById(`${type}RefundTimer`);

        amount.textContent = `$${data.potentialAmount.toLocaleString()}`;

        // Etiqueta del % arriba a la derecha del botón. Sale de la pérdida DE ESE
        // período, así que cada reembolso puede tener el suyo. Desde los niveles
        // VIP (2026-08-03) se muestra SOLO el % — los nombres/medallas
        // Bronce/Plata/Oro quedaron exclusivos del nivel VIP para no confundir.
        if (btn && data.tier) {
            let badge = btn.querySelector('.refund-tier');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'refund-tier';
                btn.appendChild(badge);
            }
            badge.textContent = `${data.tier.pct}%`;
            badge.title = `${data.tier.pct}% de reembolso según tu pérdida del período`;
            badge.style.borderColor = data.tier.color;
            badge.style.color = data.tier.color;
        }

        btn.disabled = false;
        btn.classList.remove('claimed');

        if (data.canClaim && data.potentialAmount > 0) {
            timer.textContent = '¡Listo!';
            btn.style.opacity = '1';
        } else {
            btn.style.opacity = '0.7';
            if (data.nextClaim) {
                startCountdown(type, data.nextClaim);
            } else {
                timer.textContent = 'Ver info';
            }
        }
    }

    function startCountdown(type, targetDate) {
        const timerElement = document.getElementById(`${type}RefundTimer`);

        function update() {
            const now    = getArgentinaDate();
            const target = new Date(targetDate);
            const diff   = target - now;

            if (diff <= 0) {
                timerElement.textContent = '¡Listo!';
                loadRefundStatus();
                return;
            }

            const hours   = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 24) {
                timerElement.textContent = `${Math.floor(hours / 24)}d`;
            } else {
                timerElement.textContent = `${hours}h ${minutes}m`;
            }
        }

        update();
        if (VIP.state.refundTimers[type]) clearInterval(VIP.state.refundTimers[type]);
        VIP.state.refundTimers[type] = setInterval(update, 60000);
    }

    async function showRefundModal(type) {

        if (!VIP.state.refundStatus) {
            VIP.ui.showToast('Cargando información de reembolsos...', 'info');
            await loadRefundStatus();
            if (!VIP.state.refundStatus) {
                VIP.ui.showToast('Error: No se pudo cargar la información de reembolsos. Intenta recargar la página.', 'error');
                return;
            }
        }

        const typeData = VIP.state.refundStatus[type];
        // Los porcentajes son configurables desde el panel; los tomamos del estado
        // (campo `percentage` que devuelve /api/refunds/status) en vez de hardcodear.
        const pctOf = (t) => {
            const p = VIP.state.refundStatus[t] && VIP.state.refundStatus[t].percentage;
            return (p !== undefined && p !== null) ? p : { weekly: 10, monthly: 5 }[t];
        };
        const titles = {
            weekly:  `📆 Reembolso Semanal (${pctOf('weekly')}%)`,
            monthly: `🗓️ Reembolso Mensual (${pctOf('monthly')}%)`
        };
        const periodLabels = {
            weekly:  '🎮 TU NETWIN DE LA SEMANA PASADA (Lun-Dom)',
            monthly: '🎮 TU NETWIN DEL MES PASADO'
        };

        document.getElementById('refundModalTitle').textContent = titles[type];
        document.getElementById('refundMovementsTitle').textContent = periodLabels[type];

        const currentBalance = VIP.state.refundStatus.user?.currentBalance || 0;
        document.getElementById('refundCurrentBalance').textContent = `$${currentBalance.toLocaleString()}`;
        document.getElementById('refundPeriod').textContent = typeData.period || '-';
        document.getElementById('refundNetAmount').textContent = `$${(typeData.netAmount || 0).toLocaleString()}`;
        document.getElementById('refundAmount').textContent = `$${(typeData.potentialAmount || 0).toLocaleString()}`;

        const availabilityInfo = document.getElementById('refundAvailabilityInfo');
        availabilityInfo.style.display = 'none';
        availabilityInfo.innerHTML = '';

        if (type === 'weekly') {
            const today = new Date().getDay();
            const isClaimableDay = today === 1 || today === 2;
            if (!isClaimableDay) {
                availabilityInfo.style.display = 'block';
                availabilityInfo.style.background = 'rgba(255,165,0,0.1)';
                availabilityInfo.style.border = '1px solid rgba(255,165,0,0.3)';
                availabilityInfo.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">ℹ️</span>
                        <div>
                            <p style="color: #ffa500; font-weight: bold; margin: 0; font-size: 12px;">Reembolso Semanal</p>
                            <p style="color: #ccc; margin: 0; font-size: 11px;">Solo reclamable los días <strong>LUNES y MARTES</strong></p>
                            <p style="color: #aaa; margin: 0; font-size: 10px;">Corresponde a la semana anterior (Lunes a Domingo)</p>
                        </div>
                    </div>
                `;
            }
        } else if (type === 'monthly') {
            const today = new Date().getDate();
            const isClaimableDay = today >= 7;
            if (!isClaimableDay) {
                availabilityInfo.style.display = 'block';
                availabilityInfo.style.background = 'rgba(255,165,0,0.1)';
                availabilityInfo.style.border = '1px solid rgba(255,165,0,0.3)';
                availabilityInfo.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">ℹ️</span>
                        <div>
                            <p style="color: #ffa500; font-weight: bold; margin: 0; font-size: 12px;">Reembolso Mensual</p>
                            <p style="color: #ccc; margin: 0; font-size: 11px;">Solo reclamable <strong>después del día 7</strong> de cada mes</p>
                            <p style="color: #aaa; margin: 0; font-size: 10px;">Corresponde al mes anterior completo</p>
                        </div>
                    </div>
                `;
            }
        }

        const extraInfo = document.getElementById('refundExtraInfo');
        const claimBtn  = document.getElementById('claimRefundBtn');
        let isClaimed     = false;
        let timeRemaining = '';

        if (typeData.lastClaim) {
            const lastClaim = new Date(typeData.lastClaim);
            const now = new Date();

            if (type === 'weekly') {
                const nextMonday = new Date(lastClaim);
                const daysUntilMonday = (8 - lastClaim.getDay()) % 7 || 7;
                nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
                nextMonday.setHours(0, 0, 0, 0);
                if (now < nextMonday) {
                    isClaimed = true;
                    const diff = nextMonday - now;
                    const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    timeRemaining = `${days}d ${hours}h`;
                }
            } else if (type === 'monthly') {
                const nextMonth = new Date(lastClaim.getFullYear(), lastClaim.getMonth() + 1, 7);
                nextMonth.setHours(0, 0, 0, 0);
                if (now < nextMonth) {
                    isClaimed = true;
                    const diff = nextMonth - now;
                    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                    timeRemaining = `${days}d`;
                }
            }
        }

        if (typeData.potentialAmount <= 0) {
            extraInfo.innerHTML = '<span style="color: #ff8888;">⚠️ No tenés pérdida (NETWIN) en el período. El reembolso es sobre lo que perdiste jugando.</span>';
            claimBtn.disabled = true;
            claimBtn.textContent = '❌ Sin pérdida para reembolsar';
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
        } else if (isClaimed) {
            extraInfo.innerHTML = `<span style="color: #ffaa44;">⏳ Ya reclamaste este reembolso. Disponible en: <strong>${timeRemaining}</strong></span>`;
            claimBtn.disabled = true;
            claimBtn.textContent = `⏳ Disponible en ${timeRemaining}`;
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
        } else if (!typeData.canClaim) {
            extraInfo.innerHTML = '<span style="color: #ffaa44;">⏳ No puedes reclamar este reembolso en este momento.</span>';
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ No disponible';
            claimBtn.style.background = 'linear-gradient(135deg, #666 0%, #444 100%)';
        } else {
            extraInfo.innerHTML = '<span style="color: #00ff88;">✅ ¡Puedes reclamar este reembolso!</span>';
            claimBtn.disabled = false;
            claimBtn.textContent = '🎁 Reclamar Reembolso';
            claimBtn.style.background = '';
        }

        claimBtn.onclick = () => claimRefund(type);

        VIP.ui.showModal('refundModal');
    }

    async function claimRefund(type) {
        const claimBtn = document.getElementById('claimRefundBtn');
        if (claimBtn) {
            if (claimBtn.disabled) return;
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ Procesando...';
        }
        try {
            const metaEventId = VIP.pixel && VIP.pixel.enabled ? VIP.pixel.newEventId() : null;
            const response = await fetch(`${VIP.config.API_URL}/api/refunds/claim/${type}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ metaEventId })
            });

            const data = await response.json();

            if (data.success) {
                VIP.ui.showToast(`✅ ${data.message}`, 'success');
                VIP.ui.hideModal('refundModal');
                loadRefundStatus();
                VIP.chat.sendSystemMessage(`🎁 Reembolso ${type} reclamado: $${data.amount.toLocaleString()}`);

                // Meta Pixel — RefundClaim (custom, deduplicado con CAPI).
                if (VIP.pixel) VIP.pixel.trackWithId(metaEventId, 'RefundClaim', {
                    value: data.amount,
                    currency: 'ARS',
                    content_name: `refund_${type}`
                });
            } else {
                VIP.ui.showToast(`ℹ️ ${data.message}`, 'info');
                VIP.ui.hideModal('refundModal');
                loadRefundStatus();
            }
        } catch (error) {
            VIP.ui.showToast('Error de conexión', 'error');
        } finally {
            if (claimBtn) {
                claimBtn.disabled = false;
                claimBtn.textContent = '🎁 Reclamar Reembolso';
            }
        }
    }

    async function showUnifiedRefundModal() {
        // Req 3: Precargar el estado de reembolsos ANTES de mostrar el modal unificado,
        // para que al presionar una opción funcione de inmediato sin depender de cargas previas.
        if (!VIP.state.refundStatus) {
            await loadRefundStatus();
        }
        VIP.ui.showModal('unifiedRefundModal');
    }

    // ============================================
    // PERFIL DEL JUGADOR: NIVEL VIP + REEMBOLSOS
    // ============================================

    /**
     * Modal que se abre al tocar el recuadro USUARIO. Muestra el NIVEL VIP (por
     * apostado acumulado, con barra de progreso y rakeback semanal) y los
     * reembolsos por período.
     *
     * ⚠️ Son DOS escalas distintas a propósito:
     *  - Nivel VIP: permanente, sube por apostado de por vida (Bronce…Diamante).
     *  - % de reembolso: POR PERÍODO, sale de la pérdida de ese período puntual y
     *    puede variar entre el semanal y el mensual. Se muestra SOLO el % (sin
     *    nombres de rango) para que no se confunda con el nivel VIP.
     */
    async function showProfileModal() {
        if (!VIP.state.refundStatus) {
            await loadRefundStatus();
        }
        if (!VIP.state.vipStatus) {
            await loadVipStatus();
        }
        if (!VIP.state.cashbackStatus) {
            await loadCashbackStatus(false);
        }
        const s = VIP.state.refundStatus;
        const v = VIP.state.vipStatus;
        const cb = VIP.state.cashbackStatus;
        const user = VIP.state.currentUser || {};
        const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-AR');

        // ==========================================================
        // REEMBOLSO ACUMULATIVO (de por vida) — tarjeta con el monto grande y
        // el botón RECLAMAR. Solo se muestra si la feature está encendida en el
        // panel. Textos sin jerga: "esto es tu reembolso, lo tocás y entra ya".
        // ==========================================================
        let cashbackHtml = '';
        if (cb && cb.enabled) {
            const ago = VIP.state.cashbackStatusAt ? Math.max(0, Math.round((Date.now() - VIP.state.cashbackStatusAt) / 1000)) : null;
            const ok = !cb.unavailable && cb.reclamable > 0 && cb.reclamable >= (cb.minArs || 0);
            let cuerpo;
            if (cb.unavailable) {
                cuerpo = `<div style="font-size:12px;color:#ddd;text-align:center;padding:6px 0;">No pudimos calcular tu reembolso ahora. Probá en unos minutos.</div>`;
            } else {
                const nota = ok
                    ? `Tocá RECLAMAR y entra <strong style="color:#fff;">YA</strong> a tu saldo. O seguí juntando: no se vence.`
                    : (cb.reclamable > 0
                        ? `Se reclama desde ${money(cb.minArs)}. Seguí jugando: se junta solo.`
                        : `Se va juntando solo a medida que jugás: el ${cb.pct}% de lo que perdés con tu plata vuelve acá.`);
                cuerpo = `<div style="text-align:center;padding:4px 0 2px;">
                        <div style="font-size:11px;color:#9aa4b0;letter-spacing:.4px;">TU REEMBOLSO DISPONIBLE</div>
                        <div style="font-size:32px;font-weight:900;color:${ok ? '#4dd0ff' : '#5a6672'};margin:2px 0;text-shadow:0 2px 8px rgba(77,208,255,0.25);">${money(cb.reclamable)}</div>
                        <div style="font-size:11px;color:#9aa4b0;line-height:1.45;">${nota}</div>
                    </div>`;
            }
            const cta = ok
                ? `<button type="button" id="cbkClaimBtn" onclick="VIP.refunds.claimCashback()"
                       style="width:100%;margin-top:10px;background:linear-gradient(135deg,#0b5a7a,#1497c9);color:#fff;
                              border:1px solid #4dd0ff;padding:11px;border-radius:12px;font-weight:900;font-size:13px;cursor:pointer;">
                       💸 RECLAMAR ${money(cb.reclamable)} AHORA
                   </button>`
                : '';
            const roll = cb.rolloverX > 0
                ? `<div style="font-size:10px;color:#888;margin-top:6px;line-height:1.4;">Se acredita como bono: para retirarlo apostalo x${cb.rolloverX}.${cb.maxDailyArs > 0 ? ` Tope ${money(cb.maxDailyArs)} por día.` : ''}</div>`
                : (cb.maxDailyArs > 0 ? `<div style="font-size:10px;color:#888;margin-top:6px;">Tope ${money(cb.maxDailyArs)} por día.</div>` : '');
            cashbackHtml = `
                <div style="font-size:13px;font-weight:800;color:#4dd0ff;margin-bottom:8px;">💸 Tu reembolso acumulativo</div>
                <div style="padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:14px;border:1px solid rgba(77,208,255,0.35);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-size:10px;color:#6f7a86;">
                            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#26e07f;box-shadow:0 0 6px #26e07f;margin-right:4px;"></span>EN VIVO${ago != null ? ' · hace ' + (ago < 5 ? 'instantes' : ago + ' s') : ''}
                        </span>
                        <button type="button" id="cbkRefreshBtn" onclick="VIP.refunds.refreshCashback()"
                            style="background:rgba(255,255,255,0.10);border:none;color:#cfd6de;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;">🔄 Actualizar</button>
                    </div>
                    ${cuerpo}
                    ${cta}
                    <div style="font-size:10.5px;color:#999;margin-top:8px;line-height:1.45;">
                        El ${cb.pct}% de lo que perdés jugando <strong>con tu plata</strong> (los bonos y regalos no cuentan) se junta acá
                        de por vida y lo reclamás cuando quieras. Al reclamar arranca de 0. Solo cuenta casino, no deportes.
                    </div>
                    ${roll}
                </div>`;
        }

        // ==========================================================
        // Sección NIVEL VIP — versión SIMPLE (owner 2026-08-04): sin números
        // de apuestas ni umbrales a la vista, solo "progreso para ganar $X"
        // (el bono del próximo nivel). El detalle fino de cómo funciona vive
        // en el desplegable de Términos y condiciones, abajo.
        // ==========================================================
        let vipHtml = '';
        let vipLaddersHtml = '';
        if (v && v.enabled) {
            const lvl = v.level;
            const next = v.next;
            const titulo = lvl
                ? `<span style="font-size:15px;font-weight:900;color:${lvl.color};">${lvl.emoji} Nivel ${lvl.name}</span>`
                : `<span style="font-size:14px;font-weight:900;color:#fff;">⭐ Tu camino VIP</span>`;
            const pct = Math.min(100, Math.max(1, Math.round(v.progressPct || 0)));
            const barra = next
                ? `<div style="margin-top:8px;">
                     <div style="font-size:12px;color:#ffd479;font-weight:800;margin-bottom:6px;line-height:1.4;">
                       🎁 Progreso de tu nivel para ganar <span style="color:#ffd700;">${money(next.levelUpBonusArs)}</span>
                     </div>
                     <div style="display:flex;align-items:center;gap:8px;">
                       <div style="flex:1;height:12px;background:rgba(255,255,255,0.09);border-radius:7px;overflow:hidden;">
                         <div style="height:100%;width:${pct}%;
                                     background:linear-gradient(90deg,#d4af37,#ffd700);border-radius:7px;"></div>
                       </div>
                       <span style="font-size:11px;font-weight:900;color:#ffd700;flex-shrink:0;">${pct}%</span>
                     </div>
                     <div style="font-size:10.5px;color:#999;margin-top:5px;">
                       Jugá y tu progreso sube solo. Al llegar a ${next.emoji} ${next.name}, el bono se acredita automáticamente.
                     </div>
                   </div>`
                : `<div style="font-size:11px;color:#7fe07f;margin-top:5px;">¡Estás en el nivel máximo! 👑</div>`;

            // Rakeback semanal: % de lo APOSTADO la semana pasada, gane o pierda.
            let rakeHtml = '';
            const rk = v.rakeback || {};
            if (rk.eligible && rk.claimed) {
                rakeHtml = `<div style="font-size:11px;color:#7fe07f;margin-top:9px;">
                              ✅ Rakeback de esta semana ya reclamado: <strong>${money(rk.amount)}</strong>
                            </div>`;
            } else if (rk.eligible && rk.canClaim) {
                rakeHtml = `<button type="button" id="vipRakebackBtn" onclick="VIP.refunds.claimRakeback()"
                              style="width:100%;margin-top:10px;background:linear-gradient(135deg,#0f4c00,#1a8200);
                                     color:#fff;border:1px solid #00ff88;padding:10px;border-radius:12px;
                                     font-weight:900;font-size:13px;cursor:pointer;">
                              💸 Reclamar rakeback semanal: ${money(rk.amount)}
                            </button>
                            <div style="font-size:10px;color:#999;margin-top:4px;text-align:center;">
                              ${rk.pct}% de lo que apostaste la semana pasada, ganes o pierdas
                            </div>`;
            } else if (rk.eligible) {
                rakeHtml = `<div style="font-size:11px;color:#999;margin-top:9px;">
                              💸 Rakeback semanal: ${rk.pct}% de lo que apostás (lun a dom), ganes o pierdas.
                              La semana pasada no registrás apuestas.
                            </div>`;
            } else {
                rakeHtml = `<div style="font-size:11px;color:#999;margin-top:9px;">
                              💸 El <strong>rakeback semanal</strong> (te devolvemos un % de TODO lo que
                              apostás, ganes o pierdas) se destraba al llegar a 🥉 Bronce.
                            </div>`;
            }

            // Escalera completa (viene del backend, no se duplica acá). Vive DENTRO
            // de los Términos y condiciones — no a la vista (pedido del owner).
            const curIdx = v.levelIndex || 0;
            vipLaddersHtml = (v.levels || []).map((l) => {
                const alcanzado = l.idx <= curIdx;
                return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                            padding:7px 10px;background:rgba(255,255,255,${alcanzado ? '0.08' : '0.03'});
                            border-radius:8px;border-left:3px solid ${l.color};
                            ${alcanzado ? '' : 'opacity:0.75;'}">
                            <span style="font-size:11.5px;font-weight:800;color:#fff;white-space:nowrap;">
                                ${l.emoji} ${l.name}${alcanzado ? ' ✓' : ''}</span>
                            <span style="font-size:9.5px;color:#aaa;flex:1;text-align:center;">
                                ${money(l.thresholdArs)} apostados</span>
                            <span style="font-size:10px;font-weight:900;color:${l.color};white-space:nowrap;">
                                +${money(l.levelUpBonusArs)} · ${l.rakebackPct}%</span>
                        </div>`;
            }).join('');

            const terminos = `
                <details style="margin-top:10px;">
                    <summary style="cursor:pointer;font-size:11px;color:#999;font-weight:700;
                                    -webkit-tap-highlight-color:rgba(212,175,55,.2);">
                        📄 Términos y condiciones — cómo funciona el nivel VIP
                    </summary>
                    <div style="margin-top:8px;font-size:11px;color:#bbb;line-height:1.55;">
                        <p style="margin:0 0 8px;">
                            • Tu progreso sube con <strong>todo lo que apostás en el casino</strong>,
                            ganes o pierdas. Se acumula de por vida y <strong>nunca baja</strong>.</p>
                        <p style="margin:0 0 8px;">
                            • Al completar el progreso subís de nivel y el <strong>bono se acredita
                            automáticamente</strong> en tu cuenta. Cada nivel paga más que el anterior.</p>
                        <p style="margin:0 0 8px;">
                            • Desde 🥉 Bronce destrabás el <strong>rakeback semanal</strong>: todas las
                            semanas te devolvemos un % de lo que apostaste la semana anterior (lunes a
                            domingo), ganes o pierdas. El % crece con tu nivel.</p>
                        <p style="margin:0 0 10px;">
                            • Cuenta solo el juego de casino. El apostado se actualiza
                            periódicamente, puede demorar unos minutos en reflejarse.</p>
                        <div style="font-size:11.5px;font-weight:800;color:#d4af37;margin-bottom:6px;">Escalera completa</div>
                        <div style="display:flex;flex-direction:column;gap:5px;">${vipLaddersHtml}</div>
                    </div>
                </details>`;

            vipHtml = `
                <div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:8px;">👑 Tu nivel VIP</div>
                <div style="padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:14px;
                            border:1px solid rgba(212,175,55,0.25);">
                    ${titulo}
                    ${barra}
                    ${rakeHtml}
                    ${terminos}
                </div>`;
        }

        // ==========================================================
        // Reembolsos por período (muestran SOLO el %: los nombres de
        // rango quedaron exclusivos del nivel VIP)
        // ==========================================================
        // Escaleras: desde 2026-08-05 cada período puede tener la SUYA (editable
        // en el panel). Si el backend nuevo manda tiersByPeriod se usan esas; si
        // no (backend viejo cacheado), cae a la única `tiers` de siempre.
        const _tierRows = (tiers) => (tiers || []).map((t) => {
            const rango = t.max === null
                ? `más de ${money(t.max === null ? t.min : t.max)}`
                : (t.min === 0 ? `hasta ${money(t.max)}` : `${money(t.min)} a ${money(t.max)}`);
            return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                        padding:9px 12px;background:rgba(255,255,255,0.04);border-radius:9px;
                        border-left:3px solid ${t.color};">
                        <span style="font-size:11px;color:#aaa;flex:1;">Si perdés ${rango}</span>
                        <span style="font-size:14px;font-weight:900;color:${t.color};">${t.pct}%</span>
                    </div>`;
        }).join('');
        const tbp = (s && s.tiersByPeriod) || null;
        const _sameLadder = tbp &&
            JSON.stringify(tbp.weekly) === JSON.stringify(tbp.monthly);
        let tiersHtml;
        if (!tbp || _sameLadder) {
            // Una sola tabla (las 2 escaleras son iguales o backend viejo).
            tiersHtml = _tierRows((tbp && tbp.weekly) || (s && s.tiers) || []);
        } else {
            // Escaleras distintas: una mini-tabla por período.
            const bloque = (label, tiers) =>
                `<div style="font-size:11px;font-weight:800;color:#d4af37;margin:4px 0 2px;">${label}</div>` +
                _tierRows(tiers);
            tiersHtml = bloque('🗓️ Semanal', tbp.weekly) +
                bloque('📆 Mensual', tbp.monthly);
        }

        // Estado por período: % actual + cuánto falta para el % siguiente.
        const periodo = (label, d) => {
            if (!d || !d.tier) return '';
            const t = d.tier;
            const falta = t.faltaParaSubir != null && t.next
                ? `<div style="font-size:11px;color:#ffd479;margin-top:3px;">
                     Te faltan <strong>${money(t.faltaParaSubir)}</strong> de pérdida para el ${t.next.pct}%
                   </div>`
                : `<div style="font-size:11px;color:#7fe07f;margin-top:3px;">¡Estás en el porcentaje máximo! 🎉</div>`;
            return `<div style="padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:10px;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                            <span style="font-size:12px;font-weight:800;color:#d4af37;">${label}</span>
                            <span style="font-size:12px;font-weight:900;color:${t.color};">${t.pct}%</span>
                        </div>
                        <div style="font-size:11px;color:#aaa;margin-top:3px;">
                            Perdiste ${money(d.netAmount)} · te corresponden <strong style="color:#7fe07f;">${money(d.potentialAmount)}</strong>
                        </div>
                        ${falta}
                    </div>`;
        };

        let overlay = document.getElementById('profileModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'profileModal';
            overlay.style.cssText =
                'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.85);display:flex;' +
                'align-items:center;justify-content:center;padding:16px;overflow-y:auto;';
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) VIP.refunds.closeProfileModal();
            });
            document.body.appendChild(overlay);
        }

        overlay.innerHTML =
            `<div style="background:linear-gradient(135deg,#1a0033,#2d0052);border:1px solid rgba(212,175,55,0.4);
                        border-radius:16px;max-width:420px;width:100%;padding:18px;max-height:92vh;overflow-y:auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                    <span style="font-size:17px;font-weight:900;color:#d4af37;">👤 Mi perfil</span>
                    <button type="button" onclick="VIP.refunds.closeProfileModal()"
                        style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;line-height:1;">×</button>
                </div>

                <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:12px;margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
                        <span style="color:#aaa;font-size:12px;">Usuario</span>
                        <span style="color:#fff;font-size:12px;font-weight:800;">${user.username || '—'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;gap:8px;">
                        <span style="color:#aaa;font-size:12px;">Saldo</span>
                        <span style="color:#7fe07f;font-size:12px;font-weight:800;">${money((s && s.user && s.user.currentBalance) || user.balance || 0)}</span>
                    </div>
                </div>

                ${cashbackHtml}

                ${vipHtml}

                <div style="font-size:13px;font-weight:800;color:#d4af37;margin-bottom:8px;">🎁 Tus reembolsos</div>
                <div style="font-size:11px;color:#999;margin-bottom:10px;line-height:1.45;">
                    Cuanto más perdés en un período, mayor es el porcentaje que te devolvemos.
                    El porcentaje se calcula por separado en cada reembolso.
                </div>
                ${periodo('🗓️ Semanal', s && s.weekly)}
                ${periodo('📆 Mensual', s && s.monthly)}

                <div style="font-size:13px;font-weight:800;color:#d4af37;margin:14px 0 8px;">Escala de reembolsos</div>
                <div style="display:flex;flex-direction:column;gap:6px;">${tiersHtml}</div>

                <button type="button" onclick="VIP.refunds.closeProfileModal()"
                    style="width:100%;margin-top:16px;background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;
                           border:none;padding:12px;border-radius:22px;font-weight:800;font-size:14px;cursor:pointer;">
                    Cerrar</button>
            </div>`;
        overlay.style.display = 'flex';
    }

    function closeProfileModal() {
        const overlay = document.getElementById('profileModal');
        if (overlay) overlay.style.display = 'none';
    }

    return {
        loadRefundStatus,
        loadVipStatus,
        claimRakeback,
        updateRefundButtons,
        updateRefundButton,
        startCountdown,
        showRefundModal,
        claimRefund,
        showUnifiedRefundModal,
        showProfileModal,
        closeProfileModal,
        loadCashbackStatus,
        refreshCashback,
        claimCashback
    };

})();

// Window aliases
window.showRefundModal = VIP.refunds.showRefundModal;
window.claimRefund     = VIP.refunds.claimRefund;
