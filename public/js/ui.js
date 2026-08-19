// ========================================
// UI - User-interface utilities module
// ========================================

window.VIP = window.VIP || {};

VIP.ui = (function () {

    // ---- Modal helpers ----

    function showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }

    function hideModal(modalId) {
        if (modalId === 'changePasswordModal' && VIP.state.passwordChangePending) {
            return;
        }
        document.getElementById(modalId).classList.add('hidden');

        // Reset OTP step states when closing modals
        if (modalId === 'resetPassModal') {
            const s1 = document.getElementById('resetStep1');
            const s2 = document.getElementById('resetStep2');
            const s3 = document.getElementById('resetStep3');
            if (s1) s1.style.display = '';
            if (s2) s2.style.display = 'none';
            if (s3) s3.style.display = 'none';
        }
        if (modalId === 'registerModal') {
            const s1 = document.getElementById('registerStep1');
            if (s1) s1.style.display = '';
        }
    }

    // ---- Toast & copy ----

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast('✅ Copiado');
        } catch (error) {
            showToast('Error al copiar', 'error');
        }
    }

    function copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        const text = element.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('📋 Copiado al portapapeles', 'success');
            }).catch(() => { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity  = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        try { document.execCommand('copy'); showToast('✅ Copiado', 'success'); } catch (e) {}
        document.body.removeChild(el);
    }

    // ---- Screen switching ----

    function showLoginScreen() {
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('chatScreen').classList.add('hidden');
    }

    function showChatScreen() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('chatScreen').classList.remove('hidden');
        const _username = VIP.state.currentUser?.username || 'Usuario';
        const _curUser = document.getElementById('currentUser');
        if (_curUser) _curUser.textContent = _username;
        const _dashUser = document.getElementById('dashUserName');
        if (_dashUser) _dashUser.textContent = _username;

        adjustLayout();
        syncBalance();
        startBalancePolling();
        sendWelcomeMessages();

        // Cartel del bono por instalar la app (se muestra si no lo reclamó aún).
        if (VIP.installBonus && typeof VIP.installBonus.init === 'function') {
            VIP.installBonus.init();
        }

        // Encuesta de notificaciones: aparece una sola vez para que el
        // usuario elija su grupo (suave / normal / activo / solo reembolsos).
        if (VIP.notifSurvey && typeof VIP.notifSurvey.maybeShow === 'function') {
            VIP.notifSurvey.maybeShow();
        }
        // NOTA: el welcome del publicista NO se muestra acá. Se muestra
        // pre-auth desde app.js al cargar la página si el visitante llegó
        // por una vanity URL / ?p=CODE. Ver public/js/publisherwelcome.js.
    }

    // ---- Layout ----

    function adjustLayout() {
        // El layout ahora es una columna flex (.chat-screen): el header y la
        // barra de escribir están en el flujo normal y el chat ocupa el resto
        // con flex:1. No hace falta compensar con márgenes.
    }

    // ---- Balance ----

    async function syncBalance() {
        if (!VIP.state.currentToken || !VIP.state.currentUser) return;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/balance/live`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.balance !== undefined) {
                    VIP.state.currentUser.balance = data.balance;
                    updateBalanceDisplay(data.balance);

                    const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
                    const newBalance      = parseFloat(data.balance);
                    if (Math.abs(newBalance - previousBalance) > 0.01) {
                        localStorage.setItem('lastBalance', newBalance);
                        if (newBalance > previousBalance) {
                            // Subió el saldo (carga/premio): invitación grande al
                            // casino en vez del toast chico (owner 2026-08-05).
                            showCasinoInvite(newBalance);
                        } else {
                            showBalanceToast(newBalance);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sincronizando saldo:', error);
        }
    }

    // Saldo empujado por SOCKET (el server emite `balance_updated` al acreditar
    // una carga, premio o devolución): mismo tratamiento que el polling, pero
    // instantáneo — el cliente ve la invitación al casino apenas el agente carga.
    function handleBalancePush(balance) {
        const newBalance = parseFloat(balance);
        if (!Number.isFinite(newBalance)) return;
        if (VIP.state.currentUser) VIP.state.currentUser.balance = newBalance;
        updateBalanceDisplay(newBalance);
        const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
        if (Math.abs(newBalance - previousBalance) > 0.01) {
            localStorage.setItem('lastBalance', newBalance);
            if (newBalance > previousBalance) {
                showCasinoInvite(newBalance);
            } else {
                showBalanceToast(newBalance);
            }
        }
    }

    // ---- Invitación al casino tras una carga (owner 2026-08-05) ----
    // Cuando el saldo SUBE, un recuadro grande y bien visible invita a entrar al
    // casino YA LOGUEADO (VIP.ui.enterCasino, el SSO de siempre). Se va solo a
    // los 15 segundos (barra de tiempo incluida) o con la ✕. Throttle de 60s:
    // el evento puede llegar por socket Y por el polling de saldo — una sola vez.
    let _lastCasinoInviteAt = 0;
    let _casinoInviteTimer = null;

    function showCasinoInvite(balance) {
        const now = Date.now();
        if (now - _lastCasinoInviteAt < 60000) return;
        if (!VIP.state.currentUser) return;
        if (VIP.ui._casinoOpen) return; // ya está jugando: no tapar el casino
        _lastCasinoInviteAt = now;

        let box = document.getElementById('casinoInviteBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'casinoInviteBox';
            box.style.cssText =
                'position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:19000;' +
                'width:min(92vw,380px);background:linear-gradient(150deg,#1a0033,#2d0052);' +
                'border:2px solid #ffd700;border-radius:18px;padding:18px 16px 14px;text-align:center;' +
                'box-shadow:0 12px 44px rgba(212,175,55,0.6);display:none;';
            document.body.appendChild(box);
        }
        const amt = Number(balance) || 0;
        box.innerHTML =
            '<button type="button" onclick="VIP.ui.hideCasinoInvite()" ' +
                'style="position:absolute;top:6px;right:10px;background:none;border:none;color:#999;font-size:20px;cursor:pointer;line-height:1;">×</button>' +
            '<div style="font-size:30px;line-height:1;margin-bottom:6px;">💰</div>' +
            '<div style="color:#00ff88;font-weight:900;font-size:16px;margin-bottom:2px;">¡Saldo acreditado!</div>' +
            '<div style="color:#fff;font-weight:800;font-size:22px;margin-bottom:10px;">$' + amt.toLocaleString('es-AR') + '</div>' +
            '<button type="button" onclick="VIP.ui.hideCasinoInvite();VIP.ui.enterCasino();" ' +
                'style="width:100%;background:linear-gradient(135deg,#d4af37,#ffd700);color:#000;border:none;' +
                'padding:14px;border-radius:26px;font-weight:900;font-size:16px;cursor:pointer;' +
                'box-shadow:0 4px 16px rgba(212,175,55,0.5);">🎰 JUGAR AHORA EN 1GIROX</button>' +
            '<div style="color:#aaa;font-size:10.5px;margin-top:7px;">Entrás directo, con tu sesión ya iniciada</div>' +
            // 🪦 Acá iba el cartel informativo del código de $5.000: reemplazado
            // (owner 2026-08-05) por la mini-ENCUESTA de Comunidad de abajo.
            (localStorage.getItem('communitySurveyDone') === '1' ? '' :
            '<div id="casinoInviteSurvey" style="margin-top:9px;padding:9px 10px;background:rgba(41,169,235,0.10);border:1px solid rgba(41,169,235,0.45);border-radius:10px;">' +
                '<div style="color:#9ad8f7;font-size:11.5px;font-weight:800;">📣 ¿Ya estás en nuestra Comunidad de Telegram?</div>' +
                '<div style="color:#8fb9cc;font-size:10px;margin-top:2px;">Bonos, códigos gratis y avisos exclusivos.</div>' +
                '<div style="display:flex;gap:8px;margin-top:8px;">' +
                    '<button type="button" onclick="VIP.ui.casinoInviteJoinCommunity()" ' +
                        'style="flex:1;background:linear-gradient(135deg,#29a9eb,#53bdeb);color:#fff;border:none;padding:9px 6px;border-radius:18px;font-weight:900;font-size:12px;cursor:pointer;">🚀 SÍ, quiero entrar</button>' +
                    '<button type="button" onclick="VIP.ui.casinoInviteAlreadyIn()" ' +
                        'style="flex:1;background:rgba(255,255,255,0.10);color:#cde;border:1px solid rgba(255,255,255,0.25);padding:9px 6px;border-radius:18px;font-weight:800;font-size:12px;cursor:pointer;">✅ Ya estoy en la Comunidad</button>' +
                '</div>' +
            '</div>') +
            '<div style="height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin-top:9px;overflow:hidden;">' +
                '<div id="casinoInviteBar" style="height:100%;width:100%;background:#ffd700;transition:width 15s linear;"></div></div>';
        box.style.display = 'block';

        // Barra de tiempo: 100% → 0 en los 15s de vida del recuadro.
        requestAnimationFrame(function () {
            const bar = document.getElementById('casinoInviteBar');
            if (bar) requestAnimationFrame(function () { bar.style.width = '0%'; });
        });
        clearTimeout(_casinoInviteTimer);
        _casinoInviteTimer = setTimeout(hideCasinoInvite, 15000);
    }

    function hideCasinoInvite() {
        clearTimeout(_casinoInviteTimer);
        const box = document.getElementById('casinoInviteBox');
        if (box) box.style.display = 'none';
    }

    // ---- Mini-encuesta de Comunidad dentro de la invitación al casino ----
    // "SÍ, quiero entrar" → abre la Comunidad de Telegram (el link que se carga
    // en el panel → sección Comandos → card Comunidad; chat.js lo mantiene
    // aplicado en el pill del header, con fallback al dominio propio).
    // Cualquiera de las dos respuestas queda recordada: la encuesta no se
    // repite en próximas cargas (localStorage), el resto del cartel sigue igual.
    function casinoInviteJoinCommunity() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const pill = document.getElementById('canalTelegramHeaderBtn');
        // Fallback /go/comunidad: el server redirige al link vigente de la config
        // (owner 2026-08-06 — nunca más el 404 de canal-proximamente).
        const url = (pill && pill.href) || '/go/comunidad';
        window.open(url, '_blank', 'noopener');
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
    }

    function casinoInviteAlreadyIn() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
        showToast('¡Genial! 🙌 Gracias por estar en la Comunidad', 'success');
    }

    function showBalanceToast(balance) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
            color: #000;
            padding: 15px 25px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 16px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            box-shadow: 0 5px 20px rgba(0, 255, 136, 0.4);
        `;
        toast.innerHTML = `💰 Saldo actualizado: <span style="font-size: 20px;">$${balance.toLocaleString()}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateBalanceDisplay(balance) {
        const balanceElement = document.getElementById('userBalance');
        if (balanceElement) {
            balanceElement.textContent = `$${balance.toLocaleString()}`;
        }
    }

    function startBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
        }
        // 90s (antes 30s): el poll de saldo por-usuario era la causa raíz del lag
        // — para jugadores de un publicista TODAS las lecturas van por una única
        // key (30/min) y con pocos usuarios online se saturaba (logs 2026-08-16).
        // El saldo igual se actualiza al instante por socket (`balance_updated`)
        // en cargas/retiros/bonos, y al cerrar el casino (syncBalance). El poll
        // solo cubre cambios por juego mientras el cliente mira la PWA sin jugar.
        VIP.state.balanceCheckInterval = setInterval(syncBalance, 90000);
    }

    function stopBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
            VIP.state.balanceCheckInterval = null;
        }
    }

    // ---- Welcome message ----

    async function sendWelcomeMessages() {
        const welcomeKey  = 'lastWelcome_' + (VIP.state.currentUser?.userId || '');
        const lastWelcome = parseInt(localStorage.getItem(welcomeKey) || '0');
        const hoursSince  = (Date.now() - lastWelcome) / 3600000;
        if (hoursSince < 24) {
            return;
        }

        // La bienvenida ahora la genera el BACKEND como mensaje de sistema
        // (lado admin), no el cliente. Antes se mandaba con el token del
        // usuario vía sendSystemMessage → quedaba registrada con
        // senderRole='user' y aparecía como si la hubiera escrito el propio
        // usuario. El endpoint /api/messages/welcome la crea con
        // senderRole='admin' y tiene su propio throttle de 24h server-side.
        //
        // CON REINTENTOS (fix 2026-08-05): antes un fallo de red se tragaba en
        // silencio y sin retry → el cliente entraba (típico: por link de acceso
        // en una red lenta/Tor) con el chat VACÍO, y como la bienvenida es la
        // que crea el ChatStatus, el chat tampoco aparecía del lado del admin
        // hasta que el cliente escribiera o recargara la página.
        const delays = [0, 2500, 7000]; // 3 intentos
        for (let i = 0; i < delays.length; i++) {
            if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
            try {
                const response = await fetch(`${VIP.config.API_URL}/api/messages/welcome`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${VIP.state.currentToken}`
                    }
                });
                if (response.ok) {
                    // Refrescar el chat para mostrar los mensajes recién creados.
                    setTimeout(() => { try { VIP.chat.loadMessages(); } catch (e) {} }, 300);
                    localStorage.setItem(welcomeKey, Date.now().toString());
                    return;
                }
                // 4xx (ej. 401 por sesión a medio armar): reintentar igual — el
                // endpoint es idempotente (throttle server-side de 24h).
            } catch (error) {
                // red caída/lenta: probamos de nuevo con el próximo delay
            }
        }
        console.warn('[welcome] no se pudo enviar la bienvenida tras 3 intentos (se reintenta en la próxima carga)');
    }

    // ---- CBU ----

    async function loadAndShowCBU() {
        const now = Date.now();
        if (now - VIP.state.lastCbuClickTime < VIP.config.CBU_CLICK_COOLDOWN_MS) {
            showToast('Espera unos segundos antes de volver a solicitar el CBU.', 'info');
            return;
        }
        VIP.state.lastCbuClickTime = now;

        try {
            const metaEventId = VIP.pixel && VIP.pixel.enabled ? VIP.pixel.newEventId() : null;
            const response = await fetch(`${VIP.config.API_URL}/api/cbu/request`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ metaEventId })
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('cbuBankDisplay').textContent    = data.cbu.bank    || '-';
                document.getElementById('cbuTitularDisplay').textContent = data.cbu.titular || '-';
                document.getElementById('cbuNumberDisplay').textContent  = data.cbu.number  || '-';
                document.getElementById('cbuAliasDisplay').textContent   = data.cbu.alias   || '-';

                showModal('cbuModal');
                setTimeout(() => VIP.chat.loadMessages(), 500);
                showToast('💳 Datos CBU enviados al chat', 'success');

                // Meta Pixel — InitiateCheckout (usuario va a depositar).
                if (VIP.pixel) VIP.pixel.trackWithId(metaEventId, 'InitiateCheckout', { content_name: 'cbu_request' });
            } else {
                showToast('Error solicitando CBU', 'error');
            }
        } catch (error) {
            console.error('Error solicitando CBU:', error);
            showToast('Error de conexión', 'error');
        }
    }

    // ---- Referrals ----

    async function openReferralModal() {
        showModal('referralModal');
        await loadReferralData();
    }

    async function loadReferralData() {
        const histContainer = document.getElementById('referralPayoutHistory');
        if (histContainer) histContainer.innerHTML = '<span style="color:#888;font-size:12px;">Cargando...</span>';

        try {
            const [meRes, histRes] = await Promise.all([
                fetch(`${VIP.config.API_URL}/api/referrals/me`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                }),
                fetch(`${VIP.config.API_URL}/api/referrals/history?limit=20`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                })
            ]);

            if (!meRes.ok) {
                if (histContainer) histContainer.innerHTML = '<span style="color:#ff4444;font-size:12px;">No se pudieron cargar tus datos de referidos. Reintentá.</span>';
                return;
            }
            const meData = await meRes.json();
            const me = meData.data;

            document.getElementById('myReferralCode').textContent = me.referralCode || '—';
            document.getElementById('myReferralLink').textContent = me.referralLink || '—';
            const activeCountEl = document.getElementById('referralActiveCount');
            if (activeCountEl) activeCountEl.textContent = me.activeReferred != null ? me.activeReferred : (me.totalReferred || 0);
            document.getElementById('referralHistoricalTotal').textContent =
                '$' + new Intl.NumberFormat('es-AR').format(Math.round(me.historicalTotalCredited || 0));
            document.getElementById('referralCurrentPeriod').textContent = me.currentPeriodLabel || me.currentPeriod || '—';

            VIP.state.referralData = me;

            try {
                const sumRes = await fetch(`${VIP.config.API_URL}/api/referrals/summary`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                });
                if (sumRes.ok) {
                    const sumData = await sumRes.json();
                    const sum = sumData.data;
                    document.getElementById('referralPendingAmount').textContent =
                        '$' + new Intl.NumberFormat('es-AR').format(Math.round(sum.pendingEstimatedAmount || 0));
                    document.getElementById('referralCreditDate').textContent =
                        sum.estimatedCreditDate || 'Inicio del próximo mes';
                    const lastPayoutEl = document.getElementById('referralLastPayoutAmount');
                    if (lastPayoutEl) {
                        if (sum.lastPayout && sum.lastPayout.amount > 0) {
                            lastPayoutEl.textContent = '$' + new Intl.NumberFormat('es-AR').format(Math.round(sum.lastPayout.amount));
                            lastPayoutEl.title = sum.lastPayout.periodLabel || sum.lastPayout.periodKey || '';
                        } else {
                            lastPayoutEl.textContent = '—';
                        }
                    }
                }
            } catch (e) { /* ignorar */ }

            const EMPTY_HISTORY_HTML = '<span style="color:#888;font-size:12px;">Todavía no tenés pagos por referidos.</span>';

            if (histRes.ok) {
                const histData = await histRes.json();
                const payouts  = histData.data?.payouts || [];
                if (payouts.length === 0) {
                    histContainer.innerHTML = EMPTY_HISTORY_HTML;
                } else {
                    const byPeriod = new Map();
                    for (const p of payouts) {
                        const key = p.periodKey || '?';
                        if (!byPeriod.has(key)) byPeriod.set(key, []);
                        byPeriod.get(key).push(p);
                    }

                    const statusBadgeHtml = (status) => {
                        if (status === 'paid')
                            return '<span style="background:rgba(0,255,136,0.12);border:1px solid rgba(0,255,136,0.4);color:#00ff88;font-size:10px;border-radius:4px;padding:2px 6px;">✅ Pagado</span>';
                        if (status === 'failed')
                            return '<span style="background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.4);color:#ff4444;font-size:10px;border-radius:4px;padding:2px 6px;">❌ Fallido</span>';
                        if (status === 'cancelled')
                            return '<span style="background:rgba(136,136,136,0.12);border:1px solid rgba(136,136,136,0.4);color:#888;font-size:10px;border-radius:4px;padding:2px 6px;">🚫 Cancelado</span>';
                        return '<span style="background:rgba(247,147,30,0.12);border:1px solid rgba(247,147,30,0.4);color:#f7931e;font-size:10px;border-radius:4px;padding:2px 6px;">⏳ Pendiente</span>';
                    };

                    let html = '';
                    for (const [pk, periodPayouts] of byPeriod) {
                        const label    = periodPayouts[0].periodLabel || pk;
                        const paidTotal = periodPayouts
                            .filter(p => p.status === 'paid')
                            .reduce((s, p) => s + (p.totalCommissionAmount || 0), 0);
                        const hasMultiple = periodPayouts.length > 1;

                        html += `<div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.05);">`;
                        html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
                        html += `<span style="font-size:12px;color:#d4af37;font-weight:600;">📅 ${label}</span>`;
                        if (paidTotal > 0)
                            html += `<span style="font-size:12px;color:#00ff88;font-weight:bold;">$${new Intl.NumberFormat('es-AR').format(Math.round(paidTotal))}</span>`;
                        html += `</div>`;

                        for (const p of periodPayouts) {
                            const isDelta = p.isDelta || (p.payoutIndex || 1) > 1;
                            const amount  = p.totalCommissionAmount || 0;
                            html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;${hasMultiple ? 'padding-left:8px;' : ''}">`;
                            html += `<div style="display:flex;align-items:center;gap:6px;">`;
                            if (isDelta)
                                html += `<span style="background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.35);color:#d4af37;font-size:10px;border-radius:4px;padding:1px 5px;">Δ delta</span>`;
                            html += `${statusBadgeHtml(p.status)}`;
                            html += `</div>`;
                            html += `<span style="font-size:13px;color:${p.status === 'paid' ? '#d4af37' : '#888'};font-weight:${p.status === 'paid' ? '600' : 'normal'};">$${new Intl.NumberFormat('es-AR').format(Math.round(amount))}</span>`;
                            html += `</div>`;
                        }
                        html += `</div>`;
                    }
                    histContainer.innerHTML = html;
                }
            } else {
                histContainer.innerHTML = EMPTY_HISTORY_HTML;
            }
        } catch (err) {
            console.error('[Referrals] Error cargando datos:', err);
            if (histContainer) histContainer.innerHTML = '<span style="color:#ff4444;font-size:12px;">No se pudieron cargar tus datos de referidos. Reintentá.</span>';
        }
    }

    function copyReferralCode() {
        const code = document.getElementById('myReferralCode').textContent;
        if (code && code !== '—') {
            navigator.clipboard.writeText(code).then(() => {
                showToast('✅ Código copiado', 'success');
            }).catch(() => { fallbackCopy(code); });
        }
    }

    function copyReferralLink() {
        const link = document.getElementById('myReferralLink').textContent;
        if (link && link !== '—') {
            navigator.clipboard.writeText(link).then(() => {
                showToast('✅ Link copiado', 'success');
            }).catch(() => { fallbackCopy(link); });
        }
    }

    // ---- Canal informativo (delegated from chat module) ----

    function loadCanalInformativoUrl() {
        return VIP.chat.loadCanalInformativoUrl();
    }

    // ---- PWA install ----

    async function installApp() {
        const ua        = navigator.userAgent;
        const isIOS     = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        const isAndroid = /Android/.test(ua);
        const isWindows = /Windows/.test(ua);
        const isMac     = /Macintosh|MacIntel/.test(ua) && !isIOS;

        if (!window.deferredPrompt) {
            if (isIOS)          showInstallInstructions('ios');
            else if (isAndroid) showInstallInstructions('android');
            else if (isWindows) showInstallInstructions('windows');
            else if (isMac)     showInstallInstructions('mac');
            else                showInstallInstructions('generic');
            return;
        }

        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            showToast('✅ Instalando app...', 'success');
            // Recordatorio de notificaciones para Android (flujo directo via deferredPrompt)
            setTimeout(() => {
                showInstallInstructions('android-notif');
            }, 2000);
        } else {
            showToast('❌ Instalación cancelada', 'error');
        }
        window.deferredPrompt = null;
    }

    function showInstallInstructions(platform) {
        const modal = document.createElement('div');
        modal.className = 'ios-install-modal';

        let title, steps, note;
        // Plataformas móviles: se muestra el aviso de notificaciones
        const isMobilePlatform = platform === 'ios' || platform === 'android' || platform === 'android-notif';

        // Pantalla dedicada de recordatorio de notificaciones post-instalación (Android nativo)
        if (platform === 'android-notif') {
            modal.innerHTML = `
                <div class="ios-install-content">
                    <h3>🔔 Un paso más</h3>
                    <div style="
                        background: rgba(255, 107, 53, 0.15);
                        border: 2px solid #ff6b35;
                        border-radius: 10px;
                        padding: 14px 16px;
                        text-align: left;
                    ">
                        <p style="margin: 0; color: #ff6b35; font-weight: bold; font-size: 15px;">
                            🔔 LO MÁS IMPORTANTE: PERMITIR NOTIFICACIONES
                        </p>
                        <p style="margin: 10px 0 0; color: #fff; font-size: 13px;">
                            Cuando abras la app instalada y te pida acceso,
                            <strong>aceptá y permitir notificaciones</strong>.<br>
                            Sin esto, <u>no te van a llegar los avisos importantes</u>.
                        </p>
                    </div>
                    <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
                </div>
            `;
            document.body.appendChild(modal);
            return;
        }

        if (platform === 'ios') {
            title = '📱 Instalar en iPhone / iPad';
            note  = '⚠️ <strong>Solo funciona desde Safari.</strong>';
            steps = [
                'Abrí esta página en <strong>Safari</strong> (no Chrome, no otro navegador)',
                'Tocá el botón <strong>Compartir</strong> <span style="font-size:18px">⬆️</span> en la barra inferior de Safari',
                'Deslizá hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong>',
                'Presioná <strong>"Agregar"</strong>'
            ];
        } else if (platform === 'android') {
            title = '📱 Instalar en Android';
            note  = '⚠️ <strong>Solo funciona desde Google Chrome.</strong>';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong>',
                'Tocá el ícono <strong>⋮</strong> (tres puntos) en la esquina superior derecha',
                'Seleccioná <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong>',
                'Presioná <strong>"Agregar"</strong> o <strong>"Instalar"</strong>'
            ];
        } else if (platform === 'windows') {
            title = '💻 Instalar en Windows (PC)';
            note  = '💡 Funciona en Chrome o Edge.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>',
                'En Chrome: hacé clic en el ícono de instalación <strong>⊕</strong> en la barra de direcciones',
                'En Edge: hacé clic en el ícono <strong>⊕</strong> o el menú <strong>⋯</strong> → <strong>"Aplicaciones"</strong> → <strong>"Instalar este sitio como aplicación"</strong>',
                'Confirmá la instalación'
            ];
        } else if (platform === 'mac') {
            title = '💻 Instalar en Mac';
            note  = '💡 Funciona en Chrome o Safari.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Safari</strong>',
                'En Chrome: hacé clic en el ícono <strong>⊕</strong> en la barra de direcciones',
                'En Safari: usá <strong>Archivo → Agregar a Dock</strong> (macOS Sonoma o superior)',
                'Confirmá la instalación'
            ];
        } else {
            title = '📱 Instalar App';
            note  = '';
            steps = [
                'Abrí esta página en <strong>Chrome</strong> o <strong>Safari</strong>',
                'Buscá la opción <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong> en el menú del navegador',
                'Confirmá la instalación'
            ];
        }

        // Aviso de notificaciones destacado para iOS y Android
        const notifWarning = isMobilePlatform ? `
            <div style="
                background: rgba(255, 107, 53, 0.15);
                border: 2px solid #ff6b35;
                border-radius: 10px;
                padding: 12px 15px;
                margin-top: 15px;
                text-align: left;
            ">
                <p style="margin: 0; color: #ff6b35; font-weight: bold; font-size: 14px;">
                    🔔 LO MÁS IMPORTANTE: PERMITIR NOTIFICACIONES
                </p>
                <p style="margin: 8px 0 0; color: #fff; font-size: 13px;">
                    Una vez instalada, cuando la app te pida acceso, <strong>aceptá y permitir notificaciones</strong>.
                    Sin esto, <u>no te van a llegar los avisos importantes</u>.
                </p>
            </div>` : '';

        modal.innerHTML = `
            <div class="ios-install-content">
                <h3>${title}</h3>
                ${note ? `<p style="color: #f7931e; margin-bottom: 12px;">${note}</p>` : ''}
                <ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>
                ${notifWarning}
                <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function isAppInstalled() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                           window.navigator.standalone === true;
        if (!standalone) return false;
        // Also require notification permission to be granted
        const notifGranted = ('Notification' in window) && Notification.permission === 'granted';
        return notifGranted;
    }

    function isAppStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }

    return {
        showModal,
        hideModal,
        showToast,
        copyText,
        copyToClipboard,
        fallbackCopy,
        showLoginScreen,
        showChatScreen,
        adjustLayout,
        syncBalance,
        handleBalancePush,
        showCasinoInvite,
        hideCasinoInvite,
        casinoInviteJoinCommunity,
        casinoInviteAlreadyIn,
        showBalanceToast,
        updateBalanceDisplay,
        startBalancePolling,
        stopBalancePolling,
        sendWelcomeMessages,
        loadAndShowCBU,
        openReferralModal,
        loadReferralData,
        copyReferralCode,
        copyReferralLink,
        loadCanalInformativoUrl,
        installApp,
        showInstallInstructions,
        isAppInstalled,
        isAppStandalone
    };

})();

// Window aliases for onclick="..." in HTML
window.showModal             = VIP.ui.showModal;
window.hideModal             = VIP.ui.hideModal;
window.showToast             = VIP.ui.showToast;
window.copyText              = VIP.ui.copyText;
window.copyToClipboard       = VIP.ui.copyToClipboard;
window.copyReferralCode      = VIP.ui.copyReferralCode;
window.copyReferralLink      = VIP.ui.copyReferralLink;
window.installApp            = VIP.ui.installApp;
window.showInstallInstructions = VIP.ui.showInstallInstructions;

// ---- PWA install prompt event handlers (must be top-level) ----

window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        return;
    }
    window.deferredPrompt = e;
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'flex'; loginInstallBtn.classList.remove('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'flex'; headerInstallBtn.classList.remove('hidden'); }
    if (appInstallBtn)    { appInstallBtn.style.display = 'flex'; appInstallBtn.classList.add('show'); }
});

window.addEventListener('appinstalled', () => {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
    window.deferredPrompt = null;
    VIP.ui.showToast('✅ App instalada exitosamente', 'success');
});

// Hide install buttons if already running as standalone
if (VIP.ui.isAppStandalone()) {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
}


// Platform modal — private state (no DOM exposure for sensitive data)
VIP.ui._platformPasswordVisible = false;

VIP.ui._copyUsernameToClipboard = function(username, onSuccess) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(username).then(onSuccess).catch(function() {
      VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
    });
  } else {
    VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
  }
};

VIP.ui.openPlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (!modal) return;
  const username = VIP.state.currentUser?.username || '';
  const userEl = document.getElementById('platformModalUser');
  if (userEl) userEl.textContent = username || 'Usuario';

  // Mostrar contraseña si está disponible en memoria de sesión (sin exponerla en el DOM)
  const pwd = VIP.state.sessionPassword || '';
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = pwd ? '••••••••' : '—';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = pwd ? 'none' : 'block';

  // Resetear feedback de copia
  const feedback = document.getElementById('platformCopyFeedback');
  if (feedback) feedback.style.display = 'none';

  modal.style.display = 'flex';

  // Auto-copiar usuario al abrir el modal
  if (username) {
    VIP.ui._copyUsernameToClipboard(username, function() {
      if (feedback) feedback.style.display = 'block';
      VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
    });
  }
};

VIP.ui.closePlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (modal) modal.style.display = 'none';
};

VIP.ui.copyPlatformUsername = function() {
  const username = VIP.state.currentUser?.username || '';
  if (!username) return;
  const feedback = document.getElementById('platformCopyFeedback');
  VIP.ui._copyUsernameToClipboard(username, function() {
    if (feedback) feedback.style.display = 'block';
    VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
  });
};

// ============================================
// ENTRAR AL CASINO — login único (SSO) contra 1girox
// ============================================
//
// Antes: se abría el casino y el usuario tenía que copiar y pegar su usuario y
// contraseña a mano. Ahora el backend pide un link de acceso directo
// (POST /api/platform/session → 1girox POST /players/{username}/session) y el
// usuario entra ya logueado.
//
// ⚠️ POP-UP BLOCKER: el link viene de un fetch (asíncrono) y los navegadores —sobre
// todo en mobile— bloquean window.open si no ocurre DENTRO del gesto del usuario.
// Por eso la pestaña se abre PRIMERO, vacía, y recién después se le cambia la URL.
// Además el código de acceso vence a los 60 segundos, así que no se cachea nada.
VIP.ui._casinoOpening = false;

/**
 * Abre el casino EMBEBIDO en un recuadro a pantalla completa, dentro de la PWA.
 * El jugador nunca sale de VIPCARGAS: cierra el recuadro con la ✕ y vuelve al chat.
 *
 * Orden de las cosas (importa):
 *   1. Se muestra el recuadro con un "cargando" — INMEDIATO, en el mismo click.
 *   2. Recién ahí se pide el link de acceso al backend.
 *   3. Apenas llega, se carga en el iframe.
 *
 * ⚠️ Por qué se pide el link DESPUÉS de abrir el recuadro y no antes: el código de
 * acceso vence a los 60 SEGUNDOS y es de un solo uso. Cuanto menos tiempo pase entre
 * que la plataforma lo emite y el navegador lo usa, mejor. En conexiones lentas (o por
 * Tor) pedirlo antes y usarlo después llegaba vencido: "El enlace expiró".
 */
VIP.ui._casinoOpen = false;

/** Pide el link SSO del casino, CON TIMEOUT. Sin el timeout, un fetch colgado
 *  (red móvil que parpadea) dejaba `_casinoOpening` trabado en true por minutos
 *  → el botón CASINO no hacía NADA al volver a tocarlo ("no ingresa y queda en
 *  el mismo lugar", reclamo del owner 2026-08-19).
 *  @returns {ok:true, url} | {ok:false, error, retryable} */
VIP.ui._fetchCasinoSession = async function(timeoutMs) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function() { ctrl.abort(); }, timeoutMs || 20000) : null;
  try {
    const response = await fetch(`${VIP.config.API_URL}/api/platform/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VIP.state.currentToken}`
      },
      signal: ctrl ? ctrl.signal : undefined
    });
    const data = await response.json().catch(function() { return {}; });
    if (response.ok && data.success && data.redirectUrl) return { ok: true, url: data.redirectUrl };
    // 5xx = plataforma demorada/saturada → vale reintentar. 4xx (bloqueado,
    // límite de intentos) no: reintentar no lo va a cambiar.
    return { ok: false, error: data.error || null, retryable: response.status >= 500 };
  } catch (e) {
    return { ok: false, error: null, retryable: true }; // timeout o red caída → reintentable
  } finally {
    if (timer) clearTimeout(timer);
  }
};

VIP.ui.enterCasino = async function() {
  if (VIP.ui._casinoOpening) return; // anti doble-click
  VIP.ui._casinoOpening = true;

  VIP.ui.closePlatformModal();
  VIP.ui._showCasinoFrame();   // recuadro visible YA, con "cargando"

  try {
    // REINTENTO AUTOMÁTICO (owner 2026-08-19): a veces el primer pedido del link
    // SSO falla (saturación momentánea, red móvil) y el jugador tenía que tocar
    // el botón de nuevo. Ahora se reintenta solo antes de mostrar el error.
    const MAX_TRIES = 3;
    let last = null;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      if (!VIP.ui._casinoOpen) return; // salió del casino mientras cargaba
      if (attempt > 1) {
        const status = document.getElementById('casinoFrameStatus');
        if (status) status.textContent = '🔄 Reintentando… (' + attempt + '/' + MAX_TRIES + ')';
        await new Promise(function(r) { setTimeout(r, attempt === 2 ? 1500 : 3000); });
        if (!VIP.ui._casinoOpen) return;
      }
      last = await VIP.ui._fetchCasinoSession(20000);
      if (last.ok || !last.retryable) break;
    }

    if (last && last.ok) {
      // Si cerró el overlay durante el pedido, NO arrancar el casino oculto
      // (quedaría corriendo con sonido de fondo).
      if (!VIP.ui._casinoOpen) return;
      const frame = document.getElementById('casinoFrame');
      if (frame) frame.src = last.url;

      // VIGILANTE: el `load` del iframe dispara aunque la app de adentro se quede
      // colgada. El caso típico es el BLOQUEO DE COOKIES DE TERCEROS: el casino
      // carga, intenta leer su sesión, el navegador se la niega por estar embebido
      // en otro dominio, y queda girando para siempre. Desde afuera no se puede
      // detectar (es otro origen, no podemos mirar adentro), así que se usa un
      // tiempo límite y se le ofrece al jugador la salida.
      clearTimeout(VIP.ui._casinoWatchdog);
      VIP.ui._casinoWatchdog = setTimeout(function() {
        if (!VIP.ui._casinoOpen) return;
        VIP.ui._casinoFrameStuck();
      }, 15000);
      return;
    }

    VIP.ui._casinoFrameError((last && last.error) ||
      'No pudimos abrirte el casino. Revisá tu internet y tocá Reintentar.');
  } finally {
    VIP.ui._casinoOpening = false;
  }
};

/**
 * Abre el casino en una PESTAÑA APARTE (no embebido).
 *
 * Es la salida cuando el navegador no deja que el casino funcione dentro del
 * recuadro. Al abrirse como sitio principal, sus cookies dejan de ser "de terceros"
 * y la sesión funciona normal.
 *
 * ⚠️ La pestaña se abre ANTES del fetch, dentro del gesto del usuario: si se abriera
 * después, el bloqueador de pop-ups (sobre todo en mobile) la mataría.
 * Y se pide un link NUEVO a propósito: el anterior ya lo consumió el iframe y los
 * códigos son de un solo uso.
 */
VIP.ui.openCasinoInTab = async function() {
  let win = null;
  try {
    win = window.open('', '_blank');
    if (win && win.document) {
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Entrando al casino…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;background:#12101a;color:#d4af37;font-family:system-ui,sans-serif;' +
        'font-size:18px;font-weight:700">🎰 Entrando al casino…</body>'
      );
    }
  } catch (e) { win = null; }

  try {
    // Mismo reintento automático que enterCasino (la pestaña placeholder ya
    // está abierta, así que reintentar el fetch no molesta al pop-up blocker).
    let r = await VIP.ui._fetchCasinoSession(20000);
    if (!r.ok && r.retryable) {
      try { if (win && !win.closed && win.document && win.document.body) win.document.body.textContent = '🔄 Reintentando…'; } catch (e2) {}
      await new Promise(function(res) { setTimeout(res, 1500); });
      r = await VIP.ui._fetchCasinoSession(20000);
    }

    if (r.ok) {
      if (win && !win.closed) {
        win.location.href = r.url;
      } else {
        // Pop-up bloqueado → se navega en la pestaña actual.
        window.location.href = r.url;
        return;
      }
      VIP.ui.closeCasinoFrame();
      return;
    }
    if (win && !win.closed) win.close();
    VIP.ui.showToast(r.error || 'No pudimos abrirte el casino. Intentá de nuevo.', 'error');
  } catch (e) {
    if (win && !win.closed) win.close();
    VIP.ui.showToast('Sin conexión. Intentá de nuevo.', 'error');
  }
};

/** El casino no terminó de cargar dentro del recuadro: se ofrece abrirlo aparte. */
VIP.ui._casinoFrameStuck = function() {
  const status = document.getElementById('casinoFrameStatus');
  const frame = document.getElementById('casinoFrame');
  if (!status) return;
  // El iframe se deja visible por si en realidad terminó de cargar y sólo tardó:
  // el aviso se muestra encima, sin tapar el juego.
  status.style.display = 'flex';
  status.style.position = 'absolute';
  status.style.inset = 'auto 0 0 0';
  status.style.background = 'rgba(13,13,26,0.96)';
  status.style.padding = '18px';
  status.innerHTML =
    '<div style="color:#ffd479;font-size:15px;font-weight:700;line-height:1.45;max-width:460px;">' +
      '¿El casino no termina de cargar?</div>' +
    '<div style="color:#aaa;font-size:13px;font-weight:400;line-height:1.45;max-width:460px;">' +
      'Tu navegador puede estar bloqueando el casino por estar abierto acá adentro. ' +
      'Abrilo aparte y va a funcionar normal.</div>' +
    '<button type="button" onclick="VIP.ui.openCasinoInTab()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '↗ Abrir el casino aparte</button>' +
    '<button type="button" onclick="document.getElementById(\'casinoFrameStatus\').style.display=\'none\'" ' +
      'style="background:none;color:#888;border:none;font-size:13px;cursor:pointer;">' +
      'Seguir esperando</button>';
  if (frame) frame.style.display = 'block';
};

/** Chip del menú de acciones rápidas del pop-up del casino. Declaración de
 *  función (hoisted) para poder usarla dentro del innerHTML de _showCasinoFrame. */
function _casinoChip(label, onclick, primary) {
  const base = primary
    ? 'background:linear-gradient(135deg,#128c4a,#25d366);color:#fff;border:none;'
    : 'background:rgba(212,175,55,0.12);color:#e3bd48;border:1px solid rgba(212,175,55,0.35);';
  return '<button type="button" onclick="' + onclick + '" style="' + base +
    'flex:0 0 auto;white-space:nowrap;border-radius:16px;padding:7px 12px;font-size:12.5px;' +
    'font-weight:700;cursor:pointer;">' + label + '</button>';
}

/** Envía un mensaje al cajero desde el pop-up (mismo camino que escribir a mano
 *  → cae en el panel adminprivado2026). */
VIP.ui._casinoSendQuick = function(text) {
  const input = document.getElementById('messageInput');
  if (!input) return false;
  input.value = text;
  try { if (VIP.chat && VIP.chat.sendMessage) VIP.chat.sendMessage(); } catch (e) {}
  return true;
};

/** Acciones rápidas del pop-up. TODO termina en el chat del cajero; los botones
 *  solo le ahorran al cliente tener que escribir. */
VIP.ui.casinoQuickAction = function(action, arg) {
  switch (action) {
    case 'cargar-toggle': {
      const row = document.getElementById('casinoAmountRow');
      if (row) row.style.display = (row.style.display === 'none' || !row.style.display) ? 'flex' : 'none';
      return;
    }
    case 'cargar':
      VIP.ui._casinoSendQuick('🎰 Quiero cargar $' + Number(arg).toLocaleString('es-AR'));
      break;
    case 'cargar-otro': {
      const i = document.getElementById('messageInput');
      if (i) { i.value = '🎰 Quiero cargar $'; i.focus(); }
      break;
    }
    case 'cbu':
      try { if (VIP.ui.loadAndShowCBU) VIP.ui.loadAndShowCBU(); } catch (e) {}
      break;
    case 'comprobante': {
      const a = document.getElementById('attachBtn');
      if (a) a.click();
      break;
    }
    case 'saldo':
      try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (e) {}
      VIP.ui._casinoSendQuick('👛 ¿Me confirmás mi saldo?');
      break;
    case 'retirar':
      VIP.ui._casinoSendQuick('💸 Quiero retirar mi premio');
      break;
    case 'escribir': {
      const e2 = document.getElementById('messageInput');
      if (e2) e2.focus();
      break;
    }
  }
};

/** Crea (una sola vez) y muestra el recuadro del casino. */
VIP.ui._showCasinoFrame = function() {
  let overlay = document.getElementById('casinoOverlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'casinoOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#0d0d1a;display:flex;flex-direction:column;' +
      // PWA instalada en iPhone (viewport-fit=cover): padding de safe-area arriba
      // y abajo → el casino no queda bajo el notch ni en la zona del home
      // indicator (barras oscuras discretas del color del overlay).
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    // Diseño (owner 2026-08-16): el casino se ve TAL CUAL 1girox.com (iframe a
    // pantalla completa, sin barra propia arriba). Todo el "chrome" (soporte,
    // salir, abrir aparte) vive en una BURBUJA de soporte flotante abajo a la
    // derecha que abre el chat con las acciones rápidas.
    overlay.innerHTML =
      '<div id="casinoFrameStatus" style="flex:1;display:flex;flex-direction:column;gap:14px;' +
        'align-items:center;justify-content:center;color:#d4af37;font-size:16px;font-weight:700;' +
        'text-align:center;padding:20px;">🎰 Entrando al casino…</div>' +
      // `allow` habilita pantalla completa y sonido dentro de los juegos.
      '<iframe id="casinoFrame" title="Casino" style="flex:1;width:100%;border:0;display:none;" ' +
        'allow="autoplay; fullscreen; payment"></iframe>' +
      // BURBUJA de soporte flotante (abajo a la derecha) — abre el chat de acciones.
      '<button type="button" id="casinoSupportBubble" onclick="VIP.ui.toggleCasinoChat()" ' +
        'title="Soporte y cargas" style="position:absolute;z-index:6;right:16px;' +
        'bottom:calc(18px + env(safe-area-inset-bottom,0px));width:60px;height:60px;border-radius:50%;' +
        'background:linear-gradient(135deg,#128c4a,#25d366);color:#fff;border:none;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.55);font-size:26px;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;">🎧' +
        '<span id="casinoChatBadge" style="display:none;position:absolute;top:-2px;right:-2px;' +
        'background:#e53935;color:#fff;border-radius:11px;min-width:20px;height:20px;line-height:20px;' +
        'font-size:12px;font-weight:800;padding:0 5px;text-align:center;">0</span></button>' +
      // WIDGET de soporte flotante en la ESQUINA (owner 2026-08-17, referencia
      // Bet33): se abre "medio abierto" sobre el casino, NO parte la pantalla.
      // Ancho fijo pegado abajo a la derecha (arriba de la burbuja). El chat real
      // se muda al body al abrir y vuelve a su lugar al cerrar.
      '<div id="casinoChatDrawer" style="display:none;position:absolute;z-index:7;' +
      'right:16px;bottom:calc(88px + env(safe-area-inset-bottom,0px));' +
      'width:min(380px,calc(100vw - 24px));height:min(600px,72vh);' +
      'flex-direction:column;background:#0d0d1a;border:1px solid rgba(212,175,55,0.4);' +
      'border-radius:16px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,0.6);">' +
        // Header verde con "EN LÍNEA" + cerrar.
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;flex:0 0 auto;' +
        'background:linear-gradient(135deg,#128c4a,#0f7a3d);">' +
          '<div style="width:34px;height:34px;border-radius:50%;background:#0d0d1a;flex:0 0 auto;' +
          'display:flex;align-items:center;justify-content:center;font-size:16px;">🎧</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="color:#fff;font-weight:800;font-size:14px;">Soporte 1GIROX</div>' +
            '<div style="color:#c9f5d8;font-size:11px;display:flex;align-items:center;gap:5px;">' +
              '<span style="width:7px;height:7px;border-radius:50%;background:#7dffa8;box-shadow:0 0 6px #7dffa8;"></span>EN LÍNEA</div>' +
          '</div>' +
          '<button type="button" onclick="VIP.ui.toggleCasinoChat()" title="Cerrar" ' +
            'style="background:rgba(255,255,255,0.18);color:#fff;border:none;border-radius:50%;' +
            'width:28px;height:28px;font-size:14px;cursor:pointer;flex:0 0 auto;">✕</button>' +
        '</div>' +
        // Acciones principales: Depositar (despliega montos) + Retirar (grandes).
        '<div style="flex:0 0 auto;padding:8px;display:flex;flex-direction:column;gap:6px;' +
        'background:#100e18;border-bottom:1px solid rgba(212,175,55,0.15);">' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" onclick="VIP.ui.casinoQuickAction(\'cargar-toggle\')" ' +
              'style="flex:1;background:linear-gradient(135deg,#128c4a,#25d366);color:#fff;border:none;' +
              'border-radius:10px;padding:11px 8px;font-size:13px;font-weight:800;cursor:pointer;">💰 Quiero Depositar</button>' +
            '<button type="button" onclick="VIP.ui.casinoQuickAction(\'retirar\')" ' +
              'style="flex:1;background:rgba(212,175,55,0.15);color:#e3bd48;border:1px solid rgba(212,175,55,0.45);' +
              'border-radius:10px;padding:11px 8px;font-size:13px;font-weight:800;cursor:pointer;">💸 Solicitar Retiro</button>' +
          '</div>' +
          // Sub-fila de montos (se despliega al tocar "Quiero Depositar").
          '<div id="casinoAmountRow" style="display:none;gap:6px;flex-wrap:wrap;">' +
            _casinoChip('$2.000', "VIP.ui.casinoQuickAction('cargar','2000')") +
            _casinoChip('$5.000', "VIP.ui.casinoQuickAction('cargar','5000')") +
            _casinoChip('$10.000', "VIP.ui.casinoQuickAction('cargar','10000')") +
            _casinoChip('$20.000', "VIP.ui.casinoQuickAction('cargar','20000')") +
          '</div>' +
          // Fila chica: pasos del depósito + hablar.
          '<div style="display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;">' +
            _casinoChip('📋 Pedir CBU', "VIP.ui.casinoQuickAction('cbu')") +
            _casinoChip('✅ Ya transferí', "VIP.ui.casinoQuickAction('comprobante')") +
            _casinoChip('💬 Hablar', "VIP.ui.casinoQuickAction('escribir')") +
          '</div>' +
        '</div>' +
        // Escapes discretos (una barrita fina de links).
        '<div style="flex:0 0 auto;display:flex;gap:14px;justify-content:center;padding:4px;' +
        'background:#0b0a12;border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<button type="button" onclick="VIP.ui.openCasinoInTab()" style="background:none;border:none;' +
          'color:#8a7a3a;font-size:10.5px;cursor:pointer;text-decoration:underline;">↗ Casino aparte</button>' +
          '<button type="button" onclick="VIP.ui.closeCasinoFrame()" style="background:none;border:none;' +
          'color:#8a8a8a;font-size:10.5px;cursor:pointer;text-decoration:underline;">🚪 Salir del casino</button>' +
        '</div>' +
        '<div id="casinoChatDrawerBody" style="flex:1;display:flex;flex-direction:column;min-height:0;"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Cuando el casino termina de cargar, se esconde el "cargando" y se muestra el juego.
    const frame = overlay.querySelector('#casinoFrame');
    frame.addEventListener('load', function() {
      // Solo cuenta el load del CASINO REAL. ⚠️ Antes el guard era `!frame.src`
      // y el reset hacía `frame.src=''` — un src vacío NAVEGA el iframe a la
      // URL de la PROPIA app (bloqueada por X-Frame-Options) y ese load espurio
      // pasaba el guard → se escondía el "Entrando al casino…" y quedaba un
      // recuadro vacío. Era LA causa del "toco el botón, carga y falla; a la
      // segunda entra" (carrera entre ese load y la llegada del link SSO).
      const src = frame.getAttribute('src');
      if (!src || src === 'about:blank') return;
      const status = document.getElementById('casinoFrameStatus');
      if (status) status.style.display = 'none';
      frame.style.display = 'block';
      // Si el HTML del casino llegó, se cancela el vigilante: el aviso "¿no
      // termina de cargar?" aparecía ENCIMA del casino ya funcionando (reclamo
      // owner 2026-08-15). Para el caso raro de app colgada por cookies
      // bloqueadas, el escape "↗ Abrir aparte" sigue SIEMPRE en la barra.
      clearTimeout(VIP.ui._casinoWatchdog);
    });
  }

  // Reset al abrir (por si venía de un intento anterior que falló).
  const frame = overlay.querySelector('#casinoFrame');
  const status = overlay.querySelector('#casinoFrameStatus');
  // ⚠️ 'about:blank', NUNCA '': el string vacío navega el iframe a la URL base
  // (la propia PWA) — request inútil + load espurio que rompía la carga.
  if (frame) { frame.src = 'about:blank'; frame.style.display = 'none'; }
  if (status) { status.style.display = 'flex'; status.textContent = '🎰 Entrando al casino…'; }

  overlay.style.display = 'flex';
  // Bloquea el scroll del fondo mientras el casino está abierto.
  document.body.style.overflow = 'hidden';
  VIP.ui._casinoOpen = true;

  // Badge de mensajes sin leer mientras juega: observa el listado real del chat
  // (chat.js sigue appendeando ahí aunque el casino lo tape) y cuenta lo que
  // llega con el panel de chat CERRADO. Vive para siempre; los guards de arriba
  // lo apagan fuera del casino.
  if (!VIP.ui._casinoChatObserver && window.MutationObserver) {
    const msgs = document.getElementById('chatMessages');
    if (msgs) {
      VIP.ui._casinoChatObserver = new MutationObserver(function(muts) {
        if (!VIP.ui._casinoOpen) return;
        const drawer = document.getElementById('casinoChatDrawer');
        if (drawer && drawer.style.display !== 'none') return; // chat a la vista: nada que avisar
        let added = 0;
        for (let i = 0; i < muts.length; i++) added += muts[i].addedNodes.length;
        if (!added) return;
        VIP.ui._casinoChatUnread = (VIP.ui._casinoChatUnread || 0) + added;
        const badge = document.getElementById('casinoChatBadge');
        if (badge) {
          badge.textContent = VIP.ui._casinoChatUnread > 9 ? '9+' : String(VIP.ui._casinoChatUnread);
          badge.style.display = 'inline-block';
        }
      });
      VIP.ui._casinoChatObserver.observe(msgs, { childList: true });
    }
  }
  VIP.ui._casinoChatUnread = 0;
};

/** Abre/cierra el chat de cargas SOBRE el casino (el juego no se corta). */
VIP.ui.toggleCasinoChat = function() {
  const drawer = document.getElementById('casinoChatDrawer');
  if (!drawer) return;
  if (drawer.style.display === 'none' || !drawer.style.display) VIP.ui._casinoChatMount();
  else VIP.ui._casinoChatUnmount();
};

/** Muda el chat REAL (cabecera+mensajes+barra de escribir) adentro del panel.
 *  Mover los nodos conserva ids, listeners y el socket: es EL MISMO chat, no
 *  una copia — por eso el agente lo ve en su bandeja de siempre. */
VIP.ui._casinoChatMount = function() {
  const drawer = document.getElementById('casinoChatDrawer');
  const body = document.getElementById('casinoChatDrawerBody');
  const cc = document.querySelector('.chat-container');
  const cic = document.querySelector('.chat-input-container');
  if (!drawer || !body || !cc || !cic) return;
  // Marcadores invisibles para devolver cada bloque EXACTAMENTE donde estaba.
  const ph1 = document.createElement('div'); ph1.style.display = 'none';
  const ph2 = document.createElement('div'); ph2.style.display = 'none';
  cc.parentNode.insertBefore(ph1, cc);
  cic.parentNode.insertBefore(ph2, cic);
  body.appendChild(cc);
  body.appendChild(cic);
  // Dentro del panel el chat se COMPACTA (owner 2026-08-15):
  // 1. Se oculta la cabecera "Cargas 1Girox" (avatar/en línea/🔥) — el panel ya
  //    tiene su propio título y así se ven más mensajes en el 50% de alto.
  // 2. min-height:0 pisa el piso de 170px de .chat-container: con el panel
  //    corto, ese piso empujaba la barra de escribir fuera de la vista y el
  //    chat "no bajaba del todo".
  const tb = cc.querySelector('.chat-topbar');
  if (tb) tb.style.display = 'none';
  const prevMinHeight = cc.style.minHeight;
  cc.style.minHeight = '0';
  VIP.ui._casinoChatPh = { ph1: ph1, ph2: ph2, cc: cc, cic: cic, tb: tb, prevMinHeight: prevMinHeight };
  drawer.style.display = 'flex';
  // Visto: badge a cero y mensajes al final (tras el reflow del layout nuevo).
  VIP.ui._casinoChatUnread = 0;
  const badge = document.getElementById('casinoChatBadge');
  if (badge) badge.style.display = 'none';
  requestAnimationFrame(function() {
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
};

/** Devuelve el chat a su lugar original de la página y esconde el panel. */
VIP.ui._casinoChatUnmount = function() {
  const s = VIP.ui._casinoChatPh;
  if (s) {
    // Deshacer la compactación ANTES de devolverlo: en la página el chat
    // vuelve con su cabecera y su piso de altura de siempre.
    if (s.tb) s.tb.style.display = '';
    if (s.cc) s.cc.style.minHeight = s.prevMinHeight || '';
  }
  if (s && s.ph1 && s.ph1.parentNode) { s.ph1.parentNode.insertBefore(s.cc, s.ph1); s.ph1.remove(); }
  if (s && s.ph2 && s.ph2.parentNode) { s.ph2.parentNode.insertBefore(s.cic, s.ph2); s.ph2.remove(); }
  VIP.ui._casinoChatPh = null;
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) drawer.style.display = 'none';
};

/** Cierra el recuadro y vuelve a VIPCARGAS. */
VIP.ui.closeCasinoFrame = function() {
  clearTimeout(VIP.ui._casinoWatchdog);
  // Si el chat estaba mudado al panel del casino, SIEMPRE devolverlo a la
  // página antes de cerrar (si no, la pantalla principal queda sin chat).
  VIP.ui._casinoChatUnmount();
  const overlay = document.getElementById('casinoOverlay');
  if (!overlay) return;
  // Se blanquea el src para que el casino deje de correr en segundo plano (si no,
  // sigue sonando y consumiendo datos aunque el recuadro esté oculto).
  // ⚠️ 'about:blank', NUNCA '': el vacío navega el iframe a la URL de la PWA.
  const frame = overlay.querySelector('#casinoFrame');
  if (frame) frame.src = 'about:blank';
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  VIP.ui._casinoOpen = false;

  // Al volver, refrescar el saldo: es muy probable que haya cambiado jugando.
  if (VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) {} }
};

/** Muestra un error dentro del recuadro, con la opción de reintentar o salir. */
VIP.ui._casinoFrameError = function(msg) {
  const status = document.getElementById('casinoFrameStatus');
  if (!status) {
    VIP.ui.showToast(msg, 'error');
    return;
  }
  status.style.display = 'flex';
  status.style.flexDirection = 'column';
  status.style.gap = '14px';
  status.innerHTML =
    '<div style="color:#ff8080;font-weight:700;max-width:420px;line-height:1.45;">' + msg + '</div>' +
    '<button type="button" onclick="VIP.ui.enterCasino()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '🔄 Reintentar</button>' +
    '<button type="button" onclick="VIP.ui.closeCasinoFrame()" ' +
      'style="background:none;color:#aaa;border:none;font-size:14px;cursor:pointer;">' +
      'Volver a 1GIROX</button>';
};

// El botón "atrás" del celular cierra el recuadro en vez de salir de la app.
window.addEventListener('popstate', function() {
  if (VIP.ui._casinoOpen) VIP.ui.closeCasinoFrame();
});

// Botón "Abrir Casino" DENTRO del modal (que ahora es el camino de respaldo, cuando
// el SSO falló). Abre el casino a secas para que el usuario entre a mano con los
// datos que el modal le muestra.
VIP.ui.goToPlatform = function() {
  window.open(VIP.config.PLATFORM_URL, '_blank');
  VIP.ui.closePlatformModal();
};


VIP.ui.togglePlatformPasswordVisibility = function() {
  const pwdEl = document.getElementById('platformModalPassword');
  const toggle = document.getElementById('platformPasswordToggle');
  if (!pwdEl) return;
  const plain = VIP.state.sessionPassword || '';
  if (!plain) return;
  VIP.ui._platformPasswordVisible = !VIP.ui._platformPasswordVisible;
  if (VIP.ui._platformPasswordVisible) {
    pwdEl.textContent = plain;
    if (toggle) toggle.textContent = '🙈';
  } else {
    pwdEl.textContent = '••••••••';
    if (toggle) toggle.textContent = '👁';
  }
};

VIP.ui.savePlatformPassword = function() {
  const input = document.getElementById('platformPasswordManualInput');
  if (!input || !input.value.trim()) return;
  const pwd = input.value.trim();
  VIP.state.sessionPassword = pwd;
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = '••••••••';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = 'none';
  input.value = '';
  VIP.ui.showToast('✅ Contraseña guardada para esta sesión', 'success');
};

VIP.ui.showPlatformPasswordChange = function() {
  // Cerrar el modal de plataforma
  VIP.ui.closePlatformModal();
  // Asegurarse de que el cambio sea voluntario (no obligatorio)
  VIP.state.passwordChangePending = false;
  // Preparar y abrir el modal de cambio de contraseña
  if (typeof VIP.auth.prepareChangePasswordModal === 'function') {
    VIP.auth.prepareChangePasswordModal();
  } else if (typeof window.prepareChangePasswordModal === 'function') {
    window.prepareChangePasswordModal();
  }
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.classList.remove('hidden');
};
