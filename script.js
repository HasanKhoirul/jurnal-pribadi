const firebaseConfig = {
    apiKey: "AIzaSyCNkvU456aGcSgzuYdILloAKbct65vQ1kM",
    authDomain: "jurnal-pribadi.firebaseapp.com",
    projectId: "jurnal-pribadi",
    storageBucket: "jurnal-pribadi.firebasestorage.app",
    messagingSenderId: "106328588110",
    appId: "1:106328588110:web:6460d477d2783de583a81f",
    measurementId: "G-RFN33ZRRB9"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

document.addEventListener("DOMContentLoaded", () => {

    let journalData = JSON.parse(localStorage.getItem('xauusd_data_v3')) || {};
    let modalAwal = parseFloat(localStorage.getItem('xauusd_modal')) || 2500000;
    let expData = JSON.parse(localStorage.getItem('expense_data_v1')) || {};
    let sportData = JSON.parse(localStorage.getItem('sport_data_v1')) || {};
    let workData = JSON.parse(localStorage.getItem('work_data_v1')) || { tasks: {} };
    let workUnsub = null;
    const defaultWealthHistory = { items: [], realMoney: 0 };
    if(!localStorage.getItem('wealth_data_v1')) { localStorage.setItem('wealth_data_v1', JSON.stringify(defaultWealthHistory)); }
    let wealthData = JSON.parse(localStorage.getItem('wealth_data_v1'));
    let aiTradeData = JSON.parse(localStorage.getItem('ai_trade_data_v1')) || {};
    let aiModalAwal = parseFloat(localStorage.getItem('ai_modal_awal')) || 2500000;
    // Tanggal "berdiri sendiri" modal (YYYY-MM-DD) - kalau keisi, trade SEBELUM tanggal ini gak ikut
    // dihitung ke Equity Awal/Akhir (tapi histori kalender/detailnya tetap ke-simpen & bisa dilihat lagi).
    let aiModalResetAt = JSON.parse(localStorage.getItem('ai_modal_reset_at') || 'null');
    // Modal LAMA yang berlaku sebelum aiModalResetAt - dipakai biar bulan sebelum tanggal reset tetap
    // kebaca akurat (bukan ketarik modal baru) pas di-browse ulang.
    let aiModalBeforeReset = JSON.parse(localStorage.getItem('ai_modal_before_reset') || 'null');
    const defaultAiSettings = { twelvedata: localStorage.getItem('ai_key_twelvedata') || '', llmProvider: localStorage.getItem('ai_llm_provider') || 'none', llmKey: localStorage.getItem('ai_key_llm') || '' };
    let aiSettings = JSON.parse(localStorage.getItem('ai_settings_v1')) || defaultAiSettings;
    let botControl = JSON.parse(localStorage.getItem('ai_bot_control_v1')) || {};
    let currencyInstruments = {};  // modul Currency (multi-instrumen) - VPS-only compute, cloud-driven doang, gak di-cache localStorage
    // Dipindah ke atas (bukan deket kode Currency lain di ~baris 2389) karena renderHome() manggil ini pas
    // load awal (baris ~199), sebelum baris 2389 sempet jalan - const gak di-hoist kayak function, jadi
    // kalau tetep di bawah bakal ReferenceError "Cannot access before initialization" pas pertama buka web.
    const CURRENCY_PAIRS = ['USDJPY', 'GBPUSD', 'AUDUSD', 'EURUSD', 'USDCAD'];
    // Candle/harga live per pair (dari appData/public, field di-suffix nama pair) - dipakai chart & trend summary tab Currency.
    let currencyLiveCandles = {}; let currencyLiveCandlesUpdatedAt = {};
    let currencyLivePrice = {}; let currencyLivePriceUpdatedAt = {};
    let aiLivePriceMt5 = null; let aiLivePriceMt5UpdatedAt = null; // harga tick terkini dari bot VPS/MT5 (di-throttle bot ~30 detik biar irit kuota Firestore, eksekusi SL/TP tetap tiap ~10 detik gak kepengaruh). Dideklarasikan di atas (bareng currencyLivePriceUpdatedAt) karena Status Bot di renderHome() makenya sejak render pertama kali, sebelum login.
    const STATUS_BOT_STALE_MINUTES = 15; // sama kayak threshold watchdog - dipakai Status Bot Pusat Kendali

    // Ikon garis tipis buat kartu Pusat Kendali - beberapa SENGAJA sama persis sama ikon sidebar
    // halaman terkait (Olahraga/Belanja/Kekayaan/XAUUSD/Gold/Currency), biar konsisten satu konsep satu ikon.
    // Dideklarasikan di atas (bukan deket renderHome()) karena renderHome() dipanggil lebih dulu saat
    // init - kalau PK_ICONS dideklarasikan di bawah situ, kena "Cannot access before initialization".
    const PK_ICONS = {
        lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        heart: '<path d="M12 20s-7-4.4-9.5-8.5C1 8 2.8 4.8 6 4.8c2 0 3.3 1.1 4 2.2.7-1.1 2-2.2 4-2.2 3.2 0 5 3.2 3.5 6.7C19 15.6 12 20 12 20z"/>',
        checklist: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
        pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        cart: '<circle cx="9" cy="20" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="20" r="1.2" fill="currentColor" stroke="none"/><path d="M3 4h2l2.3 12a1.5 1.5 0 0 0 1.5 1.2h8.5a1.5 1.5 0 0 0 1.5-1.2L21 8H6.2"/>',
        wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14.5" r="1" fill="currentColor" stroke="none"/>',
        barChart: '<path d="M4 20V13"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M20 20v-5"/>',
        goldBars: '<path d="M2.5 19.5 4 14.5h6l1.5 5Z"/><path d="M12.5 19.5 14 14.5h6l1.5 5Z"/><path d="M7.5 12 9 7h6l1.5 5Z"/>',
        coins: '<circle cx="9" cy="9" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.4 18"/><path d="M8 7h1v4"/><path d="M16.7 13.9l.7.7-2.8 2.8"/>',
        server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="7" cy="16.5" r="0.9" fill="currentColor" stroke="none"/><path d="M11 7.5h6"/><path d="M11 16.5h6"/>',
        rank: '<path d="M5 20v-4"/><path d="M12 20v-9"/><path d="M19 20V4"/>',
    };
    function pkIco(name) { return `<span class="pk-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PK_ICONS[name]}</svg></span>`; }

    // ==========================================
    // MODULE CLOUD SYNC (FIREBASE)
    // Dokumen "public": journalData/modalAwal/sportData -> bisa dibaca siapapun tanpa login (view-only kalau belum login, karena form/tombol edit di UI sudah otomatis ke-hide di locked-mode).
    // Dokumen per-UID: expData/wealthData -> cuma bisa dibaca & ditulis kalau login asli.
    // ==========================================
    let privateUnsub = null;
    let currencyUnsubs = [];  // 5 listener terpisah (1 per pair, Fase 2 Firestore egress fix 2026-09) - lihat attachCurrencyListeners
    let financeUnsub = null;
    let pushTimerAi = null;
    let pushTimerFinance = null;
    let pushTimerPublic = null;

    // expData/wealthData sengaja dipisah ke dokumen 'userFinance' sendiri (bukan numpang di 'appData'
    // yang di-listen 6 proses bot VPS) - biar jurnal keuangan manual gak ikut ke-download ulang tiap
    // kali salah satu dari 6 bot trading nulis perubahan kecil (efisiensi bandwidth Firestore, Juli 2026).
    function saveData(key, obj) {
        localStorage.setItem(key, JSON.stringify(obj));
        if (key === 'expense_data_v1' || key === 'wealth_data_v1') {
            clearTimeout(pushTimerFinance);
            pushTimerFinance = setTimeout(pushFinanceToCloud, 800);
        } else if (key === 'ai_trade_data_v1' || key === 'ai_modal_awal' || key === 'ai_modal_reset_at' || key === 'ai_modal_before_reset' || key === 'ai_settings_v1' || key === 'ai_bot_control_v1') {
            clearTimeout(pushTimerAi);
            pushTimerAi = setTimeout(pushAiToCloud, 800);
        } else {
            clearTimeout(pushTimerPublic);
            pushTimerPublic = setTimeout(pushPublicToCloud, 800);
        }
    }

    function pushPublicToCloud() {
        if (!auth.currentUser) return Promise.resolve();
        return db.collection('appData').doc('public').set({ journalData, modalAwal, sportData })
            .catch(err => { console.error('Gagal sync data publik ke cloud:', err); throw err; });
    }

    function pushAiToCloud() {
        if (!auth.currentUser) return Promise.resolve();
        // PENTING: .set() ini TANPA merge (biar fitur "Reset Data" yang nge-kosongin aiTradeData={} tetap
        // beneran ke-kosongin di server). currencyInstruments SENGAJA gak disertain lagi di sini (Fase 2
        // Firestore egress fix, 2026-09) - data 5 pair currency sekarang di dokumen sendiri-sendiri
        // (appData/{uid}/currencyPairs/<PAIR>), gak nempel di dokumen Gold ini lagi, jadi gak perlu
        // ikut ke-broadcast ulang tiap kali Gold nyimpen data.
        return db.collection('appData').doc(auth.currentUser.uid).set({ aiTradeData, aiModalAwal, aiModalResetAt, aiModalBeforeReset, aiSettings, botControl })
            .catch(err => { console.error('Gagal sync data AI ke cloud:', err); throw err; });
    }

    function pushFinanceToCloud() {
        if (!auth.currentUser) return Promise.resolve();
        return db.collection('userFinance').doc(auth.currentUser.uid).set({ expData, wealthData })
            .catch(err => { console.error('Gagal sync data keuangan ke cloud:', err); throw err; });
    }

    function attachPublicListener() {
        db.collection('appData').doc('public').onSnapshot(doc => {
            if (doc.exists) {
                const d = doc.data();
                journalData = d.journalData || {}; modalAwal = d.modalAwal || 2500000; sportData = d.sportData || {};
                localStorage.setItem('xauusd_data_v3', JSON.stringify(journalData)); localStorage.setItem('xauusd_modal', modalAwal); localStorage.setItem('sport_data_v1', JSON.stringify(sportData));
                if (d.aiLiveCandlesMt5 && d.aiLiveCandlesMt5.length) { aiLiveCandlesMt5 = d.aiLiveCandlesMt5; aiLiveCandlesMt5UpdatedAt = d.aiLiveCandlesMt5UpdatedAt || null; }
                if (d.aiLivePriceMt5) { aiLivePriceMt5 = d.aiLivePriceMt5; aiLivePriceMt5UpdatedAt = d.aiLivePriceMt5UpdatedAt || null; updateLivePriceBox(); updateLastCandleWithLivePrice(); updateTrendSummary(); }
                // Data 5 pair currency numpang di dokumen public yang SAMA (zero extra Firestore read) - field-nya
                // di-suffix nama pair oleh ai-tick-currency.py (aiLiveCandlesMt5_USDJPY dst).
                CURRENCY_PAIRS.forEach(p => {
                    if (d[`aiLiveCandlesMt5_${p}`] && d[`aiLiveCandlesMt5_${p}`].length) {
                        currencyLiveCandles[p] = d[`aiLiveCandlesMt5_${p}`];
                        currencyLiveCandlesUpdatedAt[p] = d[`aiLiveCandlesMt5UpdatedAt_${p}`] || null;
                    }
                    if (d[`aiLivePriceMt5_${p}`] != null) {
                        currencyLivePrice[p] = d[`aiLivePriceMt5_${p}`];
                        currencyLivePriceUpdatedAt[p] = d[`aiLivePriceMt5UpdatedAt_${p}`] || null;
                    }
                });
                rerenderActiveSection();
            }
        }, err => console.error('Gagal ambil data publik dari cloud:', err));
    }

    function attachPrivateListener(uid) {
        if (privateUnsub) privateUnsub();
        privateUnsub = db.collection('appData').doc(uid).onSnapshot(doc => {
            if (doc.exists) {
                const d = doc.data();
                aiTradeData = d.aiTradeData || {}; aiModalAwal = d.aiModalAwal || 2500000;
                aiModalResetAt = d.aiModalResetAt || null;
                aiModalBeforeReset = d.aiModalBeforeReset || null;
                aiSettings = d.aiSettings || defaultAiSettings;
                botControl = d.botControl || {};
                localStorage.setItem('ai_trade_data_v1', JSON.stringify(aiTradeData)); localStorage.setItem('ai_modal_awal', aiModalAwal);
                localStorage.setItem('ai_modal_reset_at', JSON.stringify(aiModalResetAt));
                localStorage.setItem('ai_modal_before_reset', JSON.stringify(aiModalBeforeReset));
                localStorage.setItem('ai_settings_v1', JSON.stringify(aiSettings));
                localStorage.setItem('ai_bot_control_v1', JSON.stringify(botControl));
                applyMasterSettings();
                rerenderActiveSection();
            }
        }, err => { console.error('Gagal ambil data privat dari cloud:', err); alert('Gagal ambil data privat: ' + err.code); });
    }

    // Fase 2 Firestore egress fix (2026-09): data 5 pair currency sekarang di dokumen sendiri-sendiri
    // (appData/{uid}/currencyPairs/<PAIR>), BUKAN nested field di dokumen Gold lagi - biar update 1 pair
    // gak nge-trigger re-download seluruh data 6 instrumen di listener Gold/pair lain. 5 listener terpisah
    // di sini, tapi object lokal `currencyInstruments[pairKey]` tetap sama shape-nya kayak dulu, jadi
    // semua call-site BACA (getCurInstrument dkk) gak perlu berubah.
    function attachCurrencyListeners(uid) {
        detachCurrencyListeners();
        currencyUnsubs = CURRENCY_PAIRS.map(pairKey =>
            db.collection('appData').doc(uid).collection('currencyPairs').doc(pairKey).onSnapshot(doc => {
                currencyInstruments[pairKey] = doc.exists ? (doc.data() || {}) : {};
                rerenderActiveSection();
            }, err => console.error(`Gagal ambil data currencyPairs/${pairKey} dari cloud:`, err))
        );
    }

    function detachCurrencyListeners() {
        currencyUnsubs.forEach(unsub => unsub());
        currencyUnsubs = [];
    }

    // Migrasi 1x: expData/wealthData dulu numpang di 'appData/{uid}', sekarang pindah ke dokumen
    // 'userFinance/{uid}' sendiri. Kalau dokumen baru belum ada, salin dulu dari yang lama biar gak
    // keliatan kosong di device yang belum sempat nge-trigger save manual.
    function migrateFinanceDataIfNeeded(uid) {
        db.collection('userFinance').doc(uid).get().then(financeDoc => {
            if (financeDoc.exists) return;
            db.collection('appData').doc(uid).get().then(oldDoc => {
                if (!oldDoc.exists) return;
                const d = oldDoc.data();
                if (!d.expData && !d.wealthData) return;
                db.collection('userFinance').doc(uid).set({ expData: d.expData || {}, wealthData: d.wealthData || defaultWealthHistory })
                    .catch(err => console.error('Gagal migrasi data keuangan:', err));
            });
        }).catch(err => console.error('Gagal cek migrasi data keuangan:', err));
    }

    function attachFinanceListener(uid) {
        if (financeUnsub) financeUnsub();
        financeUnsub = db.collection('userFinance').doc(uid).onSnapshot(doc => {
            if (doc.exists) {
                const d = doc.data();
                expData = d.expData || {}; wealthData = d.wealthData || defaultWealthHistory;
                localStorage.setItem('expense_data_v1', JSON.stringify(expData)); localStorage.setItem('wealth_data_v1', JSON.stringify(wealthData));
                rerenderActiveSection();
            }
        }, err => { console.error('Gagal ambil data keuangan dari cloud:', err); alert('Gagal ambil data keuangan: ' + err.code); });
    }

    function rerenderActiveSection() {
        renderHome();
        const activeNav = document.querySelector('.menu-item.active');
        if (!activeNav) return;
        const targetId = activeNav.getAttribute('data-target');
        if (targetId === 'view-trading') { if (document.getElementById('menu-dashboard').classList.contains('active')) renderXAUDashboard(); else renderXAUCalendar(); }
        else if (targetId === 'view-expenses') { if (document.getElementById('exp-menu-dashboard').classList.contains('active')) renderExpDashboard(); else renderExpCalendar(); }
        else if (targetId === 'view-sports') { if (document.getElementById('sport-menu-dashboard').classList.contains('active')) renderSportDashboard(); else renderSportCalendar(); }
        else if (targetId === 'view-wealth') renderWealthDashboard();
        else if (targetId === 'view-ai-trading' && isLoggedIn) {
            if (document.getElementById('ai-menu-dashboard').classList.contains('active')) renderAiDashboard();
            else if (document.getElementById('ai-menu-calendar').classList.contains('active')) renderAiCalendar();
            else if (document.getElementById('ai-menu-log').classList.contains('active')) renderAiLog();
            else if (document.getElementById('ai-menu-market').classList.contains('active') && lastAiCandles) {
                const openInfo = findOpenAiTrade(AI_METHOD_GROUPS.method1);
                updateLiveStatsBoxes(openInfo, lastAiCandles);
                if (openInfo) updateFloatingPl(openInfo, lastAiCandles);
            }
        }
        else if (targetId === 'view-ai-currency' && isLoggedIn) renderCurrencyDashboard();
        else if (targetId === 'view-monitoring' && isLoggedIn) renderMonitoringDashboard();
        else if (targetId === 'view-work' && isLoggedIn) renderWork();
    }

    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    function formatRupiah(angka) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka); }
    let globalNavDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // tanggal 1: setMonth() dari tgl 29-31 bisa loncat/macet

    // ==========================================
    // API LIVE KURS USD TO IDR
    // ==========================================
    let liveKursIDR = 16000; // Harga fallback kalau offline
    async function fetchLiveKurs() {
        try {
            const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
            const data = await response.json();
            if(data && data.rates && data.rates.IDR) {
                liveKursIDR = data.rates.IDR;
                const kursDisplay = document.getElementById('live-kurs-display');
                if(kursDisplay) kursDisplay.innerText = formatRupiah(liveKursIDR);
            }
        } catch (error) {
            console.error("Gagal ambil kurs live:", error);
            const kursDisplay = document.getElementById('live-kurs-display');
            if(kursDisplay) kursDisplay.innerText = formatRupiah(liveKursIDR) + " (Offline Mode)";
        }
    }
    fetchLiveKurs(); // Panggil saat aplikasi terbuka

    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const menuItems = document.querySelectorAll('.menu-item');
    const contentSections = document.querySelectorAll('.content-section');

    toggleBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) sidebar.classList.toggle('active');
        else sidebar.classList.toggle('collapsed');
    });

    // Lebar sidebar bisa digeser (desktop). Disimpan di localStorage, dipasang ulang di <head> sebelum render.
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const SIDEBAR_MIN_W = 200, SIDEBAR_MAX_W = 420;
    sidebarResizer.addEventListener('pointerdown', (e) => {
        if (window.innerWidth <= 768) return;
        e.preventDefault();
        sidebarResizer.setPointerCapture(e.pointerId);
        document.body.classList.add('sidebar-resizing');
        const left = sidebar.getBoundingClientRect().left;
        const onMove = (ev) => {
            const w = Math.round(Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, ev.clientX - left)));
            document.documentElement.style.setProperty('--sidebar-width', w + 'px');
        };
        const onUp = () => {
            document.body.classList.remove('sidebar-resizing');
            sidebarResizer.removeEventListener('pointermove', onMove);
            const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
            try { if (w) localStorage.setItem('sidebar_w', w); } catch (err) { /* abaikan */ }
            window.dispatchEvent(new Event('resize'));
        };
        sidebarResizer.addEventListener('pointermove', onMove);
        sidebarResizer.addEventListener('pointerup', onUp, { once: true });
    });
    sidebarResizer.addEventListener('dblclick', () => {
        document.documentElement.style.removeProperty('--sidebar-width');
        try { localStorage.removeItem('sidebar_w'); } catch (err) { /* abaikan */ }
        window.dispatchEvent(new Event('resize'));
    });

    // Mode terang/gelap. Atribut data-theme dipasang di <head> (anti kedip), tombol di top bar.
    function isLightTheme() { return document.documentElement.getAttribute('data-theme') === 'light'; }
    function chartGridColor() { return isLightTheme() ? '#e2e5ea' : '#333'; }
    // Chart.js: mode gelap balikin ke default bawaan library (tampilan lama gak berubah).
    function applyChartDefaults() {
        if (!(window.Chart && Chart.defaults)) return;
        const light = isLightTheme();
        Chart.defaults.color = light ? '#4a505b' : '#666';
        Chart.defaults.borderColor = light ? '#e2e5ea' : 'rgba(0,0,0,0.1)';
    }
    // Grafik candle (Lightweight Charts). JANGAN dipanggil saat init - aiChart/curChart dideklarasi di bawah (TDZ).
    function applyChartTheme() {
        const light = isLightTheme();
        applyChartDefaults();
        [typeof aiChart !== 'undefined' ? aiChart : null, typeof curChart !== 'undefined' ? curChart : null].forEach(chart => {
            if (!chart) return;
            chart.applyOptions({
                layout: { background: { color: light ? '#ffffff' : '#1e1e1e' }, textColor: light ? '#4a505b' : '#ccc' },
                grid: { vertLines: { color: light ? '#eceef2' : '#333' }, horzLines: { color: light ? '#eceef2' : '#333' } },
            });
        });
    }
    applyChartDefaults();
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const light = !isLightTheme();
        if (light) document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (err) { /* abaikan */ }
        applyChartTheme();
        rerenderActiveSection();
    });

    let isLoggedIn = false;

    function resetActivityTimer() { if(isLoggedIn) localStorage.setItem('lastActivity', Date.now()); }
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivityTimer));

    function checkInactivity() {
        if(isLoggedIn) {
            const lastAct = parseInt(localStorage.getItem('lastActivity') || '0');
            if(Date.now() - lastAct > 30 * 60 * 1000) {
                auth.signOut(); showToast("Sesi habis (30 menit tanpa aktivitas). Silakan login kembali.", 'info');
            }
        }
    }

    // Toast non-blocking, ganti alert() biar gak munculin popup native browser.
    function showToast(msg, type, duration) {
        type = type || 'ok'; duration = duration || 4200;
        const root = document.getElementById('custom-toast');
        if (!root) { alert(msg); return; }
        const icons = {
            ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
            err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
        };
        const el = document.createElement('div');
        el.className = 'toast-item ' + type;
        el.innerHTML = '<span class="toast-ic">' + (icons[type] || icons.ok) + '</span><span class="toast-msg"></span>';
        el.querySelector('.toast-msg').textContent = msg;
        root.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); }, duration);
    }
    window.showToast = showToast;
    setInterval(checkInactivity, 60000); checkInactivity();

    function applyAuthState() {
        // Tampilan tombol "Masuk" vs kotak akun (nama+menu) diatur CSS lewat body.locked-mode,
        // sama kayak mekanisme ikon gembok di menu yang udah ada.
        if (isLoggedIn) {
            document.body.classList.remove('locked-mode');
            resetActivityTimer();
        } else {
            document.body.classList.add('locked-mode');
            const menu = document.getElementById('acct-menu');
            if (menu) menu.classList.remove('open');
        }
    }
    applyAuthState();
    renderHome();
    attachPublicListener();

    let isFirstAuthCheck = true;
    auth.onAuthStateChanged(user => {
        if (user && isFirstAuthCheck) {
            const lastAct = parseInt(localStorage.getItem('lastActivity') || '0');
            if (lastAct && Date.now() - lastAct > 30 * 60 * 1000) {
                isFirstAuthCheck = false;
                auth.signOut();
                return;
            }
        }
        isFirstAuthCheck = false;
        isLoggedIn = !!user;
        applyAuthState();
        rerenderActiveSection();
        if (user) { attachPrivateListener(user.uid); attachCurrencyListeners(user.uid); attachFinanceListener(user.uid); migrateFinanceDataIfNeeded(user.uid); attachWorkListener(user.uid); }
        else {
            if (privateUnsub) { privateUnsub(); privateUnsub = null; }
            detachCurrencyListeners();
            if (financeUnsub) { financeUnsub(); financeUnsub = null; }
            if (workUnsub) { workUnsub(); workUnsub = null; }
            stopAiAutoTick();
        }
    });

    document.getElementById('btn-login').addEventListener('click', () => {
        document.getElementById('login-modal').style.display = 'flex';
    });

    document.getElementById('acct-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('acct-menu').classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('acct-menu');
        if (menu && menu.classList.contains('open') && !menu.contains(e.target) && e.target.id !== 'acct-trigger') {
            menu.classList.remove('open');
        }
    });
    document.getElementById('btn-logout').addEventListener('click', () => {
        document.getElementById('acct-menu').classList.remove('open');
        showConfirm("Yakin mau logout bos?", () => { auth.signOut(); });
    });

    document.getElementById('btn-upload-cloud').addEventListener('click', () => {
        showConfirm("Ini akan MENIMPA data cloud dengan data di device ini. Cuma pakai ini di device yang punya data paling lengkap. Yakin?", () => {
            Promise.all([pushPublicToCloud(), pushAiToCloud(), pushFinanceToCloud()]).then(() => {
                showToast("Data lokal berhasil di-upload ke Cloud!", 'ok');
            }).catch(err => {
                showToast("Gagal upload ke Cloud: " + err.code + " — " + err.message, 'err', 6000);
            });
        });
    });

    const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-7 0-11-7-11-7a18.6 18.6 0 0 1 5-5.6M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M1 1l22 22"/></svg>';
    const togglePassBtn = document.getElementById('toggle-pass');
    if(togglePassBtn) {
        togglePassBtn.innerHTML = ICON_EYE;
        togglePassBtn.addEventListener('click', function() {
            const passInput = document.getElementById('login-pass');
            if (passInput.type === 'password') { passInput.type = 'text'; this.innerHTML = ICON_EYE_OFF; }
            else { passInput.type = 'password'; this.innerHTML = ICON_EYE; }
        });
    }

    document.getElementById('btn-submit-login').addEventListener('click', () => {
        const uRaw = document.getElementById('login-user').value.trim().toLowerCase(); const p = document.getElementById('login-pass').value;
        const u = uRaw.includes('@') ? uRaw : uRaw + '@jurnal.local';
        auth.signInWithEmailAndPassword(u, p).then(() => {
            document.getElementById('login-modal').style.display = 'none'; document.getElementById('login-user').value = ''; document.getElementById('login-pass').value = ''; document.getElementById('login-pass').type = 'password';
            if(togglePassBtn) togglePassBtn.innerHTML = ICON_EYE;
            showToast("Akses dibuka. Selamat datang kembali.", 'ok');
        }).catch((err) => { console.error(err); showToast("Login gagal — " + err.code, 'err', 6000); });
    });

    const titleMap = { 'view-home': 'Pusat Kendali', 'view-trading': 'Jurnal XAUUSD', 'view-ai-trading': 'Trading AI', 'view-ai-currency': 'Trading AI Currency', 'view-monitoring': 'Monitoring', 'view-expenses': 'Pengeluaran Bulanan', 'view-sports': 'Jurnal Olahraga', 'view-wealth': 'History Kekayaan', 'view-career': 'Peningkatan Karir', 'view-roadmap': 'Roadmap Masa Depan', 'view-work': 'Pekerjaan' };

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.getAttribute('data-target');
            menuItems.forEach(nav => nav.classList.remove('active')); item.classList.add('active'); contentSections.forEach(section => section.classList.remove('active')); document.getElementById(targetId).classList.add('active');
            if (window.innerWidth <= 768) sidebar.classList.remove('active'); document.title = "Personal OS - " + (titleMap[targetId] || "App");
            
            if(targetId === 'view-home') renderHome();
            else if(targetId === 'view-trading') renderXAUCalendar();
            else if (targetId === 'view-expenses') renderExpCalendar();
            else if (targetId === 'view-sports') renderSportCalendar();
            else if (targetId === 'view-wealth') renderWealthDashboard();
            else if (targetId === 'view-ai-trading' && isLoggedIn) { loadEconomicCalendarWidget(); startAiAutoTick(); }
            else if (targetId === 'view-ai-currency' && isLoggedIn) { renderCurrencyDashboard(); }
            else if (targetId === 'view-monitoring' && isLoggedIn) { renderMonitoringDashboard(); }
            else if (targetId === 'view-work' && isLoggedIn) { renderWork(); }
            if (targetId !== 'view-ai-trading') stopAiAutoTick();
        });
    });

    window.showConfirm = function(msg, onYes) {
        document.getElementById('confirm-msg').innerText = msg; document.getElementById('custom-confirm').style.display = 'flex';
        document.getElementById('confirm-yes').onclick = function() { document.getElementById('custom-confirm').style.display = 'none'; onYes(); };
        document.getElementById('confirm-no').onclick = function() { document.getElementById('custom-confirm').style.display = 'none'; };
    }
    // Expose ke window biar bisa dipanggil dari tombol Refresh (inline onclick) di masing-masing tab Trading AI
    window.aiRefreshBtnClick = function(btn, kind) {
        const orig = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '⏳ Refresh...';
        const restore = () => { btn.disabled = false; btn.innerHTML = orig; };
        setTimeout(() => {
            let result;
            if (kind === 'calendar') result = renderAiCalendar();
            else if (kind === 'dashboard') result = renderAiDashboard();
            else if (kind === 'log') result = renderAiLog();
            Promise.resolve(result).finally(restore);
        }, 30);
    };

    const emptyStateHTML = `<h3 style="color:#ffd700; margin-bottom:10px;">Belum ada transaksi/progress bulan ini yah 👀</h3><p style="color:#aaa;">Semoga kamu di bulan sebelumnya dan ini akan lebih baik gituu! 🚀</p>`;

    // ==========================================
    // MODULE EXPORT CSV SUPER LENGKAP
    // ==========================================
    // Dipakai bareng sama export per-instrumen (modal 'ai'/'cur') dan export multi-instrumen di
    // Monitoring - biar kolom (termasuk dual-track L3 ATR) gak kena duplikasi 2 tempat & gampang diupdate.
    const AI_TRADE_CSV_HEADER = "Tanggal,Arah,Timeframe,Jenis Sinyal,Waktu Buka,Waktu Tutup,L1 Entry,L1 SL,L1 TP,L1 TP Pips,L1 Lot,L1 Status,L1 PL,L2 Entry,L2 SL,L2 TP,L2 TP Pips,L2 Lot,L2 Status,L2 PL,L3 Entry,L3 SL,L3 TP,L3 TP Pips,L3 Lot,L3 Status,L3 PL,L3 TP ATR Raw (sebelum clamp),L3 TP Fixed Equivalent,Alasan,Status Trade,Total P/L (Rp)\n";
    function buildAiTradeCsv(tradeData, period, targetPrefix, decimals) {
        let content = AI_TRADE_CSV_HEADER;
        const layerCols = (ly) => ly ? [parseFloat(ly.entry).toFixed(decimals), parseFloat(ly.sl).toFixed(decimals), parseFloat(ly.tp).toFixed(decimals), ly.tpPips ?? '-', ly.lot ?? '-', AI_LAYER_STATUS_LABEL[ly.status] || ly.status, ly.pl || 0] : ['-', '-', '-', '-', '-', '-', '-'];
        for (let d in tradeData) {
            if (period === 'all' || d.startsWith(targetPrefix)) {
                tradeData[d].forEach(t => {
                    const alasan = t.alasan ? t.alasan.replace(/"/g, '""') : '';
                    const layers = t.layers || [];
                    const l3 = layers[2];
                    let row = [
                        d, t.arah, t.tf || '-', t.signalType || '-',
                        t.openedAt || '-', t.closedAt || 'Masih Open',
                        ...layerCols(layers[0]), ...layerCols(layers[1]), ...layerCols(l3),
                        (l3 && l3.tpPipsAtrRaw != null) ? l3.tpPipsAtrRaw : '-',
                        (l3 && l3.tpPipsFixedEquivalent != null) ? l3.tpPipsFixedEquivalent : '-',
                        `"${alasan}"`, t.status, t.pl || 0
                    ];
                    content += row.join(",") + "\n";
                });
            }
        }
        return content;
    }
    function triggerCsvDownload(csvContent, filename) {
        const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    let currentExportType = '';
    let currentExportPairKey = '';
    window.openExportMenu = function(type) {
        currentExportType = type;
        if (type === 'cur') currentExportPairKey = currentCurPair();
        document.getElementById('export-modal').style.display = 'flex';
    };

    document.getElementById('btn-export-csv').onclick = function() {
        let period = document.getElementById('export-csv-period').value;
        const y = globalNavDate.getFullYear(); 
        const m = globalNavDate.getMonth();
        const targetPrefix = `${y}-${String(m+1).padStart(2,'0')}`;
        
        let csvContent = "data:text/csv;charset=utf-8,";
        
        if (currentExportType === 'xau') {
            csvContent += "Tanggal,Waktu Buka,Waktu Tutup,Durasi,TF,Arah,Area,News,Emosi,Total Layer,Detail Layer (Entry/SL/Pips),Alasan Entry,P/L (Rp)\n";
            for(let d in journalData) {
                if(period === 'all' || d.startsWith(targetPrefix)) {
                    journalData[d].forEach(t => {
                        let layers = t.layers ? t.layers.length : 1;
                        let layerDetail = (t.layers || []).map(ly => `${ly.entry}/${ly.sl}/${ly.pips}`).join('|');
                        let alasan = t.alasan ? t.alasan.replace(/"/g, '""') : '';
                        let row = [d, t.timeOpen||'-', t.timeClose||'-', t.duration||'-', t.tf, t.arah, t.area, t.news, t.emosi, layers, `"${layerDetail}"`, `"${alasan}"`, t.pl];
                        csvContent += row.join(",") + "\n";
                    });
                }
            }
        } else if (currentExportType === 'exp') {
            csvContent += "Tanggal,Jenis,Bank/E-Wallet,Kategori,Catatan,Jumlah (Rp)\n";
            for(let d in expData) {
                if(period === 'all' || d.startsWith(targetPrefix)) {
                    expData[d].forEach(t => {
                        let notes = t.notes ? t.notes.replace(/"/g, '""') : '';
                        let row = [d, t.type, t.bank, t.category, `"${notes}"`, t.amount];
                        csvContent += row.join(",") + "\n";
                    });
                }
            }
        } else if (currentExportType === 'sport') {
            csvContent += "Tanggal,Jam,Jenis,Target,Status,Total Durasi (Mnt),Detail Set (Gerakan:Kerja:Rest),Alasan Telat,Catatan Fisik\n";
            for(let d in sportData) {
                if(period === 'all' || d.startsWith(targetPrefix)) {
                    sportData[d].forEach(t => {
                        let notes = t.notes ? t.notes.replace(/"/g, '""') : '';
                        let reason = t.lateReason ? t.lateReason.replace(/"/g, '""') : '';
                        let setDetail = (t.sets || []).map(s => `${s.name}:${s.dur}:${s.rest}`).join('|');
                        let row = [d, t.time, t.type, t.target, t.achieved, t.totalDur, `"${setDetail}"`, `"${reason}"`, `"${notes}"`];
                        csvContent += row.join(",") + "\n";
                    });
                }
            }
        } else if (currentExportType === 'ai') {
            // L1/L2/L3 TP Pips (ly.tpPips) & 2 kolom dual-track L3 (tpPipsAtrRaw/tpPipsFixedEquivalent, cuma
            // keisi kalau l3TpAtrMode lagi ON pas trade itu dibuka) ditambah 2026-07-16 buat investigasi tpMode.
            csvContent += buildAiTradeCsv(aiTradeData, period, targetPrefix, 2);
        } else if (currentExportType === 'wealth') {
            csvContent += "ID,Tanggal,Jenis Transaksi,Keterangan,Jumlah (Rp)\n";
            wealthData.items.forEach(t => {
                if(period === 'all' || t.date.startsWith(targetPrefix)) {
                    let notes = t.note ? t.note.replace(/"/g, '""') : '';
                    let row = [t.id, t.date, t.type, `"${notes}"`, t.amount];
                    csvContent += row.join(",") + "\n";
                }
            });
        } else if (currentExportType === 'cur') {
            const curTradeData = getCurInstrument(currentExportPairKey).aiTradeData || {};
            csvContent += buildAiTradeCsv(curTradeData, period, targetPrefix, 5);
        }

        var encodedUri = encodeURI(csvContent);
        var link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const exportFileTag = currentExportType === 'cur' ? `cur_${currentExportPairKey}` : currentExportType;
        link.setAttribute("download", `Data_${exportFileTag}_${period === 'all' ? 'All' : targetPrefix}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        document.getElementById('export-modal').style.display = 'none';
    };

    // ==========================================
    // MODULE IMPORT CSV
    // ==========================================
    function parseCSVLine(line) {
        const result = []; let cur = ''; let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQuotes) {
                if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
                else cur += c;
            } else {
                if (c === '"') inQuotes = true;
                else if (c === ',') { result.push(cur); cur = ''; }
                else cur += c;
            }
        }
        result.push(cur);
        return result;
    }

    function parseCSVRows(text) {
        const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
        lines.shift(); // buang baris header
        return lines.map(parseCSVLine);
    }

    function handleCSVImport(inputId, callback) {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('change', function (e) {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    const rows = parseCSVRows(ev.target.result).map(r => Array.isArray(r) ? r.map(cell => typeof cell === 'string' ? cell.replace(/[<>]/g, '') : cell) : r); // buang < dan > supaya isi CSV dari luar tidak bisa jadi kode
                    const count = callback(rows);
                    alert(`Berhasil import ${count} data dari CSV!`);
                } catch (err) {
                    console.error(err);
                    alert('Gagal import CSV. Pastikan format file sesuai hasil export dari aplikasi ini.');
                }
                e.target.value = '';
            };
            reader.readAsText(file);
        });
    }

    handleCSVImport('csv-upload-xau', (rows) => {
        let count = 0;
        rows.forEach(r => {
            const [date, timeOpen, timeClose, duration, tf, arah, area, news, emosi, totalLayer, layerDetail, alasan, pl] = r;
            if (!date || pl === undefined || pl === '') return;
            if (!journalData[date]) journalData[date] = [];
            const layers = layerDetail ? layerDetail.split('|').filter(Boolean).map(s => { const [entry, sl, pips] = s.split('/'); return { entry, sl, pips }; }) : Array.from({ length: parseInt(totalLayer) || 1 }, () => ({ entry: '', sl: '', pips: '0' }));
            journalData[date].push({
                pl, alasan, tf, arah, area, news, emosi,
                timeOpen: timeOpen === '-' ? '' : timeOpen,
                timeClose: timeClose === '-' ? '' : timeClose,
                duration,
                layers
            });
            count++;
        });
        saveData('xauusd_data_v3', journalData);
        renderXAUCalendar(); renderHome();
        return count;
    });

    handleCSVImport('csv-upload-exp', (rows) => {
        let count = 0;
        rows.forEach(r => {
            const [date, type, bank, category, notes, amount] = r;
            if (!date || amount === undefined || amount === '') return;
            if (!expData[date]) expData[date] = [];
            expData[date].push({ type, bank, category, notes, amount });
            count++;
        });
        saveData('expense_data_v1', expData);
        renderExpCalendar(); renderHome();
        return count;
    });

    handleCSVImport('csv-upload-sport', (rows) => {
        let count = 0;
        rows.forEach(r => {
            const [date, time, type, target, achieved, totalDur, setDetail, lateReason, notes] = r;
            if (!date || totalDur === undefined || totalDur === '') return;
            if (!sportData[date]) sportData[date] = [];
            const sets = setDetail ? setDetail.split('|').filter(Boolean).map(s => { const [name, dur, rest] = s.split(':'); return { name, dur, rest }; }) : [];
            sportData[date].push({ time, type, target, achieved, totalDur, lateReason, notes, sets });
            count++;
        });
        saveData('sport_data_v1', sportData);
        renderSportCalendar(); renderHome();
        return count;
    });

    handleCSVImport('csv-upload-wealth', (rows) => {
        let count = 0;
        rows.forEach(r => {
            const [id, date, type, notes, amount] = r;
            if (!date || amount === undefined || amount === '') return;
            const existingIdx = wealthData.items.findIndex(i => String(i.id) === String(id));
            const item = { id: id && !isNaN(id) ? parseInt(id) : Date.now() + count, date, type, note: notes, amount };
            if (existingIdx > -1) wealthData.items[existingIdx] = item; else wealthData.items.push(item);
            count++;
        });
        saveData('wealth_data_v1', wealthData);
        renderWealthDashboard(); renderHome();
        return count;
    });

    // Sama persis definisi is_market_open() di scripts/ai_trading_core.py / watchdog-check.mjs - dipakai
    // Status Bot di Pusat Kendali biar gak false-alarm "mati" pas weekend (market emang tutup).
    function isMarketOpenClient() {
        const now = new Date();
        const day = now.getUTCDay(); const hour = now.getUTCHours();
        if (day === 6) return false;
        if (day === 0 && hour < 22) return false;
        if (day === 5 && hour >= 21) return false;
        return true;
    }

    // ==========================================
    // 1. MODUL HOMEPAGE PUSAT KENDALI
    // ==========================================
    function renderHome() {
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('home-month-year-display').innerText = `${monthNames[m]} ${y}`;
        const targetPrefix = `${y}-${String(m+1).padStart(2,'0')}`;
        
        let xauPl = 0;
        for(let d in journalData) { if(d.startsWith(targetPrefix)) journalData[d].forEach(t => xauPl += parseFloat(t.pl)); }
        
        let sportSesi = 0; let sportMenit = 0;
        for(let d in sportData) { if(d.startsWith(targetPrefix)) { sportData[d].forEach(t => { sportSesi++; sportMenit += parseFloat(t.totalDur); }); } }
        
        const prevNavDate = new Date(y, m - 1, 1);
        const prevPrefix = `${prevNavDate.getFullYear()}-${String(prevNavDate.getMonth() + 1).padStart(2, '0')}`;
        let expHtml = '';
        if(!isLoggedIn) { expHtml = `<div style="display:flex; align-items:center; gap:10px; margin-top:10px;">${pkIco('lock')}<div><h4 style="color:#aaa;">Terkunci</h4><p style="font-size:0.75rem; color:#666;">Login System untuk melihat</p></div></div>`; }
        else {
            let expTotal = 0; const catMap = {};
            for(let d in expData) { if(d.startsWith(targetPrefix)) expData[d].forEach(t => { const amt = parseFloat(t.amount) || 0; expTotal += amt; const cat = t.category || 'Lainnya'; catMap[cat] = (catMap[cat] || 0) + amt; }); }
            let prevTotal = 0;
            for(let d in expData) { if(d.startsWith(prevPrefix)) expData[d].forEach(t => prevTotal += parseFloat(t.amount) || 0); }
            let trendHtml = 'Belum ada data bulan lalu buat dibandingkan.';
            if (prevTotal > 0) {
                const diffPct = Math.round((expTotal - prevTotal) / prevTotal * 100);
                const naik = diffPct > 0;
                trendHtml = `<span style="color:${naik ? '#ff1744' : '#00e676'};">${naik ? '▲' : '▼'} ${Math.abs(diffPct)}%</span> dibanding bulan lalu`;
            }
            const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
            const topMax = topCats.length ? topCats[0][1] : 0;
            const catBarsHtml = topCats.map(([cat, amt]) => `
                <div class="pk-meter-row" style="margin-top:8px;">
                    <div class="pk-meter-label"><span>${cat}</span><span>${formatRupiah(amt)}</span></div>
                    <div class="pk-meter-track"><div class="pk-meter-fill" style="width:${topMax > 0 ? Math.round(amt / topMax * 100) : 0}%; background:#ff1744;"></div></div>
                </div>`).join('');
            expHtml = `
                <h3 style="color:#ff1744; margin-top:10px;">-${formatRupiah(expTotal)}</h3>
                <p style="font-size:0.78rem; color:#888; margin:2px 0 10px;">${trendHtml}</p>
                ${catBarsHtml || '<p style="font-size:0.78rem; color:#666;">Belum ada transaksi bulan ini.</p>'}
            `;
        }
        
        let wealthHtml = '';
        if(!isLoggedIn) { wealthHtml = `<div style="display:flex; align-items:center; gap:10px; margin-top:10px;">${pkIco('lock')}<div><h4 style="color:#aaa;">Terkunci</h4><p style="font-size:0.75rem; color:#666;">Login System untuk melihat</p></div></div>`; }
        else {
            // Rumus SAMA PERSIS kayak renderWealthDashboard() di halaman History Kekayaan (totalIncome/totalExpense/
            // expectedSavings/defisit) - sengaja gak diitung ulang beda formula, biar gak ada 2 sumber kebenaran.
            let wInc = 0, wExp = 0; wealthData.items.forEach(i => { if(i.type === 'income') wInc += parseFloat(i.amount); else wExp += parseFloat(i.amount); });
            let expectedSavings = wInc - wExp;
            let defisit = expectedSavings - wealthData.realMoney;
            let expPct = wInc > 0 ? Math.round(wExp / wInc * 100) : 0;
            // Meter dibikin satu arah ("makin panjang & hijau = makin sehat") biar gak kebalik sama meter
            // Tabungan di sebelahnya - makanya Pengeluaran ditampilin sebagai SISA anggaran, bukan dipakainya.
            let sisaPct = Math.max(0, 100 - expPct);
            let tabPct = expectedSavings > 0 ? Math.round(wealthData.realMoney / expectedSavings * 100) : (wealthData.realMoney > 0 ? 100 : 0);
            const sisaColor = sisaPct >= 40 ? '#00e676' : (sisaPct >= 20 ? '#ffb300' : '#ff1744');
            const tabColor = tabPct >= 100 ? '#00e676' : (tabPct >= 60 ? '#ffb300' : '#ff1744');
            wealthHtml = `
                <div class="kn-row">
                    <div class="kn-item"><b class="up">${formatRupiah(wInc)}</b><span>Pendapatan</span></div>
                    <div class="kn-item"><b class="amb">${formatRupiah(wExp)}</b><span>Pengeluaran</span></div>
                    <div class="kn-item"><b>${formatRupiah(expectedSavings)}</b><span>Tabungan Seharusnya</span></div>
                    <div class="kn-item"><b>${formatRupiah(wealthData.realMoney)}</b><span>Real Time</span></div>
                </div>
                <div class="pk-meter-row">
                    <div class="pk-meter-label"><span>Sisa Anggaran (${expPct}% pendapatan sudah terpakai)</span><span>${sisaPct}%</span></div>
                    <div class="pk-meter-track"><div class="pk-meter-fill" style="width:${Math.min(100, Math.max(0, sisaPct))}%; background:${sisaColor};"></div></div>
                </div>
                <div class="pk-meter-row" style="margin-top:8px;">
                    <div class="pk-meter-label"><span>Tabungan (dari target)</span><span>${tabPct}%</span></div>
                    <div class="pk-meter-track"><div class="pk-meter-fill" style="width:${Math.min(100, Math.max(0, tabPct))}%; background:${tabColor};"></div></div>
                </div>
                <p style="font-size:0.78rem; color:#888; margin-top:10px;">${defisit > 0 ? `Defisit ${formatRupiah(defisit)} · Target Recovery` : 'Surplus / Aman · Tabungan terjaga'}</p>
            `;
        }

        let aiHtml = '', curHtml = '', rankingHtml = '';
        let aiClosedPl = 0, aiClosedCount = 0;
        const pkLockedHtml = `<div style="display:flex; align-items:center; gap:10px; margin-top:10px;">${pkIco('lock')}<div><h4 style="color:#aaa;">Terkunci</h4><p style="font-size:0.75rem; color:#666;">Login System untuk melihat</p></div></div>`;

        // Status Bot dikecualikan dari gerbang login - datanya dari dokumen "public" (heartbeat harga live)
        // yang memang bisa dibaca siapapun tanpa login (sama kayak journalData/sportData), jadi tetap
        // ditampilin walau belum login, gak kayak P/L trade yang privat.
        const marketOpen = isMarketOpenClient();
        const botList = [{ label: 'Gold', updatedAt: aiLivePriceMt5UpdatedAt }, ...CURRENCY_PAIRS.map(p => ({ label: p, updatedAt: currencyLivePriceUpdatedAt[p] || null }))];
        const botStatusHtml = marketOpen ? botList.map(b => {
            const ageMin = b.updatedAt ? (Date.now() - new Date(b.updatedAt).getTime()) / 60000 : Infinity;
            const alive = ageMin <= STATUS_BOT_STALE_MINUTES;
            const ageText = ageMin === Infinity ? 'belum pernah update' : (ageMin < 1 ? 'baru saja' : `${Math.round(ageMin)}m lalu`);
            return `<div class="pk-bot-row"><span><i class="pk-dot ${alive ? 'on' : 'off'}"></i>${b.label}</span><b class="${alive ? '' : 'loss-text'}">${alive ? 'Aktif' : 'Mati'} · ${ageText}</b></div>`;
        }).join('') : `<p style="font-size:0.82rem; color:#888;">Market sedang tutup (weekend) - status bot gak dicek sekarang, biar gak salah tandain "mati".</p>`;

        if(!isLoggedIn) {
            aiHtml = pkLockedHtml;
            curHtml = pkLockedHtml;
            rankingHtml = pkLockedHtml;
        }
        else {
            let aiWinCount = 0;
            for(let d in aiTradeData) { if(d.startsWith(targetPrefix)) aiTradeData[d].forEach(t => { if(t.status === 'closed') { const pl = parseFloat(t.pl || 0); aiClosedPl += pl; aiClosedCount++; if(pl > 0) aiWinCount++; } }); }
            const aiWinRate = aiClosedCount > 0 ? Math.round(aiWinCount / aiClosedCount * 100) : null;
            aiHtml = `<h3 class="${aiClosedPl >= 0 ? 'profit-text' : 'loss-text'}" style="margin-top:10px;">${aiClosedPl > 0 ? '+' : ''}${formatRupiah(aiClosedPl)}</h3><p style="font-size:0.8rem; color:#aaa;">${aiClosedCount} trade closed${aiWinRate !== null ? ` · Win Rate ${aiWinRate}%` : ''} - ${monthNames[m]} ${y}</p>`;

            let curTotalPl = 0, curTotalCount = 0, curWinCount = 0;
            const curBreakdown = CURRENCY_PAIRS.map(p => {
                let pl = 0, count = 0, win = 0;
                const td = getCurInstrument(p).aiTradeData || {};
                for(let d in td) { if(d.startsWith(targetPrefix)) td[d].forEach(t => { if(t.status === 'closed') { const tpl = parseFloat(t.pl || 0); pl += tpl; count++; if(tpl > 0) win++; } }); }
                curTotalPl += pl; curTotalCount += count; curWinCount += win;
                return { pair: p, pl };
            });
            const curWinRate = curTotalCount > 0 ? Math.round(curWinCount / curTotalCount * 100) : null;
            curHtml = `<h3 class="${curTotalPl >= 0 ? 'profit-text' : 'loss-text'}" style="margin-top:10px;">${curTotalPl > 0 ? '+' : ''}${formatRupiah(curTotalPl)}</h3><p style="font-size:0.8rem; color:#aaa;">${curTotalCount} trade closed${curWinRate !== null ? ` · Win Rate ${curWinRate}%` : ''} - ${monthNames[m]} ${y}</p>`;

            // Peringkat P/L Instrumen - gantiin kotak "Ringkasan Trading AI" lama yang gayanya beda sendiri;
            // sekarang jadi kartu biasa isi meter batang, konsisten sama Kekayaan Bersih/Belanja Bulanan.
            const allBreakdown = [{ pair: 'Gold (XAUUSD)', pl: aiClosedPl }, ...curBreakdown].sort((a, b) => b.pl - a.pl);
            const rankMax = Math.max(...allBreakdown.map(c => Math.abs(c.pl)), 1);
            rankingHtml = `<div class="pk-rank-grid">` + allBreakdown.map(c => `
                <div class="pk-meter-row">
                    <div class="pk-meter-label"><span>${c.pair}</span><span class="${c.pl >= 0 ? 'profit-text' : 'loss-text'}">${c.pl > 0 ? '+' : ''}${formatRupiah(c.pl)}</span></div>
                    <div class="pk-meter-track"><div class="pk-meter-fill" style="width:${Math.round(Math.abs(c.pl) / rankMax * 100)}%; background:${c.pl >= 0 ? '#00e676' : '#ff1744'};"></div></div>
                </div>`).join('') + `</div>`;
        }

        // Target sesi olahraga/bulan - cuma preferensi tampilan (disimpan per-device, gak perlu sync cloud).
        const sportTarget = parseInt(localStorage.getItem('sport_target_sesi')) || 12;
        const sportPct = Math.min(100, Math.round(sportSesi / sportTarget * 100));
        const sportRingHtml = `
            <div style="display:flex; align-items:center; gap:14px; margin-top:10px;">
                <div class="pk-ring" style="--p:${sportPct};"><div class="pk-ring-inner"><b>${sportSesi}</b><span>/${sportTarget}</span></div></div>
                <div><h3 style="color:#2196f3; margin:0;">${sportSesi} Sesi | ${sportMenit} Menit</h3><p style="font-size:0.8rem; color:#aaa; margin:2px 0 6px;">Aktivitas Fisik ${monthNames[m]} ${y}</p>
                <a href="#" id="pk-sport-target-edit" style="font-size:0.72rem; color:#2196f3; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">Ubah target (${sportTarget} sesi/bulan) ${pkIco('pencil')}</a></div>
            </div>`;

        const homeWidgets = document.getElementById('home-widgets');
        if(homeWidgets) {
            homeWidgets.innerHTML = `
                <div class="pk-section">Personal</div>
                <div class="dashboard-grid">
                    <div class="dash-card"><h3 style="color:#2196f3; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('heart')}Jurnal Olahraga</h3>${sportRingHtml}</div>
                    <div class="dash-card">
                        <h3 style="border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('checklist')}Fokus Kuartal Ini</h3>
                        <ul class="task-list">
                            <li>Konsistensi profit & disiplin XAUUSD.</li>
                            <li>Ketahanan fisik Naik Gunung.</li>
                            <li>Manajemen waktu.</li>
                        </ul>
                    </div>
                </div>
                <div class="pk-section">Keuangan</div>
                <div class="dashboard-grid">
                    <div class="dash-card"><h3 style="color:#ff1744; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('cart')}Belanja Bulanan</h3>${expHtml}</div>
                    <div class="dash-card"><h3 style="color:#ffb300; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('wallet')}Kekayaan Bersih</h3>${wealthHtml}</div>
                </div>
                <div class="pk-section">Trading</div>
                <p style="margin:-6px 0 12px; font-size:0.78rem; color:#777;">Data dari shadow trading (simulasi) - bot belum eksekusi uang real.</p>
                <div class="dashboard-grid pk-grid-4">
                    <div class="dash-card"><h3 style="color:#ffd700; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('barChart')}Jurnal Manual XAUUSD</h3><p style="font-size:0.72rem; color:#777; margin-top:8px;">Dicatat manual, bukan bot</p><h3 class="${xauPl >= 0 ? 'profit-text' : 'loss-text'}" style="margin-top:6px;">${xauPl > 0 ? '+' : ''}${formatRupiah(xauPl)}</h3><p style="font-size:0.8rem; color:#aaa;">P/L Bulan ${monthNames[m]} ${y}</p></div>
                    <div class="dash-card"><h3 style="color:#9c27b0; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('goldBars')}Bot AI - Gold</h3><p style="font-size:0.72rem; color:#777; margin-top:8px;">Shadow trading (simulasi)</p>${aiHtml}</div>
                    <div class="dash-card"><h3 style="color:#00bcd4; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('coins')}Bot AI - Currency</h3><p style="font-size:0.72rem; color:#777; margin-top:8px;">Shadow trading, 5 pair (simulasi)</p>${curHtml}</div>
                    <div class="dash-card"><h3 style="color:#4caf50; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('server')}Status Bot</h3><div style="margin-top:8px;">${botStatusHtml}</div></div>
                </div>
                <div class="dashboard-grid" style="margin-top: var(--space-md);">
                    <div class="dash-card"><h3 style="color:#ff9800; border-bottom: 1px dashed #444; padding-bottom:10px;">${pkIco('rank')}Peringkat P/L Instrumen</h3><p style="font-size:0.72rem; color:#777; margin-top:8px;">${monthNames[m]} ${y}, diurutkan dari untung tertinggi</p>${rankingHtml}</div>
                </div>
            `;
            const sportTargetEditEl = document.getElementById('pk-sport-target-edit');
            if (sportTargetEditEl) {
                sportTargetEditEl.onclick = (e) => {
                    e.preventDefault();
                    const val = prompt('Target sesi olahraga per bulan (contoh: 12):', sportTarget);
                    if (val === null) return;
                    const num = parseInt(val);
                    if (isNaN(num) || num <= 0) { showToast('Angka gak valid.', 'err'); return; }
                    localStorage.setItem('sport_target_sesi', num);
                    renderHome();
                };
            }
        }
    }
    // Pemilih bulan cepat - klik label bulan di tengah, pilih tahun lalu bulan (gak perlu klik panah berkali-kali).
    const pkPicker = document.getElementById('pk-month-picker');
    const pkMonthBtn = document.getElementById('home-month-year-display');
    let pkPickerYear = globalNavDate.getFullYear();
    function renderPkPicker() {
        const now = new Date();
        document.getElementById('pkmp-year-label').innerText = pkPickerYear;
        document.getElementById('pkmp-grid').innerHTML = monthNames.map((name, i) => {
            const selected = pkPickerYear === globalNavDate.getFullYear() && i === globalNavDate.getMonth();
            const current = pkPickerYear === now.getFullYear() && i === now.getMonth();
            return `<button class="pkmp-month${selected ? ' selected' : ''}${current ? ' current' : ''}" data-month="${i}">${name.slice(0, 3)}</button>`;
        }).join('');
    }
    function setPkPickerOpen(open) {
        pkPicker.hidden = !open;
        pkMonthBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) { pkPickerYear = globalNavDate.getFullYear(); renderPkPicker(); }
    }
    function goToHomeMonth(y, m) { globalNavDate = new Date(y, m, 1); setPkPickerOpen(false); renderHome(); }
    pkMonthBtn.onclick = (e) => { e.stopPropagation(); setPkPickerOpen(pkPicker.hidden); };
    pkPicker.onclick = (e) => {
        e.stopPropagation();
        const monthBtn = e.target.closest('.pkmp-month');
        if (monthBtn) goToHomeMonth(pkPickerYear, Number(monthBtn.dataset.month));
    };
    document.getElementById('pkmp-prev-year').onclick = () => { pkPickerYear--; renderPkPicker(); };
    document.getElementById('pkmp-next-year').onclick = () => { pkPickerYear++; renderPkPicker(); };
    document.getElementById('pkmp-this-month').onclick = () => { const n = new Date(); goToHomeMonth(n.getFullYear(), n.getMonth()); };
    document.addEventListener('click', () => { if (!pkPicker.hidden) setPkPickerOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pkPicker.hidden) setPkPickerOpen(false); });

    document.getElementById('home-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderHome(); }; document.getElementById('home-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderHome(); };

    // ==========================================
    // 2. MODUL JURNAL XAUUSD
    // ==========================================
    let currentXAUDateStr = null; let plChartInstance = null; let winRateChartInstance = null;

    document.getElementById('menu-calendar').addEventListener('click', function() { this.classList.add('active'); document.getElementById('menu-dashboard').classList.remove('active'); document.getElementById('view-calendar').style.display = 'block'; document.getElementById('view-dashboard').style.display = 'none'; renderXAUCalendar(); });
    document.getElementById('menu-dashboard').addEventListener('click', function() { this.classList.add('active'); document.getElementById('menu-calendar').classList.remove('active'); document.getElementById('view-calendar').style.display = 'none'; document.getElementById('view-dashboard').style.display = 'block'; renderXAUDashboard(); });

    // FUNGSI KONVERTER USD/CENT/BTC/JPY OTOMATIS
    function autoConvertPL() {
        const type = document.getElementById('xau-currency-type').value;
        const val = parseFloat(document.getElementById('xau-value-input').value) || 0;
        let total = 0;

        if (type === 'USD') total = val * liveKursIDR;
        else if (type === 'Cent') total = (val / 100) * liveKursIDR;
        else if (type === 'BTC') total = val * 65000 * liveKursIDR; // Asumsi patokan rate BTC kasar, atau bisa pasang API BTC live juga kalau butuh
        else if (type === 'JPY') total = val * (liveKursIDR / 150); // Konversi silang kasar untuk Yen

        if (document.getElementById('xau-value-input').value !== '') {
            document.getElementById('input-pl').value = total.toFixed(0);
        }
    }
    document.getElementById('xau-currency-type').addEventListener('change', autoConvertPL);
    document.getElementById('xau-value-input').addEventListener('input', autoConvertPL);

    function renderXAUCalendar() {
        const cal = document.getElementById('calendar'); cal.innerHTML = '';
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); 
        document.getElementById('month-year-display').innerText = `${monthNames[m]} ${y}`;
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let totalBulan = 0;

        for (let w = 0; w < Math.ceil((firstDay + daysInMonth)/7); w++) {
            let weeklyPl = 0; let hasData = false;
            for (let d = 0; d < 7; d++) {
                const dayNum = (w * 7 + d) - firstDay + 1;
                if (dayNum > 0 && dayNum <= daysInMonth) {
                    const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
                    const trades = journalData[fDate] || []; let dayPl = 0; 
                    if (trades.length > 0) { hasData=true; trades.forEach(t => dayPl += parseFloat(t.pl)); weeklyPl+=dayPl; totalBulan+=dayPl; }
                    const card = document.createElement('div'); card.className = `day-card ${dayPl>0?'profit':dayPl<0?'loss':''}`;
                    card.innerHTML = `${trades.length>0?`<span class="trade-count">${trades.length}</span>`:''}<div class="day-number">${dayNum}</div>${trades.length>0?`<span class="day-pl ${dayPl>0?'profit-text':dayPl<0?'loss-text':''}">${dayPl>0?'+':''}${formatRupiah(dayPl)}</span>`:''}`;
                    card.onclick = () => { if(isLoggedIn) openXAUModal(fDate, dayNum); }; cal.appendChild(card);
                } else cal.appendChild(Object.assign(document.createElement('div'), {className:'empty-card'}));
            }
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData?(weeklyPl>0?'weekly-profit':(weeklyPl<0?'weekly-loss':'')):'empty-card'}`;
            if(hasData) wCard.innerHTML = `<div class="week-title">Mg ${w+1}</div><div class="week-pl ${weeklyPl>0?'profit-text':'loss-text'}">${weeklyPl>0?'+':''}${formatRupiah(weeklyPl)}</div>`;
            cal.appendChild(wCard);
        }
        const totalEl = document.getElementById('monthly-total'); totalEl.innerText = formatRupiah(totalBulan); totalEl.className = totalBulan > 0 ? 'profit-text' : (totalBulan < 0 ? 'loss-text' : 'netral'); updateXAUEquity(y, m);
    }
    
    document.getElementById('prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderXAUCalendar(); }; document.getElementById('next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderXAUCalendar(); };
    document.getElementById('clear-data-btn').onclick = () => { showConfirm("Data XAUUSD bakal kehapus permanen loh. Yakin?", () => { journalData={}; saveData('xauusd_data_v3', journalData); renderXAUCalendar(); }); };

    function updateXAUEquity(vY, vM) {
        let sumBefore = 0; let sumDuring = 0;
        for (const d in journalData) { 
            let tY = new Date(d).getFullYear(); let tM = new Date(d).getMonth(); let dt = 0; 
            journalData[d].forEach(t => dt += parseFloat(t.pl)); 
            if (tY < vY || (tY === vY && tM < vM)) sumBefore += dt; else if (tY === vY && tM === vM) sumDuring += dt; 
        }
        let stEq = modalAwal + sumBefore; let enEq = stEq + sumDuring;
        document.getElementById('base-equity').innerText = formatRupiah(modalAwal); document.getElementById('start-equity').innerText = formatRupiah(stEq);
        let diffBadge = sumDuring > 0 ? `<span class="diff-badge" style="color:#00e676;">(+${formatRupiah(sumDuring)})</span>` : (sumDuring < 0 ? `<span class="diff-badge" style="color:#ff1744;">(${formatRupiah(sumDuring)})</span>`:'');
        document.getElementById('current-equity').innerHTML = `${formatRupiah(enEq)} <span style="margin-left:5px;">${diffBadge}</span>`;
        let growthBadge = sumDuring > 0 ? `<span style="color:#00e676;">+${(stEq>0 ? sumDuring/stEq*100 : 0).toFixed(2)}%</span>` : (sumDuring < 0 ? `<span style="color:#ff1744;">${(stEq>0 ? sumDuring/stEq*100 : 0).toFixed(2)}%</span>`:`<span style="color:#aaa;">0.00%</span>`);
        document.getElementById('equity-growth').innerHTML = growthBadge;
    }

    function calcXAUDuration() {
        let open = document.getElementById('xau-time-open').value; let close = document.getElementById('xau-time-close').value;
        if(open && close) {
            let [oH, oM] = open.split(':'); let [cH, cM] = close.split(':');
            let dOpen = new Date(2000, 0, 1, oH, oM); let dClose = new Date(2000, 0, 1, cH, cM);
            if(dClose < dOpen) dClose.setDate(dClose.getDate() + 1); // Cross midnight
            let diffMins = Math.floor((dClose - dOpen) / 60000);
            let h = Math.floor(diffMins / 60); let m = diffMins % 60;
            document.getElementById('xau-auto-duration').innerText = `${h} Jam ${m} Menit`;
            return `${h} Jam ${m} Menit`;
        }
        return "0 Jam 0 Menit";
    }
    document.getElementById('xau-time-open').addEventListener('input', calcXAUDuration); document.getElementById('xau-time-close').addEventListener('input', calcXAUDuration);

    document.getElementById('btn-add-xau-layer').onclick = () => {
        let cont = document.getElementById('xau-layers-container');
        let div = document.createElement('div'); div.className = 'layer-row'; div.style.cssText = "display:flex; gap:10px; margin-top:5px;";
        div.innerHTML = `<input type="number" step="any" class="form-input layer-entry" placeholder="Entry" required><input type="number" step="any" class="form-input layer-sl" placeholder="SL"><span style="color:#aaa; font-size:0.8rem; align-self:center;">Pips: <b class="layer-pips">0</b></span><button type="button" class="del-btn" onclick="this.parentElement.remove()">X</button>`;
        cont.appendChild(div);
        
        div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', function() {
            let row = this.parentElement; let e = parseFloat(row.querySelector('.layer-entry').value) || 0; let s = parseFloat(row.querySelector('.layer-sl').value) || 0;
            row.querySelector('.layer-pips').innerText = s > 0 ? (Math.abs(e - s) * 10).toFixed(0) : "0";
        }));
    };

    function openXAUModal(dateStr, dayNum) {
        currentXAUDateStr = dateStr; document.getElementById('modal-date-title').innerText = `Entry Tgl ${dayNum}`; document.getElementById('today-history').innerHTML=''; 
        (journalData[dateStr]||[]).forEach((t,i) => { 
            let upBtn = i > 0 ? `<button type="button" class="reorder-btn" title="Naik" onclick="moveXAU('${dateStr}', ${i}, -1)">⬆️</button>` : '';
            let downBtn = i < journalData[dateStr].length - 1 ? `<button type="button" class="reorder-btn" title="Turun" onclick="moveXAU('${dateStr}', ${i}, 1)">⬇️</button>` : '';
            document.getElementById('today-history').innerHTML += `<div class="history-item ${t.pl>0?'hist-profit':'hist-loss'}"><div><strong>${formatRupiah(t.pl)}</strong><br><span style="color:#aaa; font-size:0.75rem;">[${t.tf}] ${t.arah} | Layer: ${(t.layers||[]).length}</span></div><div class="action-group">${upBtn}${downBtn}<button type="button" class="edit-btn" onclick="editXAUTrade('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button><button type="button" class="del-btn" onclick="deleteXAUTrade('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/></svg></button></div></div>`; 
        });
        document.getElementById('xau-layers-container').innerHTML = ''; document.getElementById('btn-add-xau-layer').click(); // Default 1 layer
        
        // Reset konverter
        document.getElementById('xau-value-input').value = '';

        document.getElementById('entry-modal').style.display = 'flex';
    }
    document.getElementById('close-modal').onclick = () => document.getElementById('entry-modal').style.display='none';
    
    window.moveXAU = (d, i, dir) => { let arr = journalData[d]; let temp = arr[i]; arr[i] = arr[i+dir]; arr[i+dir] = temp; saveData('xauusd_data_v3', journalData); openXAUModal(d, new Date(d).getDate()); renderXAUCalendar(); }
    window.deleteXAUTrade = (d, i) => { journalData[d].splice(i,1); if(!journalData[d].length) delete journalData[d]; saveData('xauusd_data_v3', journalData); openXAUModal(d, new Date(d).getDate()); renderXAUCalendar(); };
    window.editXAUTrade = (d, i) => { 
        let t = journalData[d][i]; document.getElementById('input-pl').value = t.pl; document.getElementById('input-alasan').value = t.alasan; document.getElementById('input-tf').value = t.tf; document.getElementById('input-arah').value = t.arah; document.getElementById('input-area').value = t.area; document.getElementById('input-news').value = t.news; document.getElementById('input-emosi').value = t.emosi;
        document.getElementById('xau-time-open').value = t.timeOpen || ''; document.getElementById('xau-time-close').value = t.timeClose || ''; calcXAUDuration();
        document.getElementById('xau-layers-container').innerHTML = '';
        if(t.layers && t.layers.length > 0) {
            t.layers.forEach(ly => {
                document.getElementById('btn-add-xau-layer').click();
                let lastRow = document.getElementById('xau-layers-container').lastElementChild;
                lastRow.querySelector('.layer-entry').value = ly.entry; lastRow.querySelector('.layer-sl').value = ly.sl;
                lastRow.querySelector('.layer-pips').innerText = ly.pips;
            });
        } else { document.getElementById('btn-add-xau-layer').click(); }
        document.getElementById('edit-index').value = i; document.getElementById('cancel-edit-btn').style.display = 'block'; 
        
        // Reset konverter saat mode edit
        document.getElementById('xau-value-input').value = ''; 
    };
    
    document.getElementById('cancel-edit-btn').onclick = () => { 
        document.getElementById('entry-form').reset(); 
        document.getElementById('edit-index').value = "-1"; 
        document.getElementById('cancel-edit-btn').style.display = 'none'; 
        document.getElementById('xau-layers-container').innerHTML = ''; 
        document.getElementById('btn-add-xau-layer').click(); 
        document.getElementById('xau-auto-duration').innerText="0 Jam 0 Menit"; 
        document.getElementById('xau-value-input').value = ''; 
    };

    document.getElementById('entry-form').onsubmit = (e) => {
        e.preventDefault(); if(!journalData[currentXAUDateStr]) journalData[currentXAUDateStr]=[];
        let layers = [];
        document.querySelectorAll('.layer-row').forEach(row => { layers.push({ entry: row.querySelector('.layer-entry').value, sl: row.querySelector('.layer-sl').value, pips: row.querySelector('.layer-pips').innerText }); });
        
        let newData = { pl: document.getElementById('input-pl').value, alasan: document.getElementById('input-alasan').value, tf: document.getElementById('input-tf').value, arah: document.getElementById('input-arah').value, area: document.getElementById('input-area').value, news: document.getElementById('input-news').value, emosi: document.getElementById('input-emosi').value, timeOpen: document.getElementById('xau-time-open').value, timeClose: document.getElementById('xau-time-close').value, duration: document.getElementById('xau-auto-duration').innerText, layers: layers };
        let idx = parseInt(document.getElementById('edit-index').value); if(idx > -1) journalData[currentXAUDateStr][idx] = newData; else journalData[currentXAUDateStr].push(newData);
        saveData('xauusd_data_v3', journalData); document.getElementById('cancel-edit-btn').click(); openXAUModal(currentXAUDateStr, new Date(currentXAUDateStr).getDate()); renderXAUCalendar();
    };

    let xauTableMaster = [];
    function renderXAUDashboard() {
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); document.getElementById('dash-month-year-display').innerText = `${monthNames[m]} ${y}`;
        
        let labels = [], profitDataArr = [], lossDataArr = []; let winCount = 0, lossCount = 0, totalTrades = 0; xauTableMaster = []; 
        let maxWin = { pl: 0, date: '-', detail: '-' }; let maxLoss = { pl: 0, date: '-', detail: '-' };
        let currentStreak = 0; let globalLossStreak = 0; let globalWinStreak = 0; let monthHasData = false;
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let weeklyReports = []; for(let i=0; i<Math.ceil((firstDay + daysInMonth)/7); i++) weeklyReports.push({ wins: 0, losses: 0, pl: 0, hasData: false });

        for (let i = 1; i <= daysInMonth; i++) {
            const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            let dailyProfit = 0; let dailyLoss = 0; let netDaily = 0;
            const trades = journalData[fDate] || []; let wIdx = Math.floor((firstDay + i - 1) / 7);
            
            if (trades.length > 0) {
                monthHasData = true; weeklyReports[wIdx].hasData = true; labels.push(String(i));
                trades.forEach(t => { 
                    let p = parseFloat(t.pl || 0); netDaily += p; totalTrades++;
                    if (p >= 0) { dailyProfit += p; winCount++; weeklyReports[wIdx].wins++; } else { dailyLoss += p; lossCount++; weeklyReports[wIdx].losses++; }
                    if (p > maxWin.pl) maxWin = { pl: p, date: fDate, detail: t.alasan }; 
                    if (p < maxLoss.pl) maxLoss = { pl: p, date: fDate, detail: t.alasan };
                    xauTableMaster.push({ rawDate: new Date(fDate), date: fDate, ...t, plVal: p });
                });
                weeklyReports[wIdx].pl += netDaily;
                if (netDaily > 0) { if (currentStreak < 0) currentStreak = 0; currentStreak++; if (currentStreak > globalWinStreak) globalWinStreak = currentStreak; } 
                else if (netDaily < 0) { if (currentStreak > 0) currentStreak = 0; currentStreak--; if (Math.abs(currentStreak) > globalLossStreak) globalLossStreak = Math.abs(currentStreak); }
                
                profitDataArr.push(dailyProfit); lossDataArr.push(dailyLoss);
            }
        }

        const emptyState = document.getElementById('xau-empty-state'); const dashContent = document.getElementById('xau-dash-content');
        if(!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; } 
        else {
            emptyState.style.display = 'none'; dashContent.style.display = 'block';
            let msgStreak = globalLossStreak >= 2 ? `<span style="color:#ff1744;">⚠️ <strong>BURUK!</strong> Loss beruntun ${globalLossStreak}x bulan ini.</span>` : (globalWinStreak >= 2 ? `<span style="color:#00e676;">🌟 <strong>OKE BANGET!</strong> Profit beruntun ${globalWinStreak}x!</span>` : `<span style="color:#aaa;">Siklus market normal.</span>`);
            document.getElementById('weekly-streak-msg').innerHTML = msgStreak;
            
            const wGrid = document.getElementById('weekly-breakdown-grid'); wGrid.innerHTML = '';
            weeklyReports.forEach((wr, idx) => { if(wr.hasData) wGrid.innerHTML += `<div class="weekly-card ${wr.pl > 0 ? 'week-profit' : (wr.pl < 0 ? 'week-loss' : '')}"><h4>Minggu ${idx + 1}</h4><p><span>Win:</span> <span style="color:#00e676;">${wr.wins}x</span></p><p><span>Loss:</span> <span style="color:#ff1744;">${wr.losses}x</span></p><p style="border-top:1px dotted #444; padding-top:5px;"><span>Hasil:</span> <strong class="${wr.pl > 0 ? 'profit-text' : 'loss-text'}">${wr.pl > 0 ? '+' : ''}${formatRupiah(wr.pl)}</strong></p></div>`; });
            
            document.getElementById('highest-win-pl').innerText = maxWin.pl > 0 ? `+${formatRupiah(maxWin.pl)}` : 'Rp 0'; document.getElementById('highest-win-desc').innerText = maxWin.date !== '-' ? `[${maxWin.date}] ${maxWin.detail}` : '-';
            document.getElementById('highest-loss-pl').innerText = maxLoss.pl < 0 ? formatRupiah(maxLoss.pl) : 'Rp 0'; document.getElementById('highest-loss-desc').innerText = maxLoss.date !== '-' ? `[${maxLoss.date}] ${maxLoss.detail}` : '-';

            renderXAUTable();
            
            if (plChartInstance) plChartInstance.destroy(); 
            plChartInstance = new Chart(document.getElementById('plChart').getContext('2d'), { 
                type: 'bar', 
                data: { labels: labels, datasets: [
                    { label: 'Total Profit', data: profitDataArr, backgroundColor: '#00e676', borderRadius: 4 },
                    { label: 'Total Loss', data: lossDataArr, backgroundColor: '#ff1744', borderRadius: 4 }
                ]}, 
                options: { 
                    maintainAspectRatio: false, 
                    scales: { x: { stacked: true }, y: { stacked: true } },
                    plugins: { 
                        legend: { display: false },
                        tooltip: { callbacks: { footer: function(tooltipItems) { let total = 0; tooltipItems.forEach(function(ti) { total += ti.parsed.y; }); return 'Net P/L: ' + formatRupiah(total); } } }
                    } 
                } 
            });

            if (winRateChartInstance) winRateChartInstance.destroy();
            winRateChartInstance = new Chart(document.getElementById('winRateChart').getContext('2d'), { 
                type: 'doughnut', 
                data: { labels: ['Win', 'Loss'], datasets: [{ data: [winCount, lossCount], backgroundColor: ['#00e676', '#ff1744'], borderWidth: 0 }] }, 
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } 
            });
            
            let winPct = totalTrades > 0 ? Math.round((winCount / totalTrades) * 100) : 0;
            let lossPct = totalTrades > 0 ? 100 - winPct : 0;
            document.getElementById('win-rate-text').innerHTML = `<span style="font-size:1.5rem;">${winPct}% Win</span><span style="font-size:1.1rem; color:#ff1744;">${lossPct}% Loss</span>`;
        }
    }
    document.getElementById('dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderXAUDashboard(); }; document.getElementById('dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderXAUDashboard(); };
    
    function renderXAUTable() {
        let filtered = [...xauTableMaster]; const fType = document.getElementById('table-filter-select').value; const now = new Date();
        if (fType === 'all') { filtered = []; for (let d in journalData) { journalData[d].forEach(t => filtered.push({ rawDate: new Date(d), date: d, ...t, plVal: parseFloat(t.pl) })); } } else if (fType === 'today') { let tStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; filtered = filtered.filter(d => d.date === tStr); }
        const tbody = document.getElementById('dashboard-table-body'); tbody.innerHTML = filtered.length ? '' : `<tr><td colspan="8" style="text-align:center;">Tidak ada data.</td></tr>`;
        filtered.forEach((e, i) => {
            let layersCount = e.layers ? e.layers.length : 1;
            tbody.innerHTML += `<tr><td>${i+1}</td><td>${escHtml(e.date)}</td><td>${escHtml(e.tf||'-')}</td><td>${escHtml(e.arah||'-')}</td><td>${escHtml(e.duration||'-')}</td><td>${layersCount} L</td><td style="white-space: normal; line-height: 1.6; min-width: 250px;">${escHtml(e.alasan||'-')}</td><td align="right" class="${e.plVal>=0?'profit-text':'loss-text'}"><strong>${formatRupiah(e.plVal)}</strong></td></tr>`;
        });
    }

    // ==========================================
    // MODUL TRADING AI (SIMULASI PAPER TRADING)
    // ==========================================
    let currentAiDateStr = null; let calWidgetLoaded = false;
    let aiChart = null, aiCandleSeries = null, aiPriceLines = [];
    let aiTickInterval = null; let lastAiCandles = null;
    let aiTimeframe = '1h'; // default H1 biar out-of-the-box pakai data MT5 real-time gratis (gak butuh API key TwelveData)
    let aiLiveCandlesMt5 = null; let aiLiveCandlesMt5UpdatedAt = null; // candle terkini dari bot VPS/MT5, disinkron lewat appData/public
    const AI_LIVE_PRICE_MAX_AGE_SECONDS = 45; // dinaikin dari 30 - kasih buffer biar gak sempet kelihatan "stale" pas mepet siklus push ~30 detik dari bot

    // 1 pip = 0.1 harga (konsisten sama perhitungan "Pips" di Jurnal XAUUSD manual). Lot 0.1 Cent Exness: 1 pip = 1 USC (dari contoh broker user).
    const AI_PIP_SIZE = 0.1;
    let AI_LOT_SIZE = 0.1;
    let AI_PIP_VALUE_UNIT = 'cent'; // 'cent' | 'usd' - satuan AI_PIP_VALUE_PER_LOT
    let AI_PIP_VALUE_PER_LOT = 1; // nilai 1 pip pada lot referensi 0.1, dalam AI_PIP_VALUE_UNIT
    function pipToPrice(pips) { return pips * AI_PIP_SIZE; }
    function calcLayerPlUsc(pips, lot) { return pips * ((lot ?? AI_LOT_SIZE) / 0.1) * AI_PIP_VALUE_PER_LOT; }
    // Nama fungsi dipertahankan "usc" apa adanya (dipanggil di banyak tempat) - sekarang unit-aware lewat AI_PIP_VALUE_UNIT.
    function uscToRupiah(usc) { const usd = AI_PIP_VALUE_UNIT === 'usd' ? usc : usc / 100; return usd * liveKursIDR; }

    function getAiSettings() {
        return aiSettings;
    }

    document.getElementById('btn-ai-settings').onclick = () => {
        const s = getAiSettings();
        document.getElementById('ai-key-twelvedata').value = s.twelvedata;
        document.getElementById('ai-llm-provider').value = s.llmProvider;
        document.getElementById('ai-key-llm').value = s.llmKey;
        document.getElementById('ai-settings-modal').style.display = 'flex';
    };
    document.getElementById('btn-save-ai-settings').onclick = () => {
        aiSettings = {
            twelvedata: document.getElementById('ai-key-twelvedata').value.trim(),
            llmProvider: document.getElementById('ai-llm-provider').value,
            llmKey: document.getElementById('ai-key-llm').value.trim()
        };
        saveData('ai_settings_v1', aiSettings);
        document.getElementById('ai-settings-modal').style.display = 'none';
        alert(auth.currentUser ? 'Settings tersimpan & disinkronkan ke akun kamu — otomatis kepakai juga di device lain.' : 'Settings tersimpan di device ini (login dulu biar bisa sync ke device lain).');
    };

    function loadEconomicCalendarWidget() {
        if (calWidgetLoaded) return; calWidgetLoaded = true;
        const calScript = document.createElement('script');
        calScript.src = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
        calScript.async = true;
        calScript.innerHTML = JSON.stringify({ colorTheme: 'dark', isTransparent: false, width: '100%', height: '100%', locale: 'id', importanceFilter: '-1,0,1', countryFilter: 'us,eu,gb,jp,cn,au' });
        document.getElementById('tv-calendar-container').appendChild(calScript);
    }

    function ensureLightweightChartsLoaded(callback) {
        if (window.LightweightCharts) { callback(); return; }
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
        script.onload = callback;
        document.head.appendChild(script);
    }

    function clearAiPriceLines() {
        if (!aiCandleSeries) return;
        aiPriceLines.forEach(line => aiCandleSeries.removePriceLine(line));
        aiPriceLines = [];
    }

    function updateTradeLines(trade) {
        clearAiPriceLines();
        if (!trade.layers) return;
        aiPriceLines.push(aiCandleSeries.createPriceLine({ price: parseFloat(trade.entry), color: '#ffd700', lineWidth: 1, lineStyle: 2, title: 'Entry' }));
        trade.layers.forEach((ly, i) => {
            if (ly.status === 'pending') {
                aiPriceLines.push(aiCandleSeries.createPriceLine({ price: parseFloat(ly.entry), color: '#888', lineWidth: 1, lineStyle: 3, title: `Pending${i + 1}` }));
                return;
            }
            if (ly.status !== 'open') return;
            aiPriceLines.push(aiCandleSeries.createPriceLine({ price: parseFloat(ly.tp), color: '#00e676', lineWidth: 1, lineStyle: 2, title: `TP${i + 1}` }));
            const slPrice = ly.sl !== undefined ? ly.sl : trade.sl;
            aiPriceLines.push(aiCandleSeries.createPriceLine({ price: parseFloat(slPrice), color: ly.slMoved ? '#2196f3' : '#ff1744', lineWidth: 1, lineStyle: 2, title: ly.slMoved ? `BE${i + 1}` : `SL${i + 1}` }));
        });
    }

    function renderLightweightChart(candles) {
        ensureLightweightChartsLoaded(() => {
            const container = document.getElementById('lw-chart-container');
            if (!aiChart) {
                aiChart = LightweightCharts.createChart(container, {
                    width: container.clientWidth, height: 500,
                    layout: { background: { color: '#1e1e1e' }, textColor: '#ccc' },
                    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
                    timeScale: { timeVisible: true }
                });
                applyChartTheme();
                aiCandleSeries = aiChart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff1744', borderVisible: false, wickUpColor: '#00e676', wickDownColor: '#ff1744' });
                window.addEventListener('resize', () => { if (aiChart) aiChart.applyOptions({ width: container.clientWidth }); });
            }
            aiCandleSeries.setData(candles.map(c => ({ time: Math.floor(new Date(c.time).getTime() / 1000), open: c.open, high: c.high, low: c.low, close: c.close })));
            const openInfo = findOpenAiTrade(AI_METHOD_GROUPS.method1);
            if (openInfo) updateTradeLines(openInfo.trade); else clearAiPriceLines();
            updateTrendSummary();
        });
    }

    // Satu-satunya tempat yang nulis ke kotak "Harga Sekarang" - dipanggil tiap ada tick baru (~10 detik) DAN dari updateLiveStatsBoxes,
    // biar gak ada 2 sumber logic yang bisa nyimpang kayak sebelumnya (kotak vs chart beda angka).
    function updateLivePriceBox(candles) {
        const priceEl = document.getElementById('ai-live-price');
        if (!priceEl) return;
        const liveAgeSec = aiLivePriceMt5UpdatedAt ? (Date.now() - new Date(aiLivePriceMt5UpdatedAt).getTime()) / 1000 : Infinity;
        const c = candles || lastAiCandles;
        if (aiLivePriceMt5 && liveAgeSec <= AI_LIVE_PRICE_MAX_AGE_SECONDS) priceEl.innerText = parseFloat(aiLivePriceMt5).toFixed(2);
        else if (c && c.length) priceEl.innerText = c[c.length - 1].close.toFixed(2);
    }

    // Summary Trend/RSI/MACD di tab Live Market - reuse persis fungsi hitung yang sama dipakai bot buat nentuin sinyal
    // (calcSMA/calcRSI/calcMACD), jadi ini literally "apa yang bot lihat sekarang", bukan indikator terpisah.
    function updateTrendSummary() {
        const trendEl = document.getElementById('ai-trend-summary-trend');
        if (!trendEl || !lastAiCandles || lastAiCandles.length < 35) return;
        const rsiEl = document.getElementById('ai-trend-summary-rsi');
        const macdEl = document.getElementById('ai-trend-summary-macd');
        const closes = lastAiCandles.map(c => c.close);
        const ma20 = calcSMA(closes, 20), ma50 = calcSMA(closes, 50), rsi = calcRSI(closes, 14), macd = calcMACD(closes);
        if (ma20 !== null && ma50 !== null) {
            const up = ma20 > ma50;
            trendEl.innerHTML = up ? 'Naik' : 'Turun';
            trendEl.className = up ? 'profit-text' : 'loss-text';
        }
        if (rsi !== null) {
            const extreme = rsi >= 70 || rsi <= 30;
            const zone = rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : 'Netral';
            rsiEl.innerHTML = `${rsi.toFixed(1)} <span style="font-size:0.6em;">(${zone})</span>`;
            rsiEl.className = extreme ? '' : 'netral';
            rsiEl.style.color = extreme ? '#ff9800' : '';
        }
        if (macd) {
            const bullish = macd.macd > macd.signal;
            macdEl.innerHTML = bullish ? 'Bullish' : 'Bearish';
            macdEl.className = bullish ? 'profit-text' : 'loss-text';
        }
    }

    // "Napasin" candle terakhir pakai harga tick live (update tiap ~10 detik dari bot, gratis - gak nambah write Firestore
    // kayak kalau full candle array di-push lebih sering). Cuma jalan kalau chart lagi nampilin candle MT5 (bukan TwelveData historis).
    function updateLastCandleWithLivePrice() {
        if (aiTimeframe !== '1h') return; // efek ini cuma valid buat candle H1 asli dari MT5, bukan hasil TwelveData timeframe lain
        if (!aiCandleSeries || !lastAiCandles || !lastAiCandles.length || !aiLivePriceMt5) return;
        if (document.getElementById('ai-view-market').style.display === 'none') return;
        const ageMinutes = aiLiveCandlesMt5UpdatedAt ? (Date.now() - new Date(aiLiveCandlesMt5UpdatedAt).getTime()) / 60000 : Infinity;
        if (ageMinutes > AI_MT5_DATA_MAX_AGE_MINUTES) return;
        const lastCandle = lastAiCandles[lastAiCandles.length - 1];
        const price = parseFloat(aiLivePriceMt5);
        const high = Math.max(lastCandle.high, price), low = Math.min(lastCandle.low, price);
        aiCandleSeries.update({ time: Math.floor(new Date(lastCandle.time).getTime() / 1000), open: lastCandle.open, high, low, close: price });
        lastAiCandles[lastAiCandles.length - 1] = { ...lastCandle, high, low, close: price };
    }

    function switchAiTab(activeMenuId, activeViewId) {
        ['ai-menu-market', 'ai-menu-calendar', 'ai-menu-dashboard', 'ai-menu-log'].forEach(id => document.getElementById(id).classList.toggle('active', id === activeMenuId));
        ['ai-view-market', 'ai-view-calendar', 'ai-view-dashboard', 'ai-view-log'].forEach(id => document.getElementById(id).style.display = id === activeViewId ? 'block' : 'none');
    }
    document.getElementById('ai-menu-market').addEventListener('click', function() {
        switchAiTab('ai-menu-market', 'ai-view-market');
        loadEconomicCalendarWidget();
        if (lastAiCandles) renderLightweightChart(lastAiCandles);
    });
    document.getElementById('btn-ai-refresh-market').addEventListener('click', function() {
        this.disabled = true; this.innerText = '⏳ Refresh...';
        aiDisplayTick().finally(() => { this.disabled = false; this.innerText = '🔃 Refresh'; });
    });
    document.getElementById('ai-menu-calendar').addEventListener('click', function() {
        switchAiTab('ai-menu-calendar', 'ai-view-calendar');
        renderAiCalendar();
    });
    document.getElementById('ai-menu-dashboard').addEventListener('click', function() {
        switchAiTab('ai-menu-dashboard', 'ai-view-dashboard');
        renderAiDashboard();
    });
    document.getElementById('ai-menu-log').addEventListener('click', function() {
        switchAiTab('ai-menu-log', 'ai-view-log');
        renderAiLog();
    });

    document.getElementById('ai-modal-box').onclick = () => {
        const val = prompt('Masukkan modal simulasi baru (Rp):', aiModalAwal);
        if (val === null) return;
        const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        if (isNaN(num) || num <= 0) { alert('Angka gak valid.'); return; }
        const todayStr = new Date().toISOString().slice(0, 10);
        const resetVal = prompt('Modal ini berlaku efektif mulai tanggal berapa? Histori SEBELUM tanggal ini tetap kesimpen & bisa dilihat lagi (Equity-nya pun tetap kebaca pakai modal LAMA), cuma gak ikut dihitung ke Equity Awal/Akhir mulai tanggal ini (kayak buka akun baru).\n\nKosongin isinya kalau mau modal berlaku retroaktif ke semua histori (perilaku lama). Format: YYYY-MM-DD', aiModalResetAt || todayStr);
        let newResetAt = aiModalResetAt, newBeforeReset = aiModalBeforeReset;
        if (resetVal !== null) {
            newResetAt = resetVal.trim() || null;
            if (newResetAt) {
                // Tanya EKSPLISIT (bukan nebak dari state lama) - modal aiModalAwal saat ini bisa aja
                // udah kepakai/keubah sebelumnya, jadi gak selalu representasi modal lama yang bener.
                const beforeVal = prompt(`Modal yang BERLAKU SEBELUM ${newResetAt} (dipakai biar bulan-bulan lama tetap kebaca akurat pas di-browse ulang):`, aiModalBeforeReset || aiModalAwal);
                const beforeNum = beforeVal !== null ? parseFloat(String(beforeVal).replace(/[^0-9.]/g, '')) : NaN;
                newBeforeReset = !isNaN(beforeNum) && beforeNum > 0 ? beforeNum : (aiModalBeforeReset || aiModalAwal);
            } else {
                newBeforeReset = null;
            }
        }
        aiModalAwal = num;
        aiModalResetAt = newResetAt;
        aiModalBeforeReset = newBeforeReset;
        saveData('ai_modal_awal', aiModalAwal);
        saveData('ai_modal_reset_at', aiModalResetAt);
        saveData('ai_modal_before_reset', aiModalBeforeReset);
        document.getElementById('ai-base-equity').innerText = formatRupiah(aiModalAwal);
        updateAiEquity(globalNavDate.getFullYear(), globalNavDate.getMonth());
    };

    // --- Kalkulasi indikator teknikal (murni JS, gratis) ---
    function calcSMA(closes, period) {
        if (closes.length < period) return null;
        return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
    }
    function calcRSI(closes, period = 14) {
        if (closes.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / period, avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + (avgGain / avgLoss)));
    }
    function calcEMASeries(values, period) {
        const k = 2 / (period + 1);
        let series = [values[0]];
        for (let i = 1; i < values.length; i++) series.push(values[i] * k + series[i - 1] * (1 - k));
        return series;
    }
    function calcMACD(closes) {
        if (closes.length < 35) return null;
        const ema12 = calcEMASeries(closes, 12); const ema26 = calcEMASeries(closes, 26);
        const macdLine = ema12.map((v, i) => v - ema26[i]);
        const signalLine = calcEMASeries(macdLine, 9);
        return { macd: macdLine[macdLine.length - 1], signal: signalLine[signalLine.length - 1] };
    }
    function calcBollinger(closes, period = 20, mult = 2) {
        if (closes.length < period) return null;
        const slice = closes.slice(-period);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
        const stdev = Math.sqrt(variance);
        return { upper: mean + mult * stdev, lower: mean - mult * stdev, mid: mean };
    }
    // Average True Range - dipakai indikator preview tab Market
    function calcATR(candles, period = 14) {
        if (candles.length < period + 1) return null;
        const trs = [];
        for (let i = candles.length - period; i < candles.length; i++) {
            const c = candles[i], prevClose = candles[i - 1].close;
            trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
        }
        return trs.reduce((a, b) => a + b, 0) / period;
    }

    const AI_MT5_DATA_MAX_AGE_MINUTES = 10;
    async function fetchAiPriceData() {
        const tfSelect = document.getElementById('ai-timeframe-select');
        // MT5 (gratis, real-time) cuma dipakai kalau user emang lagi milih H1 - timeframe lain (M5/M15/dst) selalu lewat TwelveData,
        // dropdown TETAP bisa diganti bebas kapan pun (gak di-disable kayak sebelumnya).
        if (aiTimeframe === '1h' && aiLiveCandlesMt5 && aiLiveCandlesMt5UpdatedAt) {
            const ageMinutes = (Date.now() - new Date(aiLiveCandlesMt5UpdatedAt).getTime()) / 60000;
            if (ageMinutes <= AI_MT5_DATA_MAX_AGE_MINUTES) {
                tfSelect.title = 'H1 pakai data real-time dari MT5 (gratis). Timeframe lain otomatis pakai TwelveData.';
                return aiLiveCandlesMt5;
            }
        }
        tfSelect.title = '';
        const key = getAiSettings().twelvedata;
        if (!key) { alert('Isi dulu API Key TwelveData di ⚙️ Settings.'); return null; }
        try {
            const res = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${aiTimeframe}&outputsize=100&timezone=UTC&apikey=${key}`);
            const data = await res.json();
            if (data.status === 'error' || !data.values) { alert('Gagal ambil data harga: ' + (data.message || 'unknown error')); return null; }
            return data.values.reverse().map(v => ({ time: v.datetime.replace(' ', 'T') + 'Z', open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }));
        } catch (err) { console.error(err); alert('Gagal konek ke TwelveData: ' + err.message); return null; }
    }

    document.getElementById('ai-timeframe-select').addEventListener('change', function () {
        aiTimeframe = this.value;
        aiDisplayTick();
    });

    async function callLLM(prompt_, settings, maxTokens = 300) {
        try {
            if (settings.llmProvider === 'gemini') {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${settings.llmKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt_ }] }] }) });
                const data = await res.json();
                return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            } else if (settings.llmProvider === 'claude') {
                const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': settings.llmKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt_ }] }) });
                const data = await res.json();
                return data?.content?.[0]?.text || null;
            }
        } catch (err) { console.error('Panggilan LLM gagal:', err); return null; }
        return null;
    }

    async function polishReasonWithLLM(rawReason, settings) {
        const prompt_ = `Tuliskan ulang analisa trading berikut jadi lebih natural dan enak dibaca dalam Bahasa Indonesia, TANPA mengubah angka atau menambah fakta baru:\n\n${rawReason}`;
        return callLLM(prompt_, settings, 300);
    }

    // Shared antara renderAiDashboard/renderCurDashboard (stat box per jenis sinyal) & buildEvalRecommendationPrompt
    // di bawah - dulu ada 2 copy identik (signalLabels lokal di renderAiDashboard + CUR_SIGNAL_LABELS), disatukan.
    const SIGNAL_TYPE_LABELS = { rsi_reversal: 'RSI Reversal', trend_following: 'Trend-Following', ict_liquidity_sweep: 'ICT Liquidity Sweep', lainnya: 'Lainnya' };

    // Rekomendasi AI di Dashboard Evaluasi - reuse callLLM() di atas, prompt dari agregat statistik
    // (bukan dump semua trade satu-satu) dan sengaja diminta cuma observasi pola + saran, BUKAN sinyal
    // entry baru (itu tugas bot, bukan tugas fitur ini).
    function buildEvalRecommendationPrompt(stats, label) {
        const signalLines = Object.entries(stats.signalStats || {}).map(([type, s]) => {
            const wr = s.total > 0 ? ((s.win / s.total) * 100).toFixed(0) : '-';
            return `- ${SIGNAL_TYPE_LABELS[type] || type}: ${s.total} entry, win rate ${wr}%`;
        }).join('\n') || '(belum ada entry closed bulan ini)';
        const weeklyLines = (stats.weeklyReports || []).map((w, i) => w.hasData ? `- Minggu ${i + 1}: ${w.wins} win / ${w.losses} loss, hasil ${formatRupiah(w.pl)}` : null).filter(Boolean).join('\n') || '(belum ada data mingguan)';
        return `Kamu analis trading yang mereview data BULANAN dari bot trading simulasi (shadow trading, belum uang real) buat instrumen ${label}. Data agregat bulan ini:\n\n` +
            `Total entry: ${stats.totalEntries} (${stats.closedCount} closed, win rate ${stats.winRate}%)\n` +
            `P/L bulan ini: ${formatRupiah(stats.monthPl)}\n` +
            `Risk budget terpakai: ${stats.usedPct}% dari limit ${stats.riskLimitPct}%/${stats.riskPeriodLabel}\n\n` +
            `Breakdown per jenis sinyal:\n${signalLines}\n\n` +
            `Breakdown mingguan:\n${weeklyLines}\n\n` +
            `Biggest win: ${formatRupiah(stats.maxWin.pl)} (${stats.maxWin.detail})\n` +
            `Biggest loss: ${formatRupiah(stats.maxLoss.pl)} (${stats.maxLoss.detail})\n\n` +
            `Tulis dalam Bahasa Indonesia santai: (1) 1-2 kalimat ringkasan pola bulan ini, (2) 1-3 saran actionable ` +
            `berdasarkan data di atas (misal jenis sinyal mana yang lemah, apakah risk usage sehat). JANGAN kasih sinyal ` +
            `beli/jual baru atau rekomendasi entry spesifik - fokus cuma ke observasi & evaluasi dari data yang ada.`;
    }

    // Cap harian (di localStorage, BUKAN Firestore - gak nyentuh kuota database) buat jaga-jaga jangan
    // sampai kepakai berlebihan & kena billing berbayar di akun LLM sendiri. Shared Gold+Currency karena
    // sama-sama pakai 1 API key yang sama, biayanya nempel ke akun yang sama juga.
    const LLM_RECOMMEND_DAILY_LIMIT = 3;
    function getLlmRecommendQuota() {
        const today = new Date().toISOString().slice(0, 10);
        let q = JSON.parse(localStorage.getItem('llm_recommend_quota') || 'null');
        if (!q || q.date !== today) q = { date: today, count: 0 };
        return q;
    }

    async function requestEvalRecommendation(stats, label, boxElId, btnEl) {
        const box = document.getElementById(boxElId);
        const settings = getAiSettings();
        if (settings.llmProvider === 'none' || !settings.llmKey) {
            box.innerHTML = `<div class="insight-box insight-warning">Isi dulu API Key LLM (Gemini/Claude) di ⚙️ Settings Trading AI buat pakai fitur ini.</div>`;
            return;
        }
        const quota = getLlmRecommendQuota();
        if (quota.count >= LLM_RECOMMEND_DAILY_LIMIT) {
            box.innerHTML = `<div class="insight-box insight-warning">Udah dipakai ${LLM_RECOMMEND_DAILY_LIMIT}x hari ini (batas harian biar gak kena biaya berlebih) - coba lagi besok.</div>`;
            return;
        }
        btnEl.disabled = true; const origText = btnEl.innerText; btnEl.innerText = '⏳ Menganalisa...';
        box.innerHTML = '';
        try {
            quota.count++;
            localStorage.setItem('llm_recommend_quota', JSON.stringify(quota));
            const prompt_ = buildEvalRecommendationPrompt(stats, label);
            const result = await callLLM(prompt_, settings, 600);
            box.innerHTML = result
                ? `<div class="insight-box" style="border-left-color:#00bcd4;">🤖 ${result.replace(/\n/g, '<br>')}</div>`
                : `<div class="insight-box insight-warning">Gagal dapet respon dari LLM, coba lagi.</div>`;
        } catch (err) {
            box.innerHTML = `<div class="insight-box insight-warning">Error: ${err.message}</div>`;
        } finally {
            btnEl.disabled = false; btnEl.innerText = origText;
        }
    }

    // Method 1 (trend_following/rsi_reversal) & Method 2 (ICT) masing2 punya slot posisi terbuka sendiri -
    // dashboard butuh nunjukin keduanya independen, jadi findOpenAiTrade sekarang bisa difilter per grup.
    const AI_METHOD_GROUPS = {
        method1: new Set(['trend_following', 'rsi_reversal']),
        method2: new Set(['ict_liquidity_sweep']),
    };
    function findOpenAiTrade(signalTypes) {
        for (const d in aiTradeData) {
            const list = aiTradeData[d];
            for (let i = 0; i < list.length; i++) {
                if (list[i].status === 'open' && (!signalTypes || signalTypes.has(list[i].signalType))) return { dateKey: d, index: i, trade: list[i] };
            }
        }
        return null;
    }

    const AI_MASTER_DEFAULTS = {
        slPips: 50, slMode: 'fixed', atrMultiplier: 1.5, tpLayerPips: [80, 100, 150], lotSize: 0.1, layerStaggerPips: 10,
        lockPipsAfterTp1: 10, deepLockTriggerPips: 100, deepLockPips: 80, deepLockTimeoutMinutes: 15,
        // winrateMinSamples dinaikkan 5->10 (2026-07-16, dari evaluasi AI lain) - n=5 kena noise statistik,
        // tapi gak dinaikin ke 20-30 biar pair Currency yg jarang entry gak bikin filter ini mati total.
        minSignalWinrate: 35, winrateLookbackDays: 14, winrateMinSamples: 10,
        newsPreMinutes: 10, newsPostMinutes: 40,
        riskLimitPct: 10, riskPeriod: 'monthly',
        pipValueUnit: 'cent', pipValuePerLot: 1,
        tpMode: 'fixed',
        // L3 TP adaptif ATR - opt-in per instrumen, field TERPISAH dari tpMode (2026-07-16). Cuma nimpa
        // target TP Layer 3, dihitung & dieksekusi di bot VPS (ai_trading_core.py), browser cuma nyimpen setting.
        l3TpAtrMode: false, l3TpAtrMultiplier: 0.6,
        // Lot menyesuaikan kalau SL lebar (terutama Metode 2/ICT, SL structural bisa jauh lebih lebar dari
        // clamp ATR Metode 1) - dihitung & dieksekusi di bot VPS, browser cuma nyimpen setting.
        lotScaleThreshold1Pips: 150, lotScaleLot1: 0.05, lotScaleThreshold2Pips: 250, lotScaleLot2: 0.03,
        lotScaleThreshold3Pips: 500, lotScaleLot3: 0.02,
        summaryIntervalHours: 6,
        methodTwoEnabled: false
    };
    // Metode 2 (ICT) cuma dihitung & dieksekusi di bot VPS (ai-tick.py) - flag ini di browser cuma buat show/hide section dashboard-nya.
    let AI_METHOD_TWO_ENABLED = false;
    function getMasterSettings() {
        return Object.assign({}, AI_MASTER_DEFAULTS, (aiSettings && aiSettings.master) || {});
    }
    function applyMasterSettings() {
        const m = getMasterSettings();
        AI_LOT_SIZE = m.lotSize;
        AI_PIP_VALUE_UNIT = m.pipValueUnit === 'usd' ? 'usd' : 'cent';
        AI_PIP_VALUE_PER_LOT = m.pipValuePerLot;
        AI_METHOD_TWO_ENABLED = !!m.methodTwoEnabled;
        const m2Section = document.getElementById('ai-method2-section');
        if (m2Section) m2Section.style.display = AI_METHOD_TWO_ENABLED ? '' : 'none';
    }
    applyMasterSettings();

    // Dropdown "⚙️ Lainnya" - kumpulin tombol admin/jarang dipakai biar header gak numpuk.
    document.getElementById('btn-ai-more-menu').onclick = (e) => {
        e.stopPropagation();
        document.getElementById('ai-more-menu-dropdown').classList.toggle('open');
    };
    document.addEventListener('click', (e) => {
        const dd = document.getElementById('ai-more-menu-dropdown');
        if (dd && dd.classList.contains('open') && !dd.contains(e.target) && e.target.id !== 'btn-ai-more-menu') {
            dd.classList.remove('open');
        }
    });

    document.getElementById('btn-ai-master-settings').onclick = () => {
        const m = getMasterSettings();
        document.getElementById('ai-master-risk-limit-pct').value = m.riskLimitPct;
        document.getElementById('ai-master-risk-period').value = m.riskPeriod;
        document.getElementById('ai-master-sl-pips').value = m.slPips;
        document.getElementById('ai-master-sl-mode').value = m.slMode;
        document.getElementById('ai-master-atr-multiplier').value = m.atrMultiplier;
        document.getElementById('ai-master-tp-mode').value = m.tpMode;
        document.getElementById('ai-master-tp1-pips').value = m.tpLayerPips[0];
        document.getElementById('ai-master-tp2-pips').value = m.tpLayerPips[1];
        document.getElementById('ai-master-tp3-pips').value = m.tpLayerPips[2];
        document.getElementById('ai-master-l3-tp-atr-mode').value = m.l3TpAtrMode ? 'on' : 'off';
        document.getElementById('ai-master-l3-tp-atr-multiplier').value = m.l3TpAtrMultiplier;
        document.getElementById('ai-master-pip-value-unit').value = m.pipValueUnit;
        document.getElementById('ai-master-pip-value-per-lot').value = m.pipValuePerLot;
        document.getElementById('ai-master-lot-size').value = m.lotSize;
        document.getElementById('ai-master-lot-scale-threshold1').value = m.lotScaleThreshold1Pips;
        document.getElementById('ai-master-lot-scale-lot1').value = m.lotScaleLot1;
        document.getElementById('ai-master-lot-scale-threshold2').value = m.lotScaleThreshold2Pips;
        document.getElementById('ai-master-lot-scale-lot2').value = m.lotScaleLot2;
        document.getElementById('ai-master-lot-scale-threshold3').value = m.lotScaleThreshold3Pips;
        document.getElementById('ai-master-lot-scale-lot3').value = m.lotScaleLot3;
        document.getElementById('ai-master-layer-stagger-pips').value = m.layerStaggerPips;
        document.getElementById('ai-master-lock-pips-after-tp1').value = m.lockPipsAfterTp1;
        document.getElementById('ai-master-deep-lock-trigger-pips').value = m.deepLockTriggerPips;
        document.getElementById('ai-master-deep-lock-pips').value = m.deepLockPips;
        document.getElementById('ai-master-deep-lock-timeout-minutes').value = m.deepLockTimeoutMinutes;
        document.getElementById('ai-master-min-signal-winrate').value = m.minSignalWinrate;
        document.getElementById('ai-master-winrate-lookback-days').value = m.winrateLookbackDays;
        document.getElementById('ai-master-winrate-min-samples').value = m.winrateMinSamples;
        document.getElementById('ai-master-news-pre-minutes').value = m.newsPreMinutes;
        document.getElementById('ai-master-news-post-minutes').value = m.newsPostMinutes;
        document.getElementById('ai-master-summary-interval-hours').value = m.summaryIntervalHours;
        document.getElementById('ai-master-method-two-enabled').value = m.methodTwoEnabled ? 'on' : 'off';
        document.getElementById('ai-master-modal').style.display = 'flex';
        updateAiMasterPreview();
    };

    function updateAiMasterPreview() {
        const readNum = (id) => parseFloat(document.getElementById(id).value);
        const lot = readNum('ai-master-lot-size');
        const slPips = readNum('ai-master-sl-pips');
        const tp1 = readNum('ai-master-tp1-pips'), tp2 = readNum('ai-master-tp2-pips'), tp3 = readNum('ai-master-tp3-pips');
        const unit = document.getElementById('ai-master-pip-value-unit').value;
        const pipValue = readNum('ai-master-pip-value-per-lot');
        const el = document.getElementById('ai-master-pl-preview');
        if ([lot, slPips, tp1, tp2, tp3, pipValue].some(v => isNaN(v) || v <= 0)) { el.innerHTML = '<span style="color:#888;">Isi semua field lot/SL/TP/nilai-pip dulu buat lihat preview.</span>'; return; }
        const toRp = (pips) => { const amount = pips * (lot / 0.1) * pipValue; const usd = unit === 'usd' ? amount : amount / 100; return usd * liveKursIDR; };
        el.innerHTML = `Preview nilai (lot ${lot}, kurs saat ini):<br>` +
            `SL &nbsp;&nbsp;&nbsp;: <span class="loss-text">-${formatRupiah(toRp(slPips))}</span><br>` +
            `TP L1 : <span class="profit-text">+${formatRupiah(toRp(tp1))}</span><br>` +
            `TP L2 : <span class="profit-text">+${formatRupiah(toRp(tp2))}</span><br>` +
            `TP L3 : <span class="profit-text">+${formatRupiah(toRp(tp3))}</span>`;
    }
    ['ai-master-lot-size', 'ai-master-sl-pips', 'ai-master-tp1-pips', 'ai-master-tp2-pips', 'ai-master-tp3-pips', 'ai-master-pip-value-per-lot'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateAiMasterPreview);
    });
    document.getElementById('ai-master-pip-value-unit').addEventListener('change', updateAiMasterPreview);
    document.getElementById('btn-reset-ai-master').onclick = () => {
        aiSettings = Object.assign({}, aiSettings, { master: Object.assign({}, AI_MASTER_DEFAULTS) });
        saveData('ai_settings_v1', aiSettings);
        applyMasterSettings();
        document.getElementById('ai-master-modal').style.display = 'none';
        alert('Master Setting dikembalikan ke default.');
    };
    document.getElementById('btn-save-ai-master').onclick = () => {
        const readNum = (id) => parseFloat(document.getElementById(id).value);
        const fields = {
            riskLimitPct: readNum('ai-master-risk-limit-pct'),
            slPips: readNum('ai-master-sl-pips'),
            atrMultiplier: readNum('ai-master-atr-multiplier'),
            tp1: readNum('ai-master-tp1-pips'), tp2: readNum('ai-master-tp2-pips'), tp3: readNum('ai-master-tp3-pips'),
            l3TpAtrMultiplier: readNum('ai-master-l3-tp-atr-multiplier'),
            pipValuePerLot: readNum('ai-master-pip-value-per-lot'),
            lotSize: readNum('ai-master-lot-size'),
            lotScaleThreshold1Pips: readNum('ai-master-lot-scale-threshold1'),
            lotScaleLot1: readNum('ai-master-lot-scale-lot1'),
            lotScaleThreshold2Pips: readNum('ai-master-lot-scale-threshold2'),
            lotScaleLot2: readNum('ai-master-lot-scale-lot2'),
            lotScaleThreshold3Pips: readNum('ai-master-lot-scale-threshold3'),
            lotScaleLot3: readNum('ai-master-lot-scale-lot3'),
            layerStaggerPips: readNum('ai-master-layer-stagger-pips'),
            lockPipsAfterTp1: readNum('ai-master-lock-pips-after-tp1'),
            deepLockTriggerPips: readNum('ai-master-deep-lock-trigger-pips'),
            deepLockPips: readNum('ai-master-deep-lock-pips'),
            deepLockTimeoutMinutes: readNum('ai-master-deep-lock-timeout-minutes'),
            minSignalWinrate: readNum('ai-master-min-signal-winrate'),
            winrateLookbackDays: readNum('ai-master-winrate-lookback-days'),
            winrateMinSamples: readNum('ai-master-winrate-min-samples'),
            newsPreMinutes: readNum('ai-master-news-pre-minutes'),
            newsPostMinutes: readNum('ai-master-news-post-minutes'),
            summaryIntervalHours: readNum('ai-master-summary-interval-hours')
        };
        const allValid = Object.values(fields).every(v => !isNaN(v) && v >= 0) && fields.slPips > 0 && fields.atrMultiplier > 0 && fields.lotSize > 0 && fields.layerStaggerPips > 0 && fields.deepLockTriggerPips > 0 && fields.winrateLookbackDays > 0 && fields.winrateMinSamples > 0 && fields.tp1 > 0 && fields.tp2 > 0 && fields.tp3 > 0 && fields.riskLimitPct > 0 && fields.pipValuePerLot > 0 && fields.summaryIntervalHours > 0 && fields.l3TpAtrMultiplier > 0 && fields.lotScaleThreshold1Pips > 0 && fields.lotScaleLot1 > 0 && fields.lotScaleThreshold2Pips > fields.lotScaleThreshold1Pips && fields.lotScaleLot2 > 0 && fields.lotScaleThreshold3Pips > fields.lotScaleThreshold2Pips && fields.lotScaleLot3 > 0;
        if (!allValid) { alert('Ada input yang kosong/gak valid. Semua field harus angka positif (kecuali beberapa yang boleh 0), dan tiap Threshold lot menyesuaikan harus lebih besar dari Threshold sebelumnya.'); return; }
        aiSettings = Object.assign({}, aiSettings, {
            master: {
                riskLimitPct: fields.riskLimitPct,
                riskPeriod: document.getElementById('ai-master-risk-period').value,
                slPips: fields.slPips,
                slMode: document.getElementById('ai-master-sl-mode').value,
                atrMultiplier: fields.atrMultiplier,
                tpMode: document.getElementById('ai-master-tp-mode').value,
                tpLayerPips: [fields.tp1, fields.tp2, fields.tp3],
                l3TpAtrMode: document.getElementById('ai-master-l3-tp-atr-mode').value === 'on',
                l3TpAtrMultiplier: fields.l3TpAtrMultiplier,
                pipValueUnit: document.getElementById('ai-master-pip-value-unit').value,
                pipValuePerLot: fields.pipValuePerLot,
                lotSize: fields.lotSize,
                lotScaleThreshold1Pips: fields.lotScaleThreshold1Pips,
                lotScaleLot1: fields.lotScaleLot1,
                lotScaleThreshold2Pips: fields.lotScaleThreshold2Pips,
                lotScaleLot2: fields.lotScaleLot2,
                lotScaleThreshold3Pips: fields.lotScaleThreshold3Pips,
                lotScaleLot3: fields.lotScaleLot3,
                layerStaggerPips: fields.layerStaggerPips,
                lockPipsAfterTp1: fields.lockPipsAfterTp1,
                deepLockTriggerPips: fields.deepLockTriggerPips,
                deepLockPips: fields.deepLockPips,
                deepLockTimeoutMinutes: fields.deepLockTimeoutMinutes,
                minSignalWinrate: fields.minSignalWinrate,
                winrateLookbackDays: fields.winrateLookbackDays,
                winrateMinSamples: fields.winrateMinSamples,
                newsPreMinutes: fields.newsPreMinutes,
                newsPostMinutes: fields.newsPostMinutes,
                summaryIntervalHours: fields.summaryIntervalHours,
                methodTwoEnabled: document.getElementById('ai-master-method-two-enabled').value === 'on'
            }
        });
        saveData('ai_settings_v1', aiSettings);
        applyMasterSettings();
        document.getElementById('ai-master-modal').style.display = 'none';
        renderAiDashboard();
        alert(auth.currentUser ? 'Master Setting tersimpan & disinkronkan — otomatis kepakai bot VPS dalam ~10 detik.' : 'Master Setting tersimpan di device ini (login dulu biar sync ke bot VPS).');
    };

    // Kirim sinyal restart ke bot VPS lewat Firestore (botControl) - bot yang lagi jalan yang deteksi & eksekusi git pull + restart sendiri tiap fast-loop.
    // Kalau proses bot lagi mati total, sinyal ini nunggu doang sampai bot dinyalain manual lagi (gak ada yang baca kalau gak ada proses hidup).
    // Pakai spread (...botControl) - JANGAN replace total objeknya, biar field summaryRequested/lastSummaryAt dari fitur summary gak ke-wipe.
    document.getElementById('btn-ai-restart-bot').onclick = () => {
        if (!confirm('Restart bot VPS sekarang? Bot bakal ambil kode terbaru & jalan ulang otomatis dalam ~10 detik (cuma jalan kalau proses bot lagi hidup).')) return;
        botControl = { ...botControl, restartRequested: true, requestedAt: new Date().toISOString() };
        saveData('ai_bot_control_v1', botControl);
        alert('Sinyal restart terkirim. Cek tab Log Aktivitas dalam ~30 detik buat konfirmasi hasilnya.');
    };

    // Sama kayak restart, tapi buat trigger summary Telegram manual (4 pesan terpisah: posisi terbuka, hari ini, minggu ini, all-time).
    document.getElementById('btn-ai-send-summary').onclick = () => {
        if (!confirm('Kirim summary posisi & P/L ke Telegram sekarang?')) return;
        botControl = { ...botControl, summaryRequested: true, summaryRequestedAt: new Date().toISOString() };
        saveData('ai_bot_control_v1', botControl);
        alert('Sinyal summary terkirim. Cek Telegram dalam ~30 detik (cuma jalan kalau proses bot lagi hidup).');
    };

    function updateFloatingPl(openInfo, candles) {
        const trade = openInfo.trade;
        if (!trade.layers) return;
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let totalFloating = 0;
        const layerRows = trade.layers.map((ly, i) => {
            if (ly.status === 'pending') return `Layer ${i + 1} (TP ${ly.tpPips}p): <span class="netral">Menunggu entry di ${parseFloat(ly.entry).toFixed(2)}</span>`;
            if (ly.status !== 'open') { totalFloating += ly.pl; return `Layer ${i + 1} (TP ${ly.tpPips}p): <span class="${ly.pl >= 0 ? 'profit-text' : 'loss-text'}">${ly.status.toUpperCase()} ${ly.pl >= 0 ? '+' : ''}${formatRupiah(ly.pl)}</span>`; }
            const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
            const pipsMoved = ((lastClose - layerEntry) * dirSign) / AI_PIP_SIZE;
            const floatPl = uscToRupiah(calcLayerPlUsc(pipsMoved, ly.lot));
            totalFloating += floatPl;
            return `Layer ${i + 1} (TP ${ly.tpPips}p): <span class="${floatPl >= 0 ? 'profit-text' : 'loss-text'}">Floating ${floatPl >= 0 ? '+' : ''}${formatRupiah(floatPl)}</span>`;
        });
        const el = document.getElementById('ai-floating-pl');
        if (el) el.innerHTML = `<div class="insight-box ${totalFloating >= 0 ? 'insight-success' : 'insight-danger'}" style="flex-direction:column; align-items:flex-start; gap:6px;"><strong>${trade.arah} @ ${parseFloat(trade.entry).toFixed(2)} (Lot ${trade.layers[0].lot ?? AI_LOT_SIZE} × 3 Layer) — Total: ${totalFloating >= 0 ? '+' : ''}${formatRupiah(totalFloating)}</strong><div style="font-size:0.8rem; font-weight:normal; display:flex; flex-direction:column; gap:3px;">${layerRows.join('')}</div></div>`;
    }

    // Catat 1 entri log tiap kali bot "coba" jalan (buka tab Log Aktivitas buat lihat histori berhasil/nihil/gagal).
    function logAiTick(outcome, detail) {
        if (!auth.currentUser) return;
        db.collection('appData').doc(auth.currentUser.uid).collection('ai_tick_log').add({ time: new Date().toISOString(), outcome, detail: detail || '', source: 'browser' })
            .catch(err => console.error('Gagal simpan log tick:', err));
    }

    const AI_LOG_OUTCOME_LABEL = {
        entry_opened: { emoji: '✅', label: 'Entry Dibuka' }, position_updated: { emoji: '✅', label: 'Posisi Update' }, position_closed: { emoji: '✅', label: 'Posisi Selesai' }, news_close: { emoji: '✅', label: 'Ditutup (Berita)' }, emergency_close: { emoji: '🛑', label: 'Tutup Darurat' },
        waiting: { emoji: '⚪', label: 'Nunggu' }, no_signal: { emoji: '⚪', label: 'Gak Ada Sinyal' }, market_closed: { emoji: '⚪', label: 'Market Tutup' }, news_block: { emoji: '⚪', label: 'Ditahan (Berita)' },
        error: { emoji: '❌', label: 'Gagal' }, manual_reset: { emoji: '🗑️', label: 'Reset Manual' }
    };
    const AI_LOG_SUCCESS_SET = new Set(['entry_opened', 'position_updated', 'position_closed', 'news_close', 'emergency_close', 'restart']);
    const AI_LOG_FAIL_SET = new Set(['error']);
    function categorizeAiLog(outcome) { return (AI_LOG_SUCCESS_SET.has(outcome) || /^entry_opened/.test(outcome)) ? 'success' : AI_LOG_FAIL_SET.has(outcome) ? 'fail' : 'nihil'; }

    let aiLastLogs = [];
    let aiLogFilter = new Set(['success', 'nihil', 'fail']); // default semua kecentang, murni filter tampilan - gak pernah ubah query/limit 200 di atas

    document.getElementById('ai-log-limit').addEventListener('change', e => { aiLogLimit = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10); renderAiLogList(); });
    window.toggleAiLogFilter = function(category, btn) {
        if (aiLogFilter.has(category)) aiLogFilter.delete(category); else aiLogFilter.add(category);
        btn.classList.toggle('ai-log-filter-off', !aiLogFilter.has(category));
        renderAiLogList();
    };

    let aiLogLimit = 10; // default tampil 10 aktivitas terbaru
    function logRowHtml(l) {
        const pretty = (o) => { const x = String(o || '').replace(/_m2$/, ' (ICT)').replace(/_/g, ' ').trim(); return x.charAt(0).toUpperCase() + x.slice(1); };
        const meta = AI_LOG_OUTCOME_LABEL[l.outcome] || { label: pretty(l.outcome) };
        const cat = categorizeAiLog(l.outcome);
        const waktu = new Date(l.time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
        const src = String(l.source || '').startsWith('browser') ? 'browser' : 'server';
        return `<div class="log-row log-${cat}"><span class="log-dot"></span><div class="log-main"><div class="log-title">${escHtml(meta.label)}</div><div class="log-detail">${escHtml(l.detail || '-')}</div></div><div class="log-time">${waktu}<small>${src}</small></div></div>`;
    }
    function logSummaryHtml(s, n, f) {
        return `<div class="equity-box" style="border-left-color:#00e676;"><span class="label">Berhasil</span><h3>${s}</h3></div>
                <div class="equity-box" style="border-left-color:#888;"><span class="label">Nihil</span><h3>${n}</h3></div>
                <div class="equity-box" style="border-left-color:#ff1744;"><span class="label">Gagal</span><h3>${f}</h3></div>`;
    }
    function renderAiLogList() {
        const listEl = document.getElementById('ai-log-list');
        const filtered = aiLastLogs.filter(l => aiLogFilter.has(categorizeAiLog(l.outcome)));
        const shown = filtered.slice(0, aiLogLimit === 'all' ? filtered.length : aiLogLimit);
        listEl.innerHTML = shown.length ? shown.map(logRowHtml).join('') : '<p class="ec-empty">Tidak ada aktivitas yang cocok dengan filter ini.</p>';
        const info = document.getElementById('ai-log-count'); if (info) info.innerText = `${shown.length} dari ${filtered.length}`;
    }

    function renderAiLog() {
        if (!auth.currentUser) return Promise.resolve();
        // 5 bot Currency nulis ke subcollection ai_tick_log yang SAMA (source "server_<PAIR>") - ambil lebih
        // banyak dulu (500) baru filter Gold-only (source persis "browser"/"server"), biar 200 entry Gold
        // yang ditampilin gak ke-dilusi/ke-geser sama volume 5 pair lain.
        return db.collection('appData').doc(auth.currentUser.uid).collection('ai_tick_log').orderBy('time', 'desc').limit(500).get().then(snap => {
            const logs = snap.docs.map(d => d.data()).filter(l => l.source === 'browser' || l.source === 'server').slice(0, 200);
            aiLastLogs = logs;
            let success = 0, fail = 0, nihil = 0;
            logs.forEach(l => { const cat = categorizeAiLog(l.outcome); if (cat === 'success') success++; else if (cat === 'fail') fail++; else nihil++; });
            document.getElementById('ai-log-summary').innerHTML = logSummaryHtml(success, nihil, fail);
            renderAiLogList();
        }).catch(err => console.error('Gagal ambil log tick:', err));
    }

    function updateLiveStatsBoxes(openInfo, candles) {
        const entryEl = document.getElementById('ai-live-entry');
        const totalEl = document.getElementById('ai-live-total-pl');
        if (!document.getElementById('ai-live-price')) return;
        updateLivePriceBox(candles);
        if (!openInfo || !openInfo.trade.layers) {
            entryEl.innerText = 'Belum ada posisi'; entryEl.className = 'netral';
            totalEl.innerText = 'Rp 0'; totalEl.className = 'netral';
            return;
        }
        const trade = openInfo.trade;
        entryEl.innerText = `${trade.arah} @ ${parseFloat(trade.entry).toFixed(2)}`;
        entryEl.className = trade.arah === 'BUY' ? 'profit-text' : 'loss-text';
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let totalFloating = 0;
        trade.layers.forEach(ly => {
            if (ly.status === 'pending') return;
            if (ly.status !== 'open') { totalFloating += ly.pl; return; }
            const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
            const pipsMoved = ((lastClose - layerEntry) * dirSign) / AI_PIP_SIZE;
            totalFloating += uscToRupiah(calcLayerPlUsc(pipsMoved, ly.lot));
        });
        totalEl.innerText = `${totalFloating >= 0 ? '+' : ''}${formatRupiah(totalFloating)}`;
        totalEl.className = totalFloating >= 0 ? 'profit-text' : 'loss-text';
    }

    // Section terpisah buat Metode 2 (ICT) - data-nya ditulis bot VPS ke aiTradeData, di sini cuma DIBACA & ditampilin (gak compute ulang sinyal).
    function updateMethodTwoBox(openInfo, candles) {
        const entryEl = document.getElementById('ai-live-entry-m2');
        const totalEl = document.getElementById('ai-live-total-pl-m2');
        const detailEl = document.getElementById('ai-floating-pl-m2');
        if (!entryEl || !totalEl) return;
        if (!openInfo || !openInfo.trade.layers) {
            entryEl.innerText = 'Belum ada posisi'; entryEl.className = 'netral';
            totalEl.innerText = 'Rp 0'; totalEl.className = 'netral';
            if (detailEl) detailEl.innerHTML = '';
            return;
        }
        const trade = openInfo.trade;
        entryEl.innerText = `${trade.arah} @ ${parseFloat(trade.entry).toFixed(2)}`;
        entryEl.className = trade.arah === 'BUY' ? 'profit-text' : 'loss-text';
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let totalFloating = 0;
        trade.layers.forEach(ly => {
            if (ly.status === 'pending') return;
            if (ly.status !== 'open') { totalFloating += ly.pl; return; }
            const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
            const pipsMoved = ((lastClose - layerEntry) * dirSign) / AI_PIP_SIZE;
            totalFloating += uscToRupiah(calcLayerPlUsc(pipsMoved, ly.lot));
        });
        totalEl.innerText = `${totalFloating >= 0 ? '+' : ''}${formatRupiah(totalFloating)}`;
        totalEl.className = totalFloating >= 0 ? 'profit-text' : 'loss-text';
        if (detailEl) detailEl.innerHTML = `<div class="insight-box ${totalFloating >= 0 ? 'insight-success' : 'insight-danger'}" style="font-size:0.8rem;">${escHtml(trade.alasan || '')}</div>`;
    }

    // --- Tick "display" — dipanggil otomatis selagi tab browser kebuka. Cuma update chart & floating P/L, TIDAK buka/tutup posisi (biar gak race sama bot server). ---
    async function aiDisplayTick() {
        const candles = await fetchAiPriceData();
        if (!candles) return;
        lastAiCandles = candles;
        if (document.getElementById('ai-view-market').style.display !== 'none') renderLightweightChart(candles);

        const openInfo = findOpenAiTrade(AI_METHOD_GROUPS.method1);
        updateLiveStatsBoxes(openInfo, candles);
        // Kalau gak ada posisi open, biarkan pesan status terakhir tetap kelihatan — jangan dikosongin di sini.
        if (openInfo) updateFloatingPl(openInfo, candles);

        if (AI_METHOD_TWO_ENABLED) updateMethodTwoBox(findOpenAiTrade(AI_METHOD_GROUPS.method2), candles);
    }

    function startAiAutoTick() {
        if (aiTickInterval) return;
        aiDisplayTick();
        aiTickInterval = setInterval(aiDisplayTick, 2 * 60 * 1000); // refresh tampilan tiap 2 menit (view-only, gak nulis data — keputusan buka/tutup posisi tetap di server tiap 15 menit)
    }
    function stopAiAutoTick() {
        if (aiTickInterval) { clearInterval(aiTickInterval); aiTickInterval = null; }
    }

    // --- Kalender & CRUD entry simulasi ---
    function renderAiCalendar() {
        const cal = document.getElementById('ai-calendar'); cal.innerHTML = '';
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('ai-month-year-display').innerText = `${monthNames[m]} ${y}`;
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let totalBulan = 0;

        for (let w = 0; w < Math.ceil((firstDay + daysInMonth) / 7); w++) {
            let weeklyPl = 0; let hasData = false;
            for (let d = 0; d < 7; d++) {
                const dayNum = (w * 7 + d) - firstDay + 1;
                if (dayNum > 0 && dayNum <= daysInMonth) {
                    const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const trades = aiTradeData[fDate] || []; let dayPl = 0;
                    if (trades.length > 0) { hasData = true; trades.forEach(t => dayPl += parseFloat(t.pl || 0)); weeklyPl += dayPl; totalBulan += dayPl; }
                    const card = document.createElement('div'); card.className = `day-card ${dayPl > 0 ? 'profit' : dayPl < 0 ? 'loss' : ''}`;
                    card.innerHTML = `${trades.length > 0 ? `<span class="trade-count">${trades.length}</span>` : ''}<div class="day-number">${dayNum}</div>${trades.length > 0 ? `<span class="day-pl ${dayPl > 0 ? 'profit-text' : dayPl < 0 ? 'loss-text' : ''}">${dayPl > 0 ? '+' : ''}${formatRupiah(dayPl)}</span>` : ''}`;
                    card.onclick = () => openAiModal(fDate, dayNum);
                    cal.appendChild(card);
                } else cal.appendChild(Object.assign(document.createElement('div'), { className: 'empty-card' }));
            }
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData ? (weeklyPl > 0 ? 'weekly-profit' : (weeklyPl < 0 ? 'weekly-loss' : '')) : 'empty-card'}`;
            if (hasData) wCard.innerHTML = `<div class="week-title">Mg ${w + 1}</div><div class="week-pl ${weeklyPl > 0 ? 'profit-text' : 'loss-text'}">${weeklyPl > 0 ? '+' : ''}${formatRupiah(weeklyPl)}</div>`;
            cal.appendChild(wCard);
        }
        const totalEl = document.getElementById('ai-monthly-total'); totalEl.innerText = formatRupiah(totalBulan); totalEl.className = totalBulan > 0 ? 'profit-text' : (totalBulan < 0 ? 'loss-text' : 'netral');
        document.getElementById('ai-base-equity').innerText = formatRupiah(aiModalAwal);
        updateAiEquity(y, m);
    }
    document.getElementById('ai-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderAiCalendar(); };
    document.getElementById('ai-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderAiCalendar(); };
    document.getElementById('ai-clear-data-btn').onclick = () => {
        document.getElementById('ai-reset-reason').value = '';
        document.getElementById('ai-reset-reason-error').style.display = 'none';
        document.getElementById('ai-reset-modal').style.display = 'flex';
    };
    document.getElementById('close-ai-reset-modal').onclick = () => document.getElementById('ai-reset-modal').style.display = 'none';
    document.getElementById('btn-confirm-ai-reset').onclick = () => {
        const reason = document.getElementById('ai-reset-reason').value.trim();
        if (!reason) { document.getElementById('ai-reset-reason-error').style.display = 'block'; return; }
        logAiTick('manual_reset', reason);
        aiTradeData = {};
        saveData('ai_trade_data_v1', aiTradeData);
        renderAiCalendar();
        document.getElementById('ai-reset-modal').style.display = 'none';
    };

    function updateAiEquity(vY, vM) {
        // Bulan yang dibuka SEBELUM aiModalResetAt harus tetap kebaca pakai modal LAMA & histori penuh
        // (gak boleh ke-cutoff) - kalau enggak, browsing balik ke bulan lama jadi keliatan modal baru
        // padahal waktu itu belum berlaku. Cutoff cuma aktif buat bulan reset itu sendiri & seterusnya.
        const monthPrefix = `${vY}-${String(vM + 1).padStart(2, '0')}`;
        const isPreReset = !!(aiModalResetAt && monthPrefix < aiModalResetAt.slice(0, 7));
        const baseModal = isPreReset ? (aiModalBeforeReset ?? aiModalAwal) : aiModalAwal;
        const cutoff = isPreReset ? null : aiModalResetAt;
        let sumBefore = 0; let sumDuring = 0;
        for (const d in aiTradeData) {
            if (cutoff && d < cutoff) continue;
            let tY = new Date(d).getFullYear(); let tM = new Date(d).getMonth(); let dt = 0;
            aiTradeData[d].forEach(t => dt += parseFloat(t.pl || 0));
            if (tY < vY || (tY === vY && tM < vM)) sumBefore += dt; else if (tY === vY && tM === vM) sumDuring += dt;
        }
        let stEq = baseModal + sumBefore; let enEq = stEq + sumDuring;
        // Box "Modal Simulasi" ikut nampilin modal yang RESOLVED buat bulan yang lagi dibuka (bukan
        // selalu modal live/terkini) - biar konsisten sama Equity Awal/Akhir di sebelahnya pas browsing
        // ke bulan sebelum tanggal reset. Klik box tetap ngedit modal TERKINI, bukan modal historis ini.
        document.getElementById('ai-base-equity').innerText = formatRupiah(baseModal);
        document.getElementById('ai-start-equity').innerText = formatRupiah(stEq);
        document.getElementById('ai-current-equity').innerText = formatRupiah(enEq);
        document.getElementById('ai-equity-growth').innerHTML = sumDuring > 0 ? `<span style="color:#00e676;">+${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : (sumDuring < 0 ? `<span style="color:#ff1744;">${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : `<span style="color:#aaa;">0.00%</span>`);
    }

    const AI_LAYER_STATUS_LABEL = {
        pending: 'Pending (belum kefill)', open: 'Masih Open', tp: 'Kena TP', sl: 'Kena SL', be: 'Breakeven',
        timeout: 'Timeout (3 hari jam market)', timeout_lock: 'Timeout setelah lock', news_close: 'Ditutup (berita)', weekend_close: 'Ditutup (sebelum weekend)', cancelled: 'Dibatalkan',
        emergency_close: 'Ditutup darurat (tombol web)', broker_closed: 'Ditutup broker', slippage_close: 'Dibatalkan (slippage > 5 pip)',
    };
    function formatAiTime(iso) { return iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; }
    window.toggleAiHistDetail = function(headerEl) {
        headerEl.nextElementSibling.classList.toggle('open');
        headerEl.querySelector('.ai-hist-arrow').classList.toggle('open');
    };

    // ---- Kartu entry simulasi (dipakai modal kalender Gold & Currency) ----
    function escHtml(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function plTone(v) { v = parseFloat(v || 0); return v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu'; }
    function entryModalTitle(dateStr, dayNum) {
        const [yy, mm, dd] = String(dateStr).split('-').map(Number);
        if (!yy || !mm || !dd) return `Entry Simulasi Tgl ${dayNum}`;
        return 'Entry Simulasi · ' + new Date(yy, mm - 1, dd).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    function layerShort(ly) {
        const st = String(ly.status || '');
        const full = AI_LAYER_STATUS_LABEL[st] || st || '-';
        if (/tp/i.test(full)) return 'TP';
        if (/sl/i.test(full) && !/tutup/i.test(full)) return 'SL';
        if (/batal/i.test(full)) return 'Batal';
        if (/berita/i.test(full)) return 'Berita';
        if (/weekend/i.test(full)) return 'Weekend';
        if (/timeout/i.test(full)) return 'Timeout';
        if (/breakeven/i.test(full)) return 'BE';
        return full.length > 9 ? full.slice(0, 8) + '.' : full;
    }
    function layerBadgesHtml(layers) {
        return '<span class="lbs">' + (layers || []).map((ly, i) => `<span class="lb ${plTone(ly.pl)}">L${i + 1} ${escHtml(layerShort(ly))}</span>`).join('') + '</span>';
    }
    function fmtJam(iso) { return iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'; }
    function entryBodyHtml(t, dec) {
        const f = (v) => (v === undefined || v === null || v === '' || isNaN(parseFloat(v))) ? '-' : parseFloat(v).toFixed(dec);
        const sig = SIGNAL_TYPE_LABELS[t.signalType] || t.signalType || '-';
        const layers = (t.layers || []).map((ly, i) => `<div class="ecx-layer">
                <div class="ecx-lh"><b>Layer ${i + 1}</b><span class="ec-st ${plTone(ly.pl)}">${escHtml(AI_LAYER_STATUS_LABEL[ly.status] || ly.status || '-')}</span></div>
                <dl><dt>Entry</dt><dd>${f(ly.entry)}</dd><dt>SL</dt><dd>${f(ly.sl)}</dd><dt>TP</dt><dd>${f(ly.tp)}${ly.tpPips != null ? ` <small>${ly.tpPips}p</small>` : ''}</dd>${ly.lot != null ? `<dt>Lot</dt><dd>${ly.lot}</dd>` : ''}</dl>
                <div class="ecx-lpl ${plTone(ly.pl)}">${formatRupiah(ly.pl || 0)}</div>
            </div>`).join('');
        return `<div class="ecx-meta">
                <div><span>Metode</span><b>${escHtml(sig)}</b></div>
                <div><span>Timeframe</span><b>${escHtml(t.tf || '-')}</b></div>
                <div><span>Dibuka</span><b>${formatAiTime(t.openedAt)}</b></div>
                <div><span>Ditutup</span><b>${t.closedAt ? formatAiTime(t.closedAt) : 'Belum'}</b></div>
                <div><span>Durasi</span><b>${fmtDurasi(t.openedAt, t.closedAt)}</b></div>
            </div>
            <div class="ecx-layers-grid">${layers}</div>
            ${t.alasan ? `<div class="ecx-reason"><span>Alasan entry</span><p>${escHtml(t.alasan)}</p></div>` : ''}`;
    }
    const EC_CHEV = '<svg class="ecx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    function entryCardHtml(t, dec) {
        const pl = parseFloat(t.pl || 0);
        const isOpen = t.status !== 'closed';
        const dir = String(t.arah || '').toUpperCase();
        const sig = SIGNAL_TYPE_LABELS[t.signalType] || t.signalType || '-';
        const tone = isOpen ? 'open' : pl > 0 ? 'win' : pl < 0 ? 'lose' : 'flat';
        const price = isNaN(parseFloat(t.entry)) ? '-' : parseFloat(t.entry).toFixed(dec);
        return `<div class="ecx ecx-${tone}">
            <button type="button" class="ecx-sum" onclick="toggleEc(this)">
                <span class="ec-dir ${dir === 'BUY' ? 'buy' : 'sell'}">${escHtml(dir || '-')}</span>
                <span class="ecx-main"><b>${price}</b><small>${escHtml(sig)} · ${fmtJam(t.openedAt)} - ${t.closedAt ? fmtJam(t.closedAt) : 'open'}</small></span>
                ${layerBadgesHtml(t.layers)}
                <span class="ec-total ${plTone(pl)}">${isOpen ? 'Open' : formatRupiah(pl)}</span>
                ${EC_CHEV}
            </button>
            <div class="ecx-body">${entryBodyHtml(t, dec)}</div>
        </div>`;
    }
    window.toggleEc = function(btn) { btn.parentElement.classList.toggle('open'); };
    window.toggleAllEc = function(btn) {
        const root = btn.closest('.modal-content');
        const items = root.querySelectorAll('.ecx');
        const open = !Array.from(items).every(i => i.classList.contains('open'));
        items.forEach(i => i.classList.toggle('open', open));
        btn.innerText = open ? 'Tutup semua' : 'Buka semua';
    };
    window.dtToggle = function(tr) { tr.classList.toggle('open'); if (tr.nextElementSibling) tr.nextElementSibling.classList.toggle('open'); };
    function dashRowsHtml(e, num, dec) {
        const pl = parseFloat(e.plVal || 0);
        const dir = String(e.arah || '').toUpperCase();
        const f = (v) => isNaN(parseFloat(v)) ? '-' : parseFloat(v).toFixed(dec);
        const tp = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join(' / ') : (e.tp || '-');
        return `<tr class="dt-row" onclick="dtToggle(this)"><td class="dt-no">${num}</td><td>${e.date}</td><td><span class="ec-dir ${dir === 'BUY' ? 'buy' : 'sell'}">${escHtml(dir)}</span></td><td>${f(e.entry)}</td><td>${f(e.sl)}</td><td>${tp}</td><td>${layerBadgesHtml(e.layers)}</td><td align="right" class="${plTone(pl)}"><strong>${e.status === 'closed' ? formatRupiah(pl) : 'Open'}</strong></td></tr><tr class="dt-detail"><td colspan="8">${entryBodyHtml(e, dec)}</td></tr>`;
    }
    function entryListHtml(list, dec) {
        if (!list.length) return '<p class="ec-empty">Tidak ada entry pada tanggal ini.</p>';
        const sorted = list.slice().sort((a, b) => String(a.openedAt || '').localeCompare(String(b.openedAt || '')));
        const total = sorted.reduce((s, t) => s + parseFloat(t.pl || 0), 0);
        return `<div class="ec-summary"><span>${sorted.length} entry</span><button type="button" class="exp-link" onclick="toggleAllEc(this)">Buka semua</button><span class="${plTone(total)}">Total ${formatRupiah(total)}</span></div>` + sorted.map(t => entryCardHtml(t, dec)).join('');
    }

    function openAiModal(dateStr, dayNum) {
        currentAiDateStr = dateStr;
        document.getElementById('ai-modal-date-title').innerText = entryModalTitle(dateStr, dayNum);
        document.getElementById('ai-today-history').innerHTML = entryListHtml(aiTradeData[dateStr] || [], 2);
        document.getElementById('ai-entry-modal').style.display = 'flex';
    }
    document.getElementById('close-ai-modal').onclick = () => document.getElementById('ai-entry-modal').style.display = 'none';

    // Basis "minggu berjalan sekarang" (Senin-Minggu real, bukan minggu dari bulan yang lagi dibrowse) — kotak risk insight ini status real-time, bukan laporan historis.
    function getCurrentWeekPl(tradeData) {
        const now = new Date();
        const dow = (now.getDay() + 6) % 7; // Senin=0 ... Minggu=6
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
        let pl = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday); d.setDate(monday.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            (tradeData[key] || []).forEach(t => { pl += parseFloat(t.pl || 0); });
        }
        return pl;
    }

    // --- Dashboard evaluasi ---
    let aiPlChartInstance = null; let aiWinRateChartInstance = null;
    let lastAiDashboardStats = null;
    function renderAiDashboard() {
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('ai-dash-month-year-display').innerText = `${monthNames[m]} ${y}`;

        let monthHasData = false; let monthPl = 0; let winCount = 0; let lossCount = 0;
        let maxWin = { pl: 0, date: '-', detail: '-' }; let maxLoss = { pl: 0, date: '-', detail: '-' };
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let weeklyReports = []; for (let i = 0; i < Math.ceil((firstDay + daysInMonth) / 7); i++) weeklyReports.push({ wins: 0, losses: 0, pl: 0, hasData: false });
        let tableRows = [];
        let chartLabels = [], profitDataArr = [], lossDataArr = [];

        for (let i = 1; i <= daysInMonth; i++) {
            const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const trades = aiTradeData[fDate] || []; let wIdx = Math.floor((firstDay + i - 1) / 7);
            if (trades.length > 0) {
                monthHasData = true; weeklyReports[wIdx].hasData = true;
                let dailyProfit = 0, dailyLoss = 0;
                trades.forEach(t => {
                    let p = parseFloat(t.pl || 0); monthPl += p;
                    if (t.status === 'closed') { if (p >= 0) { winCount++; weeklyReports[wIdx].wins++; dailyProfit += p; } else { lossCount++; weeklyReports[wIdx].losses++; dailyLoss += p; } }
                    weeklyReports[wIdx].pl += p;
                    if (p > maxWin.pl) maxWin = { pl: p, date: fDate, detail: t.alasan };
                    if (p < maxLoss.pl) maxLoss = { pl: p, date: fDate, detail: t.alasan };
                    tableRows.push({ date: fDate, ...t, plVal: p });
                });
                chartLabels.push(`Tgl ${i}`); profitDataArr.push(dailyProfit); lossDataArr.push(dailyLoss);
            }
        }

        const emptyState = document.getElementById('ai-empty-state'); const dashContent = document.getElementById('ai-dash-content');
        if (!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; return; }
        emptyState.style.display = 'none'; dashContent.style.display = 'block';

        const masterS = getMasterSettings();
        const riskPeriodLabel = masterS.riskPeriod === 'weekly' ? 'minggu' : 'bulan';
        const periodPl = masterS.riskPeriod === 'weekly' ? getCurrentWeekPl(aiTradeData) : monthPl;
        const riskLimit = aiModalAwal * (masterS.riskLimitPct / 100);
        const usedPct = periodPl < 0 ? Math.min((Math.abs(periodPl) / riskLimit) * 100, 999) : 0;
        const riskBox = document.getElementById('ai-risk-insight');
        if (periodPl >= 0) riskBox.innerHTML = `<div class="insight-box insight-success">Aman! ${riskPeriodLabel === 'minggu' ? 'Minggu' : 'Bulan'} ini masih profit ${formatRupiah(periodPl)}, belum kepakai risk budget.</div>`;
        else if (usedPct < 70) riskBox.innerHTML = `<div class="insight-box insight-success">Risk terpakai ${usedPct.toFixed(0)}% dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel} (${formatRupiah(Math.abs(periodPl))} dari ${formatRupiah(riskLimit)}).</div>`;
        else if (usedPct < 100) riskBox.innerHTML = `<div class="insight-box insight-warning">Waspada! Risk terpakai ${usedPct.toFixed(0)}% dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel}. Kurangi ukuran posisi.</div>`;
        else riskBox.innerHTML = `<div class="insight-box insight-danger">LIMIT TERLAMPAUI! Rugi ${riskPeriodLabel} ini ${formatRupiah(Math.abs(periodPl))}, lewat batas ${masterS.riskLimitPct}% modal (${formatRupiah(riskLimit)}). STOP entry baru ${riskPeriodLabel} ini.</div>`;

        let closedTrades = tableRows.filter(t => t.status === 'closed');
        let overboughtMistakes = closedTrades.filter(t => t.arah === 'BUY' && t.alasan && t.alasan.toLowerCase().includes('overbought')).length;
        let oversoldMistakes = closedTrades.filter(t => t.arah === 'SELL' && t.alasan && t.alasan.toLowerCase().includes('oversold')).length;
        let winRate = closedTrades.length > 0 ? ((winCount / closedTrades.length) * 100).toFixed(0) : 0;
        document.getElementById('ai-eval-text').innerHTML = `<ul style="padding-left:20px;"><li>Total entry simulasi bulan ini: <strong>${tableRows.length}</strong> (${closedTrades.length} closed, win rate ${winRate}%).</li><li>Risk budget terpakai: <strong>${periodPl < 0 ? usedPct.toFixed(0) : 0}%</strong> dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel}.</li>${overboughtMistakes > 0 ? `<li style="color:#ff9800;">${overboughtMistakes}x entry BUY meski overbought — tunggu koreksi dulu.</li>` : ''}${oversoldMistakes > 0 ? `<li style="color:#ff9800;">${oversoldMistakes}x entry SELL meski oversold — tunggu rebound dulu.</li>` : ''}${winRate >= 50 && closedTrades.length >= 3 ? `<li style="color:#00e676;">Win rate di atas 50%, konsistensi mulai terbentuk. Pertahankan!</li>` : ''}</ul>`;

        let signalStats = {};
        closedTrades.forEach(t => {
            const type = t.signalType || 'lainnya';
            if (!signalStats[type]) signalStats[type] = { total: 0, win: 0 };
            signalStats[type].total++;
            if (t.plVal >= 0) signalStats[type].win++;
        });
        const signalLabels = SIGNAL_TYPE_LABELS;
        const signalGrid = document.getElementById('ai-signal-stats-grid');
        const signalEntries = Object.entries(signalStats);
        signalGrid.innerHTML = signalEntries.length ? signalEntries.map(([type, s]) => {
            const wr = ((s.win / s.total) * 100).toFixed(0);
            return `<div class="weekly-card"><h4>${signalLabels[type] || type}</h4><p><span>Total Entry:</span> <strong>${s.total}</strong></p><p style="border-top:1px dotted #444; padding-top:5px;"><span>Win Rate:</span> <strong class="${wr >= 50 ? 'profit-text' : 'loss-text'}">${wr}%</strong></p></div>`;
        }).join('') : '<p style="color:#888; grid-column:1/-1;">Belum ada entry closed bulan ini.</p>';

        const wGrid = document.getElementById('ai-weekly-breakdown-grid'); wGrid.innerHTML = '';
        weeklyReports.forEach((wr, idx) => { if (wr.hasData) wGrid.innerHTML += `<div class="weekly-card ${wr.pl > 0 ? 'week-profit' : (wr.pl < 0 ? 'week-loss' : '')}"><h4>Minggu ${idx + 1}</h4><p><span>Win:</span> <span style="color:#00e676;">${wr.wins}x</span></p><p><span>Loss:</span> <span style="color:#ff1744;">${wr.losses}x</span></p><p style="border-top:1px dotted #444; padding-top:5px;"><span>Hasil:</span> <strong class="${wr.pl > 0 ? 'profit-text' : 'loss-text'}">${wr.pl > 0 ? '+' : ''}${formatRupiah(wr.pl)}</strong></p></div>`; });

        document.getElementById('ai-highest-win-pl').innerText = maxWin.pl > 0 ? `+${formatRupiah(maxWin.pl)}` : 'Rp 0'; document.getElementById('ai-highest-win-desc').innerText = maxWin.date !== '-' ? `[${maxWin.date}] ${maxWin.detail}` : '-';
        document.getElementById('ai-highest-loss-pl').innerText = maxLoss.pl < 0 ? formatRupiah(maxLoss.pl) : 'Rp 0'; document.getElementById('ai-highest-loss-desc').innerText = maxLoss.date !== '-' ? `[${maxLoss.date}] ${maxLoss.detail}` : '-';

        if (aiPlChartInstance) aiPlChartInstance.destroy();
        aiPlChartInstance = new Chart(document.getElementById('ai-plChart').getContext('2d'), {
            type: 'bar',
            data: { labels: chartLabels, datasets: [
                { label: 'Total Profit', data: profitDataArr, backgroundColor: '#00e676', borderRadius: 4 },
                { label: 'Total Loss', data: lossDataArr, backgroundColor: '#ff1744', borderRadius: 4 }
            ]},
            options: {
                maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true } },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { footer: function(tooltipItems) { let total = 0; tooltipItems.forEach(function(ti) { total += ti.parsed.y; }); return 'Net P/L: ' + formatRupiah(total); } } }
                }
            }
        });

        if (aiWinRateChartInstance) aiWinRateChartInstance.destroy();
        aiWinRateChartInstance = new Chart(document.getElementById('ai-winRateChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['Win', 'Loss'], datasets: [{ data: [winCount, lossCount], backgroundColor: ['#00e676', '#ff1744'], borderWidth: 0 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        let aiWinPct = closedTrades.length > 0 ? Math.round((winCount / closedTrades.length) * 100) : 0;
        let aiLossPct = closedTrades.length > 0 ? 100 - aiWinPct : 0;
        document.getElementById('ai-win-rate-text').innerHTML = `<span style="font-size:1.5rem;">${aiWinPct}% Win</span><span style="font-size:1.1rem; color:#ff1744;">${aiLossPct}% Loss</span>`;

        aiTableMaster = tableRows;
        aiTableCurrentPage = 1;
        renderAiTable();

        // Snapshot angka yang UDAH dihitung di atas - dipakai tombol "Analisa AI", gak hitung ulang apa-apa.
        lastAiDashboardStats = {
            totalEntries: tableRows.length, closedCount: closedTrades.length, winRate,
            monthPl, usedPct: periodPl < 0 ? usedPct.toFixed(0) : 0, riskLimitPct: masterS.riskLimitPct, riskPeriodLabel,
            signalStats, weeklyReports, maxWin, maxLoss,
        };
    }
    document.getElementById('ai-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderAiDashboard(); };
    document.getElementById('ai-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderAiDashboard(); };
    document.getElementById('btn-ai-llm-recommend').onclick = function() {
        if (!lastAiDashboardStats) { alert('Belum ada data bulan ini buat dianalisa.'); return; }
        requestEvalRecommendation(lastAiDashboardStats, 'XAUUSD (Gold)', 'ai-llm-recommendation', this);
    };

    // --- Detail Entry Simulasi: search + sort + pagination (client-side, dari aiTableMaster bulan yang lagi dibrowse) ---
    let aiTableMaster = [];
    let aiTableSearch = '';
    let aiTableSort = { col: 'date', dir: 'desc' };
    let aiTablePageSize = 30; // number | 'all'
    let aiTableCurrentPage = 1;

    function renderAiTable() {
        let rows = [...aiTableMaster];
        const q = aiTableSearch.trim().toLowerCase();
        if (q) {
            rows = rows.filter(e => {
                const tpDisplay = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join('/') : (e.tp || '');
                return [e.date, e.arah, e.alasan, tpDisplay].some(v => (v || '').toString().toLowerCase().includes(q));
            });
        }
        const { col, dir } = aiTableSort;
        rows.sort((a, b) => {
            let va = a[col], vb = b[col];
            if (typeof va === 'string' && typeof vb === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
            return dir === 'asc' ? va - vb : vb - va;
        });

        const total = rows.length;
        const pageSize = aiTablePageSize === 'all' ? Math.max(total, 1) : aiTablePageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (aiTableCurrentPage > totalPages) aiTableCurrentPage = totalPages;
        const startIdx = (aiTableCurrentPage - 1) * pageSize;
        const pageRows = rows.slice(startIdx, startIdx + pageSize);

        const tbody = document.getElementById('ai-dashboard-table-body');
        tbody.innerHTML = pageRows.length ? '' : `<tr><td colspan="8" style="text-align:center;">Tidak ada data.</td></tr>`;
        pageRows.forEach((e, i) => {
            const tpDisplay = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join('/') : (e.tp || '-');
            tbody.innerHTML += dashRowsHtml(e, startIdx + i + 1, 2);
        });

        const pagEl = document.getElementById('ai-table-pagination');
        pagEl.innerHTML = `<span style="color:#888; font-size:0.85rem;">${total === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + pageSize, total)} dari ${total} entry</span>` +
            `<div style="display:flex; gap:6px; align-items:center;">
                <button type="button" class="btn-action" id="ai-table-prev" ${aiTableCurrentPage <= 1 ? 'disabled' : ''} style="padding:4px 12px;">&lt; Prev</button>
                <span style="color:#ccc; font-size:0.85rem;">Hal ${aiTableCurrentPage}/${totalPages}</span>
                <button type="button" class="btn-action" id="ai-table-next" ${aiTableCurrentPage >= totalPages ? 'disabled' : ''} style="padding:4px 12px;">Next &gt;</button>
            </div>`;
        document.getElementById('ai-table-prev').onclick = () => { aiTableCurrentPage--; renderAiTable(); };
        document.getElementById('ai-table-next').onclick = () => { aiTableCurrentPage++; renderAiTable(); };

        document.querySelectorAll('#ai-view-dashboard th.ai-sortable').forEach(th => {
            const oldArrow = th.querySelector('.ai-sort-arrow'); if (oldArrow) oldArrow.remove();
            if (th.dataset.col === col) {
                const arrow = document.createElement('span'); arrow.className = 'ai-sort-arrow'; arrow.textContent = dir === 'asc' ? ' ▲' : ' ▼';
                th.appendChild(arrow);
            }
        });
    }

    document.getElementById('ai-table-search').addEventListener('input', (e) => { aiTableSearch = e.target.value; aiTableCurrentPage = 1; renderAiTable(); });
    document.getElementById('ai-table-page-size').addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('ai-table-page-size-custom').style.display = val === 'custom' ? 'inline-block' : 'none';
        if (val === 'custom') { const n = parseInt(document.getElementById('ai-table-page-size-custom').value); aiTablePageSize = n > 0 ? n : 30; }
        else aiTablePageSize = val === 'all' ? 'all' : parseInt(val);
        aiTableCurrentPage = 1;
        renderAiTable();
    });
    document.getElementById('ai-table-page-size-custom').addEventListener('input', (e) => {
        const n = parseInt(e.target.value);
        if (n > 0) { aiTablePageSize = n; aiTableCurrentPage = 1; renderAiTable(); }
    });
    document.querySelectorAll('#ai-view-dashboard th.ai-sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            aiTableSort = aiTableSort.col === col ? { col, dir: aiTableSort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' };
            aiTableCurrentPage = 1;
            renderAiTable();
        });
    });

    // ==========================================
    // 3. MODUL PENGELUARAN BULANAN
    // ==========================================
    let currentExpDateStr = null; let expCatChartInst = null; let expBankChartInst = null;

    document.getElementById('exp-menu-calendar').addEventListener('click', function() { this.classList.add('active'); document.getElementById('exp-menu-dashboard').classList.remove('active'); document.getElementById('exp-view-calendar').style.display = 'block'; document.getElementById('exp-view-dashboard').style.display = 'none'; renderExpCalendar(); });
    document.getElementById('exp-menu-dashboard').addEventListener('click', function() { this.classList.add('active'); document.getElementById('exp-menu-calendar').classList.remove('active'); document.getElementById('exp-view-calendar').style.display = 'none'; document.getElementById('exp-view-dashboard').style.display = 'block'; renderExpDashboard(); });
    document.getElementById('exp-type').addEventListener('change', function() { document.getElementById('exp-bank-group').style.display = this.value === 'Online' ? 'flex' : 'none'; });
    function getBankClass(bankName, type) { if(type === 'Cash') return 'tunai'; let b = bankName.toLowerCase(); if(b.includes('bca')) return 'bca'; if(b.includes('gopay')) return 'gopay'; if(b.includes('ovo')) return 'ovo'; if(b.includes('pmt')) return 'pmt'; return 'lainnya'; }

    function renderExpCalendar() {
        if(!isLoggedIn) return; const cal = document.getElementById('exp-calendar'); cal.innerHTML = ''; const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); document.getElementById('exp-month-year-display').innerText = `${monthNames[m]} ${y}`; const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate(); let totalBulan = 0;
        for (let w = 0; w < Math.ceil((firstDay + daysInMonth)/7); w++) {
            let weeklyExp = 0; let hasData = false;
            for (let d = 0; d < 7; d++) {
                const dayNum = (w * 7 + d) - firstDay + 1;
                if (dayNum > 0 && dayNum <= daysInMonth) {
                    const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
                    const items = expData[fDate] || []; let dayExp = 0; let badgesHTML = '';
                    if (items.length > 0) { hasData=true; items.forEach(t => { dayExp += parseFloat(t.amount); badgesHTML += `<span class="bank-badge ${getBankClass(t.bank, t.type)}">${t.type==='Cash'?'Tunai':t.bank}</span>`; }); weeklyExp+=dayExp; totalBulan+=dayExp; }
                    const card = document.createElement('div'); card.className = `day-card ${dayExp>0?'exp-day':''}`; card.innerHTML = `<div class="day-number">${dayNum}</div><div style="display:flex; flex-wrap:wrap; gap:3px;">${badgesHTML}</div>${items.length>0?`<span class="day-pl" style="color:#ff1744; font-size:1rem; margin-top:auto;">-${formatRupiah(dayExp)}</span>`:''}`; card.onclick = () => { if(isLoggedIn) openExpModal(fDate, dayNum); }; cal.appendChild(card);
                } else cal.appendChild(Object.assign(document.createElement('div'), {className:'empty-card'}));
            }
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData?'':'empty-card'}`; if(hasData) wCard.innerHTML = `<div class="week-title">Mg ${w+1}</div><div class="week-pl" style="color:#ff1744;">-${formatRupiah(weeklyExp)}</div>`; cal.appendChild(wCard);
        }
        document.getElementById('exp-monthly-total').innerText = formatRupiah(totalBulan);
        const wBox = document.getElementById('exp-warning-box');
        if (totalBulan >= 1500000) { wBox.style.display = 'flex'; wBox.className = 'insight-box insight-danger'; wBox.innerHTML = `🚨 <strong>DANGER!</strong> Pengeluaranmu tembus ${formatRupiah(totalBulan)}. Rem darurat sekarang!`; }
        else if (totalBulan >= 1000000) { wBox.style.display = 'flex'; wBox.className = 'insight-box insight-warning'; wBox.innerHTML = `⚠️ <strong>WARNING!</strong> Pengeluaran sudah ${formatRupiah(totalBulan)}. Hati-hati jebol!`; }
        else if (totalBulan > 0) { wBox.style.display = 'flex'; wBox.className = 'insight-box insight-success'; wBox.innerHTML = `✅ <strong>AMAN!</strong> Anggaran masih terjaga dengan baik.`; } else { wBox.style.display = 'none'; }
    }
    document.getElementById('exp-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderExpCalendar(); }; document.getElementById('exp-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderExpCalendar(); };

    const EXP_CAT_COLORS = { 'Rutin (Wajib)': '#4caf50', 'Penting banget': '#ff9800', 'Penasaran/FOMO': '#f44336', 'Date / Main': '#e91e63', 'Gak penting banget': '#9c27b0' };
    const EXP_BANK_COLORS = { 'Tunai': '#4caf50', 'BCA': '#0066ae', 'Gopay': '#00aed6', 'OVO': '#4c2a86', 'PMT': '#ff9800', 'Lainnya': '#888' };
    function expBarsHtml(totals, total, colors, clickAttr) {
        return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name, amt]) => {
            const pct = total ? (amt / total) * 100 : 0;
            return `<div class="bar-row"${clickAttr ? ` ${clickAttr}="${escHtml(name)}" role="button" tabindex="0"` : ''}>
                <div class="bar-top"><span class="bar-name"><i style="background:${colors[name] || '#888'}"></i>${escHtml(name)}</span><span class="bar-val">${formatRupiah(amt)} <em>${pct.toFixed(0)}%</em></span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct, 2)}%; background:${colors[name] || '#888'}"></div></div>
            </div>`;
        }).join('');
    }
    function renderExpDashboard() {
        if(!isLoggedIn) return; const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); document.getElementById('exp-dash-month-year-display').innerText = `${monthNames[m]} ${y}`; let catTotals = {}; let bankTotals = {}; let totalBelanja = 0; let monthHasData = false; let allTx = []; let maxTx = null;
        for (let i = 1; i <= 31; i++) { const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`; if(expData[fDate] && expData[fDate].length > 0) { monthHasData = true; expData[fDate].forEach(t => { let amt = parseFloat(t.amount) || 0; totalBelanja += amt; catTotals[t.category] = (catTotals[t.category] || 0) + amt; let bankKey = t.type === 'Cash' ? 'Tunai' : t.bank; bankTotals[bankKey] = (bankTotals[bankKey] || 0) + amt; let tx = { date: fDate, ...t, amt }; allTx.push(tx); if (!maxTx || amt > maxTx.amt) maxTx = tx; }); } }
        const emptyState = document.getElementById('exp-empty-state'); const dashContent = document.getElementById('exp-dash-content');
        document.getElementById('exp-category-detail').style.display = 'none';
        if(!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; return; }
        emptyState.style.display = 'none'; dashContent.style.display = 'block';
        const prevD = new Date(y, m - 1, 1), prevPrefix = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
        let prevTotal = 0; for (let d in expData) { if (d.startsWith(prevPrefix)) expData[d].forEach(t => prevTotal += parseFloat(t.amount) || 0); }
        const dayCount = new Set(allTx.map(t => t.date)).size;
        const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
        let vsPrev = `<h3>-</h3><span class="sub">Belum ada data bulan lalu</span>`;
        if (prevTotal > 0) { const diff = ((totalBelanja - prevTotal) / prevTotal) * 100; vsPrev = `<h3 class="${diff > 0 ? 'loss-text' : 'profit-text'}">${diff > 0 ? '+' : ''}${diff.toFixed(0)}%</h3><span class="sub">${diff > 0 ? 'Naik' : 'Turun'} dibanding bulan lalu</span>`; }
        document.getElementById('exp-dash-stats').innerHTML = `
            <div class="equity-box" style="border-left-color:#ff1744;"><span class="label">Total keluar</span><h3 class="loss-text">${formatRupiah(totalBelanja)}</h3><span class="sub">${allTx.length} transaksi di ${dayCount} hari</span></div>
            <div class="equity-box" style="border-left-color:#ffd700;"><span class="label">Rata-rata per hari</span><h3>${formatRupiah(Math.round(totalBelanja / dayCount))}</h3><span class="sub">Hari yang ada pengeluaran</span></div>
            <div class="equity-box" style="border-left-color:#ff9800;"><span class="label">Pengeluaran terbesar</span><h3>${formatRupiah(maxTx.amt)}</h3><span class="sub">${escHtml(maxTx.notes)} (tgl ${maxTx.date.slice(8)})</span></div>
            <div class="equity-box" style="border-left-color:#2196f3;"><span class="label">Bulan lalu</span>${vsPrev}</div>`;
        let msg = '';
        if ((catTotals['Gak penting banget'] || 0) > 300000) msg = 'Pengeluaran "Gak penting banget" cukup besar bulan ini. Coba kurangi di bulan depan.';
        else if (topCat) msg = `Kategori terbesar: <b>${escHtml(topCat[0])}</b>, ${((topCat[1] / totalBelanja) * 100).toFixed(0)}% dari total. Pengeluaran masih terkendali.`;
        document.getElementById('exp-dash-insight').innerHTML = `<div class="pg-note">${msg}</div>`;
        document.getElementById('exp-cat-bars').innerHTML = expBarsHtml(catTotals, totalBelanja, EXP_CAT_COLORS, 'data-cat');
        document.getElementById('exp-bank-bars').innerHTML = expBarsHtml(bankTotals, totalBelanja, EXP_BANK_COLORS, '');
        document.querySelectorAll('#exp-cat-bars .bar-row').forEach(r => {
            const open = () => { const cat = r.dataset.cat; showExpCategoryDetail(cat, allTx.filter(t => t.category === cat)); };
            r.addEventListener('click', open); r.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
        });
    }

    function showExpCategoryDetail(category, txList) {
        const box = document.getElementById('exp-category-detail');
        txList = [...txList].sort((a,b) => b.date.localeCompare(a.date));
        const rows = txList.map(t => `<div class="exp-tx"><span class="exp-tx-date">${t.date.slice(8)}/${t.date.slice(5, 7)}</span><span class="exp-tx-note">${escHtml(t.notes)}<small>${t.type === 'Cash' ? 'Tunai' : escHtml(t.bank)}</small></span><b class="loss-text">${formatRupiah(t.amt)}</b></div>`).join('');
        box.innerHTML = `<h3 class="chart-title">${escHtml(category)} <span class="mon-sub">${txList.length} transaksi</span></h3><div class="exp-tx-list">${rows}</div>`;
        box.style.display = 'block';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    document.getElementById('exp-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderExpDashboard(); }; document.getElementById('exp-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderExpDashboard(); };

    function openExpModal(dateStr, dayNum) {
        currentExpDateStr = dateStr; document.getElementById('exp-modal-title').innerText = `Pengeluaran Tgl ${dayNum}`; document.getElementById('exp-history').innerHTML=''; (expData[dateStr]||[]).forEach((t,i) => { document.getElementById('exp-history').innerHTML += `<div class="history-item" style="border-left-color:#ff1744;"><div><strong style="color:#ff1744;">-${formatRupiah(t.amount)}</strong><br><span style="color:#aaa; font-size:0.75rem;">[${t.type==='Cash'?'Tunai':escHtml(t.bank)}] ${escHtml(t.notes)} (${escHtml(t.category)})</span></div><div class="action-group"><button type="button" class="edit-btn" onclick="editExp('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button><button type="button" class="del-btn" onclick="deleteExp('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/></svg></button></div></div>`; }); document.getElementById('exp-modal').style.display = 'flex';
    }
    document.getElementById('close-exp-modal').onclick = () => document.getElementById('exp-modal').style.display='none';
    window.deleteExp = (d, i) => { expData[d].splice(i,1); if(!expData[d].length) delete expData[d]; saveData('expense_data_v1', expData); openExpModal(d, new Date(d).getDate()); renderExpCalendar(); };
    window.editExp = (d, i) => { let t = expData[d][i]; document.getElementById('exp-type').value = t.type; document.getElementById('exp-bank').value = t.bank; document.getElementById('exp-amount').value = t.amount; document.getElementById('exp-category').value = t.category; document.getElementById('exp-notes').value = t.notes; document.getElementById('exp-bank-group').style.display = t.type === 'Online' ? 'flex' : 'none'; document.getElementById('exp-edit-index').value = i; document.getElementById('exp-cancel-edit-btn').style.display = 'block'; document.getElementById('exp-form-title').innerText = '✏️ Edit Pengeluaran'; };
    document.getElementById('exp-cancel-edit-btn').onclick = () => { document.getElementById('exp-form').reset(); document.getElementById('exp-edit-index').value = "-1"; document.getElementById('exp-cancel-edit-btn').style.display = 'none'; document.getElementById('exp-form-title').innerText = '+ Tambah Pengeluaran'; };
    document.getElementById('exp-form').onsubmit = (e) => { e.preventDefault(); if(!expData[currentExpDateStr]) expData[currentExpDateStr]=[]; let newData = {type: document.getElementById('exp-type').value, bank: document.getElementById('exp-bank').value, amount: document.getElementById('exp-amount').value, category: document.getElementById('exp-category').value, notes: document.getElementById('exp-notes').value}; let idx = parseInt(document.getElementById('exp-edit-index').value); if(idx > -1) expData[currentExpDateStr][idx] = newData; else expData[currentExpDateStr].push(newData); saveData('expense_data_v1', expData); document.getElementById('exp-cancel-edit-btn').click(); openExpModal(currentExpDateStr, new Date(currentExpDateStr).getDate()); renderExpCalendar(); };

    // ==========================================
    // 4. MODUL JURNAL OLAHRAGA
    // ==========================================
    let currentSportDateStr = null; let sportFreqChartInst = null; let sportTypeChartInst = null; let sportActiveChartInst = null;
    document.getElementById('sport-menu-calendar').addEventListener('click', function() { this.classList.add('active'); document.getElementById('sport-menu-dashboard').classList.remove('active'); document.getElementById('sport-view-calendar').style.display = 'block'; document.getElementById('sport-view-dashboard').style.display = 'none'; renderSportCalendar(); });
    document.getElementById('sport-menu-dashboard').addEventListener('click', function() { this.classList.add('active'); document.getElementById('sport-menu-calendar').classList.remove('active'); document.getElementById('sport-view-calendar').style.display = 'none'; document.getElementById('sport-view-dashboard').style.display = 'block'; renderSportDashboard(); });

    document.getElementById('btn-add-set').onclick = () => { const row = document.createElement('div'); row.className = 'sport-set-row'; row.style.cssText = "display:flex; gap:10px; margin-top:10px;"; row.innerHTML = `<input type="text" class="form-input set-name" placeholder="Gerakan" style="flex:2;" required><input type="number" class="form-input set-dur" placeholder="Kerja (Mnt)" style="flex:1;" required><input type="number" class="form-input set-rest" placeholder="Rest (Mnt)" style="flex:1;" required><button type="button" class="btn-remove-set" onclick="this.parentElement.remove(); calculateSportDuration();">X</button>`; document.getElementById('sport-sets-container').appendChild(row); bindSetCalculation(); };
    window.calculateSportDuration = function() { let total = 0; document.querySelectorAll('.sport-set-row').forEach(row => { total += (parseFloat(row.querySelector('.set-dur').value) || 0) + (parseFloat(row.querySelector('.set-rest').value) || 0); }); document.getElementById('sport-auto-duration').innerText = `${total} Menit`; return total; }
    function bindSetCalculation() { document.querySelectorAll('.set-dur, .set-rest').forEach(el => { el.removeEventListener('input', calculateSportDuration); el.addEventListener('input', calculateSportDuration); }); }
    function getSportClass(type) { let t = type.toLowerCase(); if(t.includes('skip')) return 's-skipping'; if(t.includes('plank')) return 's-plank'; if(t.includes('beban')) return 's-beban'; if(t.includes('lari')) return 's-lari'; return 's-lainnya'; }

    function renderSportCalendar() {
        const cal = document.getElementById('sport-calendar'); cal.innerHTML = '';
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); 
        document.getElementById('sport-month-year-display').innerText = `${monthNames[m]} ${y}`;
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        
        let totalBulanMenit = 0; let totalBulanSesi = 0; let sportTotals = {};

        let today = new Date(); today.setHours(0,0,0,0);

        for (let w = 0; w < Math.ceil((firstDay + daysInMonth)/7); w++) {
            let weeklyDur = 0; let weeklyCount = 0; let weeklyTypes = new Set(); let hasData = false;
            for (let d = 0; d < 7; d++) {
                const dayNum = (w * 7 + d) - firstDay + 1;
                if (dayNum > 0 && dayNum <= daysInMonth) {
                    const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
                    const items = sportData[fDate] || []; let dayDur = 0; let badgesHTML = '';
                    
                    if (items.length > 0) { 
                        hasData=true; items.forEach(t => { dayDur += parseFloat(t.totalDur); weeklyTypes.add(t.type); weeklyCount++; totalBulanSesi++; sportTotals[t.type] = (sportTotals[t.type] || 0) + 1; badgesHTML += `<span class="sport-badge ${getSportClass(t.type)}">${t.type}</span>`; }); weeklyDur+=dayDur; totalBulanMenit+=dayDur; 
                    }
                    
                    let targetDate = new Date(y, m, dayNum);
                    let diffDays = Math.floor((today - targetDate) / (1000 * 60 * 60 * 24));
                    let isMissed = (items.length === 0 && diffDays >= 5);

                    const card = document.createElement('div'); card.className = `day-card ${dayDur>0?'sport-day':(isMissed?'loss':'')}`;
                    
                    let statusHTML = '';
                    if (items.length > 0) statusHTML = `<span class="day-pl sport-text" style="font-size:0.9rem; margin-top:auto;">${dayDur} Menit</span>`;
                    else if (isMissed) statusHTML = `<span class="day-pl sport-text" style="font-size:0.72rem; font-weight:600; color:var(--tx-muted, #888); margin-top:auto;">Tidak olahraga</span>`;

                    card.innerHTML = `<div class="day-number">${dayNum}</div><div style="display:flex; flex-direction:column; gap:3px;">${badgesHTML}</div>${statusHTML}`;
                    card.onclick = () => { if(isLoggedIn) openSportModal(fDate, dayNum, diffDays); }; cal.appendChild(card);
                } else cal.appendChild(Object.assign(document.createElement('div'), {className:'empty-card'}));
            }
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData?'':'empty-card'}`; if(hasData) { let typesStr = Array.from(weeklyTypes).join(', '); wCard.innerHTML = `<div class="week-title">Mg ${w+1}</div><div class="week-pl sport-text" style="font-size:0.95rem;">${weeklyCount}x Latihan<br>${weeklyDur} Mnt</div><div style="font-size:0.65rem; color:#888; margin-top:5px; line-height:1.2;">(${typesStr})</div>`; } cal.appendChild(wCard);
        }
        document.getElementById('sport-monthly-total').innerText = `${totalBulanSesi} Kali | ${totalBulanMenit} Menit`;
        let badgesHtml = ''; for (let sType in sportTotals) { badgesHtml += `<div style="padding:5px 10px; border-radius:4px; font-size:0.85rem;" class="sport-badge ${getSportClass(sType)}">${sType}: ${sportTotals[sType]}x Latihan</div>`; } document.getElementById('sport-summary-badges').innerHTML = badgesHtml || '<span style="color:#888;">Belum ada data latihan bulan ini.</span>';
    }
    document.getElementById('sport-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderSportCalendar(); }; document.getElementById('sport-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderSportCalendar(); };
    document.getElementById('sport-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderSportDashboard(); }; document.getElementById('sport-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderSportDashboard(); };


    // Dropdown di form diganti tombol pilihan. <select> aslinya tetap ada (disembunyikan) supaya logika simpan/edit tidak berubah.
    function enhanceChips(selectId) {
        const sel = document.getElementById(selectId); if (!sel || sel.dataset.chips) return;
        sel.dataset.chips = '1'; sel.style.display = 'none';
        const box = document.createElement('div'); box.className = 'chip-group'; box.setAttribute('role', 'group');
        [...sel.options].forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.v = o.value; b.textContent = o.textContent; b.addEventListener('click', () => { sel.value = o.value; sel.dispatchEvent(new Event('change')); }); box.appendChild(b); });
        sel.insertAdjacentElement('afterend', box);
        const sync = () => box.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.v === sel.value));
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(sel, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); }, configurable: true });
        sel.addEventListener('change', sync);
        if (sel.form) sel.form.addEventListener('reset', () => setTimeout(sync, 0));
        sync();
    }
    ['exp-type', 'exp-bank', 'exp-category', 'sport-type', 'sport-target', 'sport-achieved'].forEach(enhanceChips);

    function renderSportDashboard() {
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); document.getElementById('sport-dash-month-year-display').innerText = `${monthNames[m]} ${y}`;
        let labels = []; let dataFreq = []; let activeDays = 0; let missedDays = 0; let domSport = {}; let monthHasData = false; let totalSessions = 0; let totalMinutes = 0;

        let today = new Date(); today.setHours(0,0,0,0);

        for (let i = 1; i <= 31; i++) {
            const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`; labels.push(`Tgl ${i}`);
            let targetDate = new Date(y, m, i); let diffDays = Math.floor((today - targetDate) / (1000 * 60 * 60 * 24));

            if(sportData[fDate] && sportData[fDate].length > 0) {
                monthHasData = true; activeDays++; let dur = 0; sportData[fDate].forEach(t => { dur += parseFloat(t.totalDur); domSport[t.type] = (domSport[t.type] || 0) + 1; totalSessions++; totalMinutes += parseFloat(t.totalDur); }); dataFreq.push(dur);
            } else {
                dataFreq.push(0); if(diffDays >= 5 && targetDate <= today) missedDays++;
            }
        }
        const emptyState = document.getElementById('sport-empty-state'); const dashContent = document.getElementById('sport-dash-content');
        if(!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; }
        else {
            emptyState.style.display = 'none'; dashContent.style.display = 'block';
            const daysInMonthActual = new Date(y, m + 1, 0).getDate();
            const isCurrentMonth = (y === today.getFullYear() && m === today.getMonth());
            const relevantDays = isCurrentMonth ? today.getDate() : daysInMonthActual;
            const daysOff = Math.max(relevantDays - activeDays, 0);
            const pctAktif = relevantDays > 0 ? Math.round((activeDays / relevantDays) * 100) : 0;
            const topType = Object.entries(domSport).sort((a, b) => b[1] - a[1])[0];
            document.getElementById('sport-dash-stats').innerHTML = `
                <div class="equity-box" style="border-left-color:#2196f3;"><span class="label">Hari aktif</span><h3>${activeDays} hari</h3><span class="sub">${daysOff} hari tanpa latihan</span></div>
                <div class="equity-box" style="border-left-color:#00e676;"><span class="label">Total sesi</span><h3>${totalSessions}x</h3><span class="sub">${Math.round(totalMinutes)} menit semuanya</span></div>
                <div class="equity-box" style="border-left-color:#ffd700;"><span class="label">Rata-rata per sesi</span><h3>${totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0} menit</h3><span class="sub">Durasi latihan</span></div>
                <div class="equity-box" style="border-left-color:#ff9800;"><span class="label">Paling sering</span><h3>${topType ? escHtml(topType[0]) : '-'}</h3><span class="sub">${topType ? topType[1] + 'x dari ' + totalSessions + ' sesi' : '-'}</span></div>`;
            let msg = `Latihan di <b>${activeDays} hari</b>, tanpa latihan <b>${daysOff} hari</b>. `;
            if (activeDays < 4) msg += 'Masih sedikit. Coba pelan-pelan naikkan frekuensinya untuk target Naik Gunung.';
            else if (activeDays > 15) msg += 'Konsistensinya sangat bagus, pertahankan.';
            else msg += 'Bagus, sudah mulai rutin.';
            document.getElementById('sport-dash-insight').innerHTML = `<div class="pg-note">${msg}</div>`;
            const SPORT_COLORS = { 'Skipping': '#ff9800', 'Plank': '#9c27b0', 'Angkat Beban': '#f44336', 'Lari': '#4caf50', 'Lainnya': '#2196f3' };
            document.getElementById('sport-type-bars').innerHTML = Object.entries(domSport).sort((a, b) => b[1] - a[1]).map(([name, n]) => {
                const pct = totalSessions ? (n / totalSessions) * 100 : 0;
                return `<div class="bar-row"><div class="bar-top"><span class="bar-name"><i style="background:${SPORT_COLORS[name] || '#888'}"></i>${escHtml(name)}</span><span class="bar-val">${n}x <em>${pct.toFixed(0)}%</em></span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct, 3)}%; background:${SPORT_COLORS[name] || '#888'}"></div></div></div>`;
            }).join('');
            document.getElementById('sport-consistency').innerHTML = `<div class="sport-cons-big">${pctAktif}%<small>${activeDays} dari ${relevantDays} hari</small></div><div class="bar-track" style="height:12px;"><div class="bar-fill" style="width:${Math.max(pctAktif, 2)}%; background:#2196f3;"></div></div>`;

            const dim = daysInMonthActual;
            const maxDur = Math.max(...dataFreq.slice(0, dim), 1);
            const bestIdx = dataFreq.slice(0, dim).indexOf(Math.max(...dataFreq.slice(0, dim)));
            document.getElementById('sport-daily-note').innerText = `Terlama ${Math.round(maxDur)} menit (tgl ${bestIdx + 1})`;
            document.getElementById('sport-daily-bars').innerHTML = dataFreq.slice(0, dim).map((d, i) => `<div class="db${d ? ' on' : ''}" title="Tgl ${i + 1}: ${d ? Math.round(d) + ' menit' : 'tidak latihan'}"><i style="height:${d ? Math.max((d / maxDur) * 100, 12) : 6}%"></i><span>${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span></div>`).join('');
        }
    }

    function openSportModal(dateStr, dayNum, diffDays = 0) {
        currentSportDateStr = dateStr; document.getElementById('sport-modal-title').innerText = `Latihan Tgl ${dayNum}`; document.getElementById('sport-history').innerHTML=''; 
        (sportData[dateStr]||[]).forEach((t,i) => { let lateInfo = t.lateReason ? `<br><span style="color:#ff9800; font-size:0.75rem;">(Telat Input: ${escHtml(t.lateReason)})</span>` : ''; let sClass = getSportClass(t.type); document.getElementById('sport-history').innerHTML += `<div class="history-item ${sClass}"><div><strong class="sport-badge ${sClass}" style="display:inline-block;">${escHtml(t.type)} (${escHtml(t.totalDur)} Mnt)</strong><br><span style="color:#aaa; font-size:0.75rem;">${escHtml(t.time)} | Target: ${escHtml(t.target)} | ${escHtml(t.achieved)}</span>${lateInfo}</div><div class="action-group"><button type="button" class="edit-btn" onclick="editSport('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button><button type="button" class="del-btn" onclick="deleteSport('${dateStr}', ${i})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/></svg></button></div></div>`; });
        document.getElementById('sport-sets-container').innerHTML = `<div class="sport-set-row" style="display:flex; gap:10px; margin-top:10px;"><input type="text" class="form-input set-name" placeholder="Gerakan" style="flex:2;" required><input type="number" class="form-input set-dur" placeholder="Kerja (Mnt)" style="flex:1;" required><input type="number" class="form-input set-rest" placeholder="Rest (Mnt)" style="flex:1;" required></div>`; document.getElementById('sport-auto-duration').innerText = "0 Menit"; bindSetCalculation(); 
        
        if(diffDays >= 5) { document.getElementById('late-reason-container').style.display = 'block'; document.getElementById('sport-late-reason').required = true; } else { document.getElementById('late-reason-container').style.display = 'none'; document.getElementById('sport-late-reason').required = false; }
        document.getElementById('sport-modal').style.display = 'flex';
    }
    document.getElementById('close-sport-modal').onclick = () => document.getElementById('sport-modal').style.display='none';
    window.deleteSport = (d, i) => { sportData[d].splice(i,1); if(!sportData[d].length) delete sportData[d]; saveData('sport_data_v1', sportData); openSportModal(d, new Date(d).getDate()); renderSportCalendar(); };
    window.editSport = (d, i) => { let t = sportData[d][i]; document.getElementById('sport-time').value = t.time; document.getElementById('sport-type').value = t.type; document.getElementById('sport-target').value = t.target; document.getElementById('sport-achieved').value = t.achieved; document.getElementById('sport-notes').value = t.notes; if(t.lateReason) { document.getElementById('late-reason-container').style.display = 'block'; document.getElementById('sport-late-reason').value = t.lateReason; } document.getElementById('sport-sets-container').innerHTML = ''; t.sets.forEach(set => { const row = document.createElement('div'); row.className = 'sport-set-row'; row.style.cssText = "display:flex; gap:10px; margin-top:10px;"; row.innerHTML = `<input type="text" class="form-input set-name" value="${set.name}" style="flex:2;" required><input type="number" class="form-input set-dur" value="${set.dur}" style="flex:1;" required><input type="number" class="form-input set-rest" value="${set.rest}" style="flex:1;" required><button type="button" class="btn-remove-set" onclick="this.parentElement.remove(); calculateSportDuration();">X</button>`; document.getElementById('sport-sets-container').appendChild(row); }); document.getElementById('sport-edit-index').value = i; document.getElementById('sport-cancel-edit-btn').style.display = 'block'; document.getElementById('sport-form-title').innerText = '✏️ Edit Latihan'; calculateSportDuration(); bindSetCalculation(); };
    document.getElementById('sport-cancel-edit-btn').onclick = () => { document.getElementById('sport-form').reset(); document.getElementById('sport-edit-index').value = "-1"; document.getElementById('sport-cancel-edit-btn').style.display = 'none'; document.getElementById('sport-form-title').innerText = '+ Catat Latihan Baru'; document.getElementById('sport-sets-container').innerHTML = `<div class="sport-set-row" style="display:flex; gap:10px; margin-top:10px;"><input type="text" class="form-input set-name" placeholder="Gerakan" style="flex:2;" required><input type="number" class="form-input set-dur" placeholder="Kerja (Mnt)" style="flex:1;" required><input type="number" class="form-input set-rest" placeholder="Rest (Mnt)" style="flex:1;" required></div>`; document.getElementById('sport-auto-duration').innerText = "0 Menit"; bindSetCalculation(); };
    document.getElementById('sport-form').onsubmit = (e) => { e.preventDefault(); if(!sportData[currentSportDateStr]) sportData[currentSportDateStr]=[]; let sets = []; document.querySelectorAll('.sport-set-row').forEach(row => { sets.push({ name: row.querySelector('.set-name').value, dur: row.querySelector('.set-dur').value, rest: row.querySelector('.set-rest').value }); }); let lateR = document.getElementById('sport-late-reason').value; let newData = {time: document.getElementById('sport-time').value, type: document.getElementById('sport-type').value, target: document.getElementById('sport-target').value, achieved: document.getElementById('sport-achieved').value, notes: document.getElementById('sport-notes').value, sets: sets, totalDur: calculateSportDuration(), lateReason: lateR }; let idx = parseInt(document.getElementById('sport-edit-index').value); if(idx > -1) sportData[currentSportDateStr][idx] = newData; else sportData[currentSportDateStr].push(newData); saveData('sport_data_v1', sportData); document.getElementById('sport-cancel-edit-btn').click(); openSportModal(currentSportDateStr, new Date(currentSportDateStr).getDate()); renderSportCalendar(); };

    // ==========================================
    // 5. MODUL HISTORY KEKAYAAN
    // ==========================================
    const WL_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
    const WL_DEL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/></svg>';
    function wealthMonthLabel(d) { const m = String(d || '').match(/^(\d{4})-(\d{2})/); return m ? `${monthNames[parseInt(m[2], 10) - 1].slice(0, 3)} ${m[1]}` : String(d || '-'); }
    function wealthRowHtml(item, idx, amt) {
        return `<div class="wr-date">${escHtml(wealthMonthLabel(item.date))}</div><div class="wr-text"><b>${escHtml(item.note || '-')}</b><small>${escHtml(item.date || '')}</small></div><div class="wr-amt">${formatRupiah(amt)}</div><div class="action-group"><button type="button" class="edit-btn" aria-label="Ubah" onclick="editWealthItem(${idx})">${WL_EDIT}</button><button type="button" class="del-btn" aria-label="Hapus" onclick="deleteWealthItem(${idx})">${WL_DEL}</button></div>`;
    }
    function renderWealthMonthly() {
        const el = document.getElementById('wealth-monthly'); if (!el) return;
        const mp = {};
        wealthData.items.forEach(i => { const k = String(i.date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(k)) return; mp[k] = mp[k] || { inc: 0, exp: 0 }; if (i.type === 'income') mp[k].inc += parseFloat(i.amount) || 0; else mp[k].exp += parseFloat(i.amount) || 0; });
        const keys = Object.keys(mp).sort().reverse().slice(0, 12);
        if (!keys.length) { el.innerHTML = '<div class="empty-note">Belum ada catatan keuangan.</div>'; return; }
        el.innerHTML = `<div class="wm-row wm-hd"><span>Bulan</span><span>Pendapatan</span><span>Pengeluaran</span><span>Selisih</span></div>` + keys.map(k => { const v = mp[k]; const net = v.inc - v.exp; return `<div class="wm-row"><span class="wm-m">${wealthMonthLabel(k)}</span><span class="wm-inc">${formatRupiah(v.inc)}</span><span class="wm-exp">${v.exp ? formatRupiah(v.exp) : '-'}</span><span class="wm-net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '-'}${formatRupiah(Math.abs(net))}</span></div>`; }).join('');
    }
    // Daftar pendapatan/pengeluaran dikelompokkan per bulan (buka-tutup) supaya tidak perlu scroll panjang.
    const wealthOpenMonths = new Set(); const wealthInit = { income: false, expense: false }; let wealthTab = 'income';
    function wealthGroupsHtml(items, sortType, kind, limit) {
        const groups = {};
        items.forEach(it => { const k = String(it.date || '').slice(0, 7) || '-'; (groups[k] = groups[k] || []).push(it); });
        const total = k => groups[k].reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
        let keys = Object.keys(groups);
        if (sortType === 'terbesar') keys.sort((a, b) => total(b) - total(a));
        else if (sortType === 'terkecil') keys.sort((a, b) => total(a) - total(b));
        else if (sortType === 'terlama') keys.sort();
        else keys.sort().reverse();
        const itemSort = sortType === 'terbesar' ? (a, b) => parseFloat(b.amount) - parseFloat(a.amount) : sortType === 'terkecil' ? (a, b) => parseFloat(a.amount) - parseFloat(b.amount) : sortType === 'terlama' ? (a, b) => String(a.date).localeCompare(String(b.date)) : (a, b) => String(b.date).localeCompare(String(a.date));
        if (!keys.length) return '<div class="empty-note">Belum ada data.</div>';
        const allCount = keys.length;
        if (limit !== 'all') keys = keys.slice(0, limit);
        const html = keys.map((k, idx) => {
            const id = kind + '-' + k;
            if (!wealthInit[kind] && idx === 0) wealthOpenMonths.add(id);
            const rows = groups[k].sort(itemSort).map(it => { const realIdx = wealthData.items.indexOf(it); return `<div class="wg-row ${kind}"><div class="wg-text"><b>${escHtml(it.note || '-')}</b><small>${escHtml(it.date || '')}</small></div><div class="wg-amt">${formatRupiah(parseFloat(it.amount) || 0)}</div><div class="action-group"><button type="button" class="edit-btn" aria-label="Ubah" onclick="editWealthItem(${realIdx})">${WL_EDIT}</button><button type="button" class="del-btn" aria-label="Hapus" onclick="deleteWealthItem(${realIdx})">${WL_DEL}</button></div></div>`; }).join('');
            return `<details class="wg ${kind}" data-id="${id}"${wealthOpenMonths.has(id) ? ' open' : ''}><summary><span class="wg-month">${wealthMonthLabel(k)}</span><span class="wg-count">${groups[k].length} catatan</span><b class="wg-total">${formatRupiah(total(k))}</b><svg class="mon-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></summary><div class="wg-rows">${rows}</div></details>`;
        }).join('');
        wealthInit[kind] = true;
        return html + (allCount > keys.length ? `<p class="wg-more">Menampilkan ${keys.length} dari ${allCount} bulan. Ubah pilihan "Tampilkan" untuk melihat lebih banyak.</p>` : '');
    }
    document.addEventListener('toggle', ev => { const d = ev.target; if (d && d.classList && d.classList.contains('wg')) { if (d.open) wealthOpenMonths.add(d.dataset.id); else wealthOpenMonths.delete(d.dataset.id); } }, true);
    window.renderWealthDashboard = function() {
        if(!isLoggedIn) return; let totalIncome = 0; let totalExpense = 0; const wealthListEl = document.getElementById('wealth-list');
        const wealthSort = document.getElementById('wealth-sort')?.value || 'terbaru'; const wlLimitRaw = document.getElementById('wealth-limit')?.value || '5'; const wealthLimit = wlLimitRaw === 'all' ? 'all' : parseInt(wlLimitRaw, 10);
        let incomeItems = wealthData.items.filter(i => i.type === 'income'); let expenseItems = wealthData.items.filter(i => i.type === 'expense');
        const sortFn = (sortType) => (a,b) => { if(sortType === 'terbaru') return b.date.localeCompare(a.date); if(sortType === 'terlama') return a.date.localeCompare(b.date); if(sortType === 'terbesar') return parseFloat(b.amount) - parseFloat(a.amount); if(sortType === 'terkecil') return parseFloat(a.amount) - parseFloat(b.amount); return 0; };
        incomeItems.sort(sortFn(wealthSort)); expenseItems.sort(sortFn(wealthSort));

        incomeItems.forEach(item => { totalIncome += parseFloat(item.amount) || 0; });
        expenseItems.forEach(item => { totalExpense += parseFloat(item.amount) || 0; });
        document.getElementById('wl-sum-income').innerText = formatRupiah(totalIncome);
        document.getElementById('wl-sum-expense').innerText = formatRupiah(totalExpense);
        document.getElementById('wl-tab-income').classList.toggle('active', wealthTab === 'income');
        document.getElementById('wl-tab-expense').classList.toggle('active', wealthTab === 'expense');
        wealthListEl.innerHTML = wealthTab === 'income' ? wealthGroupsHtml(incomeItems, wealthSort, 'income', wealthLimit) : wealthGroupsHtml(expenseItems, wealthSort, 'expense', wealthLimit);

        let expectedSavings = totalIncome - totalExpense; let defisit = expectedSavings - wealthData.realMoney; 
        document.getElementById('wealth-income').innerText = formatRupiah(totalIncome); document.getElementById('wealth-expense').innerText = formatRupiah(totalExpense); document.getElementById('wealth-expected').innerText = formatRupiah(expectedSavings); document.getElementById('wealth-actual').innerText = formatRupiah(wealthData.realMoney);
        
        renderWealthMonthly();
        { const pct = expectedSavings > 0 ? Math.max(0, Math.min(100, wealthData.realMoney / expectedSavings * 100)) : 0;
          document.getElementById('wealth-prog-pct').innerText = pct.toFixed(0) + '%'; document.getElementById('wealth-prog-fill').style.width = pct + '%';
          document.getElementById('wealth-prog-text').innerText = `Uang real time ${formatRupiah(wealthData.realMoney)} dari Tabungan Seharusnya ${formatRupiah(expectedSavings)}`; }
        let minusEl = document.getElementById('wealth-minus');
        if (defisit > 0) { minusEl.innerText = `- ${formatRupiah(defisit)}`; document.getElementById('wealth-recovery-card').style.display = ''; document.getElementById('wealth-recovery-card').style.borderColor = "#ff1744"; document.querySelector('#wealth-recovery-card h2').innerText = "DEFISIT KEUANGAN (Trading & Pengeluaran Tak Terduga)"; document.querySelector('#wealth-recovery-card h2').style.color = "#ff1744"; } 
        else { minusEl.innerText = "Aman"; minusEl.style.color = "#00e676"; document.getElementById('wealth-recovery-card').style.borderColor = "#00e676"; document.querySelector('#wealth-recovery-card h2').innerText = "TABUNGAN SURPLUS"; document.querySelector('#wealth-recovery-card h2').style.color = "#00e676"; }
    }

    document.getElementById('wl-tab-income').onclick = () => { wealthTab = 'income'; renderWealthDashboard(); };
    document.getElementById('wl-tab-expense').onclick = () => { wealthTab = 'expense'; renderWealthDashboard(); };
    window.openWealthModal = () => { document.getElementById('wealth-form').reset(); document.getElementById('wealth-edit-index').value = "-1"; document.getElementById('wealth-modal-title').innerText = "+ Catat Keuangan"; document.getElementById('wealth-cancel-edit-btn').style.display = "none"; document.getElementById('wealth-modal').style.display = 'flex'; };
    window.editWealthItem = (idx) => { let item = wealthData.items[idx]; document.getElementById('wealth-type').value = item.type; document.getElementById('wealth-date').value = item.date; document.getElementById('wealth-amount').value = item.amount; document.getElementById('wealth-notes').value = item.note; document.getElementById('wealth-edit-index').value = idx; document.getElementById('wealth-modal-title').innerText = "✏️ Edit Catatan Keuangan"; document.getElementById('wealth-cancel-edit-btn').style.display = "block"; document.getElementById('wealth-modal').style.display = 'flex'; };
    document.getElementById('wealth-cancel-edit-btn').onclick = () => { document.getElementById('wealth-modal').style.display = 'none'; };
    document.getElementById('wealth-form').onsubmit = (e) => { e.preventDefault(); showConfirm("Yakin mau simpan perubahan data kekayaan ini?", () => { let idx = parseInt(document.getElementById('wealth-edit-index').value); let newData = { type: document.getElementById('wealth-type').value, date: document.getElementById('wealth-date').value, amount: document.getElementById('wealth-amount').value, note: document.getElementById('wealth-notes').value }; if (idx > -1) { newData.id = wealthData.items[idx].id; wealthData.items[idx] = newData; } else { newData.id = Date.now(); wealthData.items.push(newData); } saveData('wealth_data_v1', wealthData); document.getElementById('wealth-modal').style.display = 'none'; renderWealthDashboard(); }); };
    window.deleteWealthItem = (idx) => { showConfirm("Yakin hapus data historis ini? Perhitungan tabungan akan berubah loh!", () => { wealthData.items.splice(idx, 1); saveData('wealth_data_v1', wealthData); renderWealthDashboard(); }); };
    document.getElementById('btn-save-rt').onclick = () => { let rt = parseFloat(document.getElementById('wealth-rt-amount').value); if(!isNaN(rt)) { showConfirm("Yakin update Uang Real Time ini?", () => { wealthData.realMoney = rt; saveData('wealth_data_v1', wealthData); document.getElementById('wealth-modal-rt').style.display = 'none'; renderWealthDashboard(); }); } };

    // ==========================================
    // MODUL TRADING AI CURRENCY (multi-instrumen) - VPS-only compute (ai-tick-currency.py),
    // browser di sini CUMA baca & tampilin, kecuali aksi eksplisit: Master Setting, restart bot,
    // kirim summary, export, reset data, & ubah modal simulasi.
    // ==========================================
    const CURRENCY_MASTER_DEFAULTS = {
        slPips: 50, slMode: 'fixed', atrMultiplier: 1.5, tpLayerPips: [80, 100, 150], lotSize: 0.1, layerStaggerPips: 10,
        lockPipsAfterTp1: 10, deepLockTriggerPips: 100, deepLockPips: 80, deepLockTimeoutMinutes: 15,
        // winrateMinSamples dinaikkan 5->10 (2026-07-16, dari evaluasi AI lain) - lihat catatan sama di AI_MASTER_DEFAULTS Gold.
        minSignalWinrate: 35, winrateLookbackDays: 14, winrateMinSamples: 10,
        newsPreMinutes: 10, newsPostMinutes: 40,
        riskLimitPct: 10, riskPeriod: 'monthly',
        pipValueUnit: 'cent', pipValuePerLot: 1,
        tpMode: 'fixed', l3TpAtrMode: false, l3TpAtrMultiplier: 0.6,
        lotScaleThreshold1Pips: 150, lotScaleLot1: 0.05, lotScaleThreshold2Pips: 250, lotScaleLot2: 0.03,
        lotScaleThreshold3Pips: 500, lotScaleLot3: 0.02,
        summaryIntervalHours: 6, methodTwoEnabled: false
    };
    const CUR_SIGNAL_LABELS = SIGNAL_TYPE_LABELS;

    (function populateCurPairSelect() {
        const sel = document.getElementById('cur-pair-select');
        if (sel) sel.innerHTML = CURRENCY_PAIRS.map(p => `<option value="${p}">${p}</option>`).join('');
    })();

    function currentCurPair() {
        const sel = document.getElementById('cur-pair-select');
        return (sel && sel.value) || CURRENCY_PAIRS[0];
    }
    function getCurInstrument(pairKey) { return currencyInstruments[pairKey] || {}; }
    function getCurMasterSettings(pairKey) {
        const inst = getCurInstrument(pairKey);
        return Object.assign({}, CURRENCY_MASTER_DEFAULTS, ((inst.aiSettings || {}).master) || {});
    }
    // Sama kayak findOpenAiTrade(signalTypes) tapi nerima tradeData sbg parameter (bukan baca aiTradeData global punya Gold).
    function findOpenTradeIn(tradeData, signalTypes) {
        for (const d in tradeData) {
            const list = tradeData[d];
            for (let i = 0; i < list.length; i++) {
                if (list[i].status === 'open' && (!signalTypes || signalTypes.has(list[i].signalType))) return { dateKey: d, index: i, trade: list[i] };
            }
        }
        return null;
    }
    function sumClosedPl(trades) {
        const closed = trades.filter(t => t.status === 'closed');
        return { total: closed.reduce((s, t) => s + parseFloat(t.pl || 0), 0), count: closed.length };
    }
    function curTodayPl(tradeData) {
        const d = new Date(); const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return sumClosedPl(tradeData[dateStr] || []);
    }
    function curWeekPl(tradeData) {
        const d = new Date(); const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        let total = 0, count = 0;
        Object.keys(tradeData).forEach(dateStr => { if (dateStr < mondayStr) return; const r = sumClosedPl(tradeData[dateStr]); total += r.total; count += r.count; });
        return { total, count };
    }
    function curAllPl(tradeData) {
        let total = 0, count = 0;
        Object.values(tradeData).forEach(list => { const r = sumClosedPl(list); total += r.total; count += r.count; });
        return { total, count };
    }
    // lookbackDays/minSamples ikutin Master Setting pair yang lagi aktif (bukan hardcode) - biar angka yang
    // ditampilin cocok sama ambang yang beneran dipakai filter sinyal bot, gak nyesatin kalau user ubah setting.
    function curWinRate(tradeData, signalType, lookbackDays, minSamples) {
        const cutoff = Date.now() - lookbackDays * 86400000;
        let total = 0, win = 0;
        for (const d in tradeData) {
            if (new Date(d).getTime() < cutoff) continue;
            tradeData[d].forEach(t => { if (t.status !== 'closed' || t.signalType !== signalType) return; total++; if (parseFloat(t.pl || 0) >= 0) win++; });
        }
        return total >= minSamples ? (win / total) * 100 : null;
    }

    function updateCurPositionBox(entryElId, plElId, openInfo) {
        const entryEl = document.getElementById(entryElId); const plEl = document.getElementById(plElId);
        if (!entryEl || !plEl) return;
        if (!openInfo) { entryEl.innerText = 'Belum ada posisi'; entryEl.className = 'netral'; plEl.innerText = '-'; plEl.className = 'netral'; return; }
        const trade = openInfo.trade;
        entryEl.innerText = `${trade.arah} @ ${parseFloat(trade.entry).toFixed(5)}`;
        entryEl.className = trade.arah === 'BUY' ? 'profit-text' : 'loss-text';
        plEl.innerText = 'Sedang open — cek Telegram utk floating P/L live';
        plEl.className = 'netral';
    }

    // ---- Tab "Live Status" (Poin D: chart candlestick H1 gratis dari MT5 + trend/RSI/MACD) ----
    const CUR_LIVE_PRICE_MAX_AGE_SECONDS = 45;
    function updateCurLivePriceBox(pairKey) {
        const priceEl = document.getElementById('cur-live-price');
        if (!priceEl) return;
        const updatedAt = currencyLivePriceUpdatedAt[pairKey];
        const liveAgeSec = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 1000 : Infinity;
        const candles = currencyLiveCandles[pairKey];
        if (currencyLivePrice[pairKey] != null && liveAgeSec <= CUR_LIVE_PRICE_MAX_AGE_SECONDS) priceEl.innerText = parseFloat(currencyLivePrice[pairKey]).toFixed(5);
        else if (candles && candles.length) priceEl.innerText = candles[candles.length - 1].close.toFixed(5);
        else priceEl.innerText = '-';
    }
    // Reuse calcSMA/calcRSI/calcMACD (udah generic, dipakai bareng sama Gold) - cuma beda sumber candle & target DOM id.
    function updateCurTrendSummary(pairKey) {
        const trendEl = document.getElementById('cur-trend-summary-trend');
        const candles = currencyLiveCandles[pairKey];
        if (!trendEl || !candles || candles.length < 35) return;
        const rsiEl = document.getElementById('cur-trend-summary-rsi');
        const macdEl = document.getElementById('cur-trend-summary-macd');
        const closes = candles.map(c => c.close);
        const ma20 = calcSMA(closes, 20), ma50 = calcSMA(closes, 50), rsi = calcRSI(closes, 14), macd = calcMACD(closes);
        if (ma20 !== null && ma50 !== null) {
            const up = ma20 > ma50;
            trendEl.innerHTML = up ? 'Naik' : 'Turun';
            trendEl.className = up ? 'profit-text' : 'loss-text';
        }
        if (rsi !== null) {
            const extreme = rsi >= 70 || rsi <= 30;
            const zone = rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : 'Netral';
            rsiEl.innerHTML = `${rsi.toFixed(1)} <span style="font-size:0.6em;">(${zone})</span>`;
            rsiEl.className = extreme ? '' : 'netral';
            rsiEl.style.color = extreme ? '#ff9800' : '';
        }
        if (macd) {
            const bullish = macd.macd > macd.signal;
            macdEl.innerHTML = bullish ? 'Bullish' : 'Bearish';
            macdEl.className = bullish ? 'profit-text' : 'loss-text';
        }
    }
    let curChart = null; let curCandleSeries = null; let curPriceLines = [];
    function clearCurPriceLines() {
        if (!curCandleSeries) return;
        curPriceLines.forEach(line => curCandleSeries.removePriceLine(line));
        curPriceLines = [];
    }
    function updateCurTradeLines(trade) {
        clearCurPriceLines();
        if (!trade.layers) return;
        curPriceLines.push(curCandleSeries.createPriceLine({ price: parseFloat(trade.entry), color: '#ffd700', lineWidth: 1, lineStyle: 2, title: 'Entry' }));
        trade.layers.forEach((ly, i) => {
            if (ly.status === 'pending') {
                curPriceLines.push(curCandleSeries.createPriceLine({ price: parseFloat(ly.entry), color: '#888', lineWidth: 1, lineStyle: 3, title: `Pending${i + 1}` }));
                return;
            }
            if (ly.status !== 'open') return;
            curPriceLines.push(curCandleSeries.createPriceLine({ price: parseFloat(ly.tp), color: '#00e676', lineWidth: 1, lineStyle: 2, title: `TP${i + 1}` }));
            const slPrice = ly.sl !== undefined ? ly.sl : trade.sl;
            curPriceLines.push(curCandleSeries.createPriceLine({ price: parseFloat(slPrice), color: ly.slMoved ? '#2196f3' : '#ff1744', lineWidth: 1, lineStyle: 2, title: ly.slMoved ? `BE${i + 1}` : `SL${i + 1}` }));
        });
    }
    // Reuse ensureLightweightChartsLoaded (punya Gold, load library sekali doang) - chart instance-nya sendiri
    // (curChart/curCandleSeries) terpisah dari punya Gold (container DOM beda: cur-chart-container).
    function renderCurLightweightChart(pairKey) {
        const candles = currencyLiveCandles[pairKey];
        if (!candles || !candles.length) return;
        ensureLightweightChartsLoaded(() => {
            const container = document.getElementById('cur-chart-container');
            if (!curChart) {
                curChart = LightweightCharts.createChart(container, {
                    width: container.clientWidth, height: 500,
                    layout: { background: { color: '#1e1e1e' }, textColor: '#ccc' },
                    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
                    timeScale: { timeVisible: true }
                });
                applyChartTheme();
                curCandleSeries = curChart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff1744', borderVisible: false, wickUpColor: '#00e676', wickDownColor: '#ff1744' });
                window.addEventListener('resize', () => { if (curChart) curChart.applyOptions({ width: container.clientWidth }); });
            }
            curCandleSeries.setData(candles.map(c => ({ time: Math.floor(new Date(c.time).getTime() / 1000), open: c.open, high: c.high, low: c.low, close: c.close })));
            const openInfo = findOpenTradeIn(getCurInstrument(pairKey).aiTradeData || {}, AI_METHOD_GROUPS.method1);
            if (openInfo) updateCurTradeLines(openInfo.trade); else clearCurPriceLines();
            updateCurTrendSummary(pairKey);
        });
    }

    function updateCurLiveStatusBoxes(pairKey) {
        const inst = getCurInstrument(pairKey);
        const tradeData = inst.aiTradeData || {};
        const m = getCurMasterSettings(pairKey);

        document.getElementById('cur-chart-pair-label').innerText = pairKey;
        document.getElementById('cur-method2-section').style.display = m.methodTwoEnabled ? '' : 'none';

        const openM1 = findOpenTradeIn(tradeData, AI_METHOD_GROUPS.method1);
        updateCurPositionBox('cur-live-entry', 'cur-live-total-pl', openM1);
        // Gak ada posisi open buat nentuin signalType pasti - default tampilin winrate trend_following (kasus paling umum).
        const wr1 = curWinRate(tradeData, openM1 ? openM1.trade.signalType : 'trend_following', m.winrateLookbackDays, m.winrateMinSamples);
        document.getElementById('cur-winrate-m1').innerText = wr1 === null ? 'Belum cukup data' : `${wr1.toFixed(0)}%`;
        document.getElementById('cur-winrate-m1-days').innerText = m.winrateLookbackDays;

        if (m.methodTwoEnabled) {
            const openM2 = findOpenTradeIn(tradeData, AI_METHOD_GROUPS.method2);
            updateCurPositionBox('cur-live-entry-m2', 'cur-live-total-pl-m2', openM2);
            const wr2 = curWinRate(tradeData, 'ict_liquidity_sweep', m.winrateLookbackDays, m.winrateMinSamples);
            document.getElementById('cur-winrate-m2').innerText = wr2 === null ? 'Belum cukup data' : `${wr2.toFixed(0)}%`;
            document.getElementById('cur-winrate-m2-days').innerText = m.winrateLookbackDays;
        }

        const today = curTodayPl(tradeData), week = curWeekPl(tradeData), all = curAllPl(tradeData);
        const setPl = (id, r) => { const el = document.getElementById(id); el.innerText = `${r.total >= 0 ? '+' : ''}${formatRupiah(r.total)} (${r.count})`; el.className = r.total >= 0 ? 'profit-text' : 'loss-text'; };
        setPl('cur-pl-today', today); setPl('cur-pl-week', week); setPl('cur-pl-all', all);
        updateCurLivePriceBox(pairKey);
    }
    function renderCurMarketTab(pairKey) {
        updateCurLiveStatusBoxes(pairKey);
        renderCurLightweightChart(pairKey);
    }

    // ---- Tab "Riwayat" (Poin A/B: kalender + Modal Simulasi/Pertumbuhan) ----
    function renderCurCalendar(pairKey) {
        const cal = document.getElementById('cur-calendar'); cal.innerHTML = '';
        const inst = getCurInstrument(pairKey);
        const tradeData = inst.aiTradeData || {};
        document.getElementById('cur-cal-pair-label').innerText = pairKey;
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('cur-month-year-display').innerText = `${monthNames[m]} ${y}`;
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let totalBulan = 0;

        for (let w = 0; w < Math.ceil((firstDay + daysInMonth) / 7); w++) {
            let weeklyPl = 0; let hasData = false;
            for (let d = 0; d < 7; d++) {
                const dayNum = (w * 7 + d) - firstDay + 1;
                if (dayNum > 0 && dayNum <= daysInMonth) {
                    const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const trades = tradeData[fDate] || []; let dayPl = 0;
                    if (trades.length > 0) { hasData = true; trades.forEach(t => dayPl += parseFloat(t.pl || 0)); weeklyPl += dayPl; totalBulan += dayPl; }
                    const card = document.createElement('div'); card.className = `day-card ${dayPl > 0 ? 'profit' : dayPl < 0 ? 'loss' : ''}`;
                    card.innerHTML = `${trades.length > 0 ? `<span class="trade-count">${trades.length}</span>` : ''}<div class="day-number">${dayNum}</div>${trades.length > 0 ? `<span class="day-pl ${dayPl > 0 ? 'profit-text' : dayPl < 0 ? 'loss-text' : ''}">${dayPl > 0 ? '+' : ''}${formatRupiah(dayPl)}</span>` : ''}`;
                    card.onclick = () => openCurModal(pairKey, fDate, dayNum);
                    cal.appendChild(card);
                } else cal.appendChild(Object.assign(document.createElement('div'), { className: 'empty-card' }));
            }
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData ? (weeklyPl > 0 ? 'weekly-profit' : (weeklyPl < 0 ? 'weekly-loss' : '')) : 'empty-card'}`;
            if (hasData) wCard.innerHTML = `<div class="week-title">Mg ${w + 1}</div><div class="week-pl ${weeklyPl > 0 ? 'profit-text' : 'loss-text'}">${weeklyPl > 0 ? '+' : ''}${formatRupiah(weeklyPl)}</div>`;
            cal.appendChild(wCard);
        }
        const totalEl = document.getElementById('cur-monthly-total'); totalEl.innerText = formatRupiah(totalBulan); totalEl.className = totalBulan > 0 ? 'profit-text' : (totalBulan < 0 ? 'loss-text' : 'netral');
        document.getElementById('cur-base-equity').innerText = formatRupiah(inst.aiModalAwal || 2500000);
        updateCurEquity(pairKey, y, m);
    }
    document.getElementById('cur-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderCurCalendar(currentCurPair()); };
    document.getElementById('cur-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderCurCalendar(currentCurPair()); };

    function updateCurEquity(pairKey, vY, vM) {
        const inst = getCurInstrument(pairKey);
        const tradeData = inst.aiTradeData || {};
        const modalAwal = inst.aiModalAwal || 2500000;
        const resetAt = inst.aiModalResetAt || null;
        // Sama kayak updateAiEquity Gold: bulan sebelum resetAt pakai modal LAMA & histori penuh (gak di-cutoff).
        const monthPrefix = `${vY}-${String(vM + 1).padStart(2, '0')}`;
        const isPreReset = !!(resetAt && monthPrefix < resetAt.slice(0, 7));
        const baseModal = isPreReset ? (inst.aiModalBeforeReset || modalAwal) : modalAwal;
        const cutoff = isPreReset ? null : resetAt;
        let sumBefore = 0; let sumDuring = 0;
        for (const d in tradeData) {
            if (cutoff && d < cutoff) continue;
            let tY = new Date(d).getFullYear(); let tM = new Date(d).getMonth(); let dt = 0;
            tradeData[d].forEach(t => dt += parseFloat(t.pl || 0));
            if (tY < vY || (tY === vY && tM < vM)) sumBefore += dt; else if (tY === vY && tM === vM) sumDuring += dt;
        }
        let stEq = baseModal + sumBefore; let enEq = stEq + sumDuring;
        document.getElementById('cur-base-equity').innerText = formatRupiah(baseModal);
        document.getElementById('cur-start-equity').innerText = formatRupiah(stEq);
        document.getElementById('cur-current-equity').innerText = formatRupiah(enEq);
        document.getElementById('cur-equity-growth').innerHTML = sumDuring > 0 ? `<span style="color:#00e676;">+${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : (sumDuring < 0 ? `<span style="color:#ff1744;">${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : `<span style="color:#aaa;">0.00%</span>`);
    }
    document.getElementById('cur-modal-box').onclick = () => {
        const pairKey = currentCurPair();
        const inst = getCurInstrument(pairKey);
        const current = inst.aiModalAwal || 2500000;
        const val = prompt(`Masukkan modal simulasi baru buat ${pairKey} (Rp):`, current);
        if (val === null) return;
        const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        if (isNaN(num) || num <= 0) { alert('Angka gak valid.'); return; }
        if (!auth.currentUser) { alert('Login dulu biar tersimpan ke cloud.'); return; }
        const todayStr = new Date().toISOString().slice(0, 10);
        const resetVal = prompt(`Modal ${pairKey} ini berlaku efektif mulai tanggal berapa? Histori SEBELUM tanggal ini tetap kesimpen & bisa dilihat lagi (Equity-nya pun tetap kebaca pakai modal LAMA), cuma gak ikut dihitung ke Equity Awal/Akhir mulai tanggal ini.\n\nKosongin isinya kalau mau berlaku retroaktif ke semua histori (perilaku lama). Format: YYYY-MM-DD`, inst.aiModalResetAt || todayStr);
        const update = { aiModalAwal: num };
        if (resetVal !== null) {
            const newResetAt = resetVal.trim() || null;
            update.aiModalResetAt = newResetAt;
            if (newResetAt) {
                const beforeVal = prompt(`Modal ${pairKey} yang BERLAKU SEBELUM ${newResetAt} (dipakai biar bulan-bulan lama tetap kebaca akurat pas di-browse ulang):`, inst.aiModalBeforeReset || current);
                const beforeNum = beforeVal !== null ? parseFloat(String(beforeVal).replace(/[^0-9.]/g, '')) : NaN;
                update.aiModalBeforeReset = !isNaN(beforeNum) && beforeNum > 0 ? beforeNum : (inst.aiModalBeforeReset || current);
            } else {
                update.aiModalBeforeReset = null;
            }
        }
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set(update, { merge: true })
            .catch(err => alert('Gagal simpan modal: ' + err.message));
    };

    // Reuse AI_LAYER_STATUS_LABEL/formatAiTime/toggleAiHistDetail (punya Gold, generic gak nyimpang per instrumen).
    function openCurModal(pairKey, dateStr, dayNum) {
        const tradeData = getCurInstrument(pairKey).aiTradeData || {};
        document.getElementById('cur-modal-date-title').innerText = pairKey + ' · ' + entryModalTitle(dateStr, dayNum).replace('Entry Simulasi · ', '');
        document.getElementById('cur-today-history').innerHTML = entryListHtml(tradeData[dateStr] || [], pairKey.endsWith('JPY') ? 3 : 5);
        document.getElementById('cur-entry-modal').style.display = 'flex';
    }
    document.getElementById('close-cur-modal').onclick = () => document.getElementById('cur-entry-modal').style.display = 'none';

    // ---- Tab "Dashboard Evaluasi" (Poin C) ----
    let curPlChartInstance = null; let curWinRateChartInstance = null;
    let lastCurDashboardStats = null;
    function renderCurDashboard(pairKey) {
        const tradeData = getCurInstrument(pairKey).aiTradeData || {};
        const modalAwal = getCurInstrument(pairKey).aiModalAwal || 2500000;
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('cur-dash-month-year-display').innerText = `${monthNames[m]} ${y}`;

        let monthHasData = false; let monthPl = 0; let winCount = 0; let lossCount = 0;
        let maxWin = { pl: 0, date: '-', detail: '-' }; let maxLoss = { pl: 0, date: '-', detail: '-' };
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let weeklyReports = []; for (let i = 0; i < Math.ceil((firstDay + daysInMonth) / 7); i++) weeklyReports.push({ wins: 0, losses: 0, pl: 0, hasData: false });
        let tableRows = [];
        let chartLabels = [], profitDataArr = [], lossDataArr = [];

        for (let i = 1; i <= daysInMonth; i++) {
            const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const trades = tradeData[fDate] || []; let wIdx = Math.floor((firstDay + i - 1) / 7);
            if (trades.length > 0) {
                monthHasData = true; weeklyReports[wIdx].hasData = true;
                let dailyProfit = 0, dailyLoss = 0;
                trades.forEach(t => {
                    let p = parseFloat(t.pl || 0); monthPl += p;
                    if (t.status === 'closed') { if (p >= 0) { winCount++; weeklyReports[wIdx].wins++; dailyProfit += p; } else { lossCount++; weeklyReports[wIdx].losses++; dailyLoss += p; } }
                    weeklyReports[wIdx].pl += p;
                    if (p > maxWin.pl) maxWin = { pl: p, date: fDate, detail: t.alasan };
                    if (p < maxLoss.pl) maxLoss = { pl: p, date: fDate, detail: t.alasan };
                    tableRows.push({ date: fDate, ...t, plVal: p });
                });
                chartLabels.push(`Tgl ${i}`); profitDataArr.push(dailyProfit); lossDataArr.push(dailyLoss);
            }
        }

        const emptyState = document.getElementById('cur-empty-state'); const dashContent = document.getElementById('cur-dash-content');
        if (!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; return; }
        emptyState.style.display = 'none'; dashContent.style.display = 'block';

        const masterS = getCurMasterSettings(pairKey);
        const riskPeriodLabel = masterS.riskPeriod === 'weekly' ? 'minggu' : 'bulan';
        const periodPl = masterS.riskPeriod === 'weekly' ? curWeekPl(tradeData).total : monthPl;
        const riskLimit = modalAwal * (masterS.riskLimitPct / 100);
        const usedPct = periodPl < 0 ? Math.min((Math.abs(periodPl) / riskLimit) * 100, 999) : 0;
        const riskBox = document.getElementById('cur-risk-insight');
        if (periodPl >= 0) riskBox.innerHTML = `<div class="insight-box insight-success">Aman! ${riskPeriodLabel === 'minggu' ? 'Minggu' : 'Bulan'} ini masih profit ${formatRupiah(periodPl)}, belum kepakai risk budget.</div>`;
        else if (usedPct < 70) riskBox.innerHTML = `<div class="insight-box insight-success">Risk terpakai ${usedPct.toFixed(0)}% dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel} (${formatRupiah(Math.abs(periodPl))} dari ${formatRupiah(riskLimit)}).</div>`;
        else if (usedPct < 100) riskBox.innerHTML = `<div class="insight-box insight-warning">Waspada! Risk terpakai ${usedPct.toFixed(0)}% dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel}. Kurangi ukuran posisi.</div>`;
        else riskBox.innerHTML = `<div class="insight-box insight-danger">LIMIT TERLAMPAUI! Rugi ${riskPeriodLabel} ini ${formatRupiah(Math.abs(periodPl))}, lewat batas ${masterS.riskLimitPct}% modal (${formatRupiah(riskLimit)}). STOP entry baru ${riskPeriodLabel} ini.</div>`;

        let closedTrades = tableRows.filter(t => t.status === 'closed');
        let overboughtMistakes = closedTrades.filter(t => t.arah === 'BUY' && t.alasan && t.alasan.toLowerCase().includes('overbought')).length;
        let oversoldMistakes = closedTrades.filter(t => t.arah === 'SELL' && t.alasan && t.alasan.toLowerCase().includes('oversold')).length;
        let winRate = closedTrades.length > 0 ? ((winCount / closedTrades.length) * 100).toFixed(0) : 0;
        document.getElementById('cur-eval-text').innerHTML = `<ul style="padding-left:20px;"><li>Total entry simulasi bulan ini: <strong>${tableRows.length}</strong> (${closedTrades.length} closed, win rate ${winRate}%).</li><li>Risk budget terpakai: <strong>${periodPl < 0 ? usedPct.toFixed(0) : 0}%</strong> dari limit ${masterS.riskLimitPct}%/${riskPeriodLabel}.</li>${overboughtMistakes > 0 ? `<li style="color:#ff9800;">${overboughtMistakes}x entry BUY meski overbought — tunggu koreksi dulu.</li>` : ''}${oversoldMistakes > 0 ? `<li style="color:#ff9800;">${oversoldMistakes}x entry SELL meski oversold — tunggu rebound dulu.</li>` : ''}${winRate >= 50 && closedTrades.length >= 3 ? `<li style="color:#00e676;">Win rate di atas 50%, konsistensi mulai terbentuk. Pertahankan!</li>` : ''}</ul>`;

        let signalStats = {};
        closedTrades.forEach(t => {
            const type = t.signalType || 'lainnya';
            if (!signalStats[type]) signalStats[type] = { total: 0, win: 0 };
            signalStats[type].total++;
            if (t.plVal >= 0) signalStats[type].win++;
        });
        const signalGrid = document.getElementById('cur-signal-stats-grid');
        const signalEntries = Object.entries(signalStats);
        signalGrid.innerHTML = signalEntries.length ? signalEntries.map(([type, s]) => {
            const wr = ((s.win / s.total) * 100).toFixed(0);
            return `<div class="weekly-card"><h4>${CUR_SIGNAL_LABELS[type] || type}</h4><p><span>Total Entry:</span> <strong>${s.total}</strong></p><p style="border-top:1px dotted #444; padding-top:5px;"><span>Win Rate:</span> <strong class="${wr >= 50 ? 'profit-text' : 'loss-text'}">${wr}%</strong></p></div>`;
        }).join('') : '<p style="color:#888; grid-column:1/-1;">Belum ada entry closed bulan ini.</p>';

        const wGrid = document.getElementById('cur-weekly-breakdown-grid'); wGrid.innerHTML = '';
        weeklyReports.forEach((wr, idx) => { if (wr.hasData) wGrid.innerHTML += `<div class="weekly-card ${wr.pl > 0 ? 'week-profit' : (wr.pl < 0 ? 'week-loss' : '')}"><h4>Minggu ${idx + 1}</h4><p><span>Win:</span> <span style="color:#00e676;">${wr.wins}x</span></p><p><span>Loss:</span> <span style="color:#ff1744;">${wr.losses}x</span></p><p style="border-top:1px dotted #444; padding-top:5px;"><span>Hasil:</span> <strong class="${wr.pl > 0 ? 'profit-text' : 'loss-text'}">${wr.pl > 0 ? '+' : ''}${formatRupiah(wr.pl)}</strong></p></div>`; });

        document.getElementById('cur-highest-win-pl').innerText = maxWin.pl > 0 ? `+${formatRupiah(maxWin.pl)}` : 'Rp 0'; document.getElementById('cur-highest-win-desc').innerText = maxWin.date !== '-' ? `[${maxWin.date}] ${maxWin.detail}` : '-';
        document.getElementById('cur-highest-loss-pl').innerText = maxLoss.pl < 0 ? formatRupiah(maxLoss.pl) : 'Rp 0'; document.getElementById('cur-highest-loss-desc').innerText = maxLoss.date !== '-' ? `[${maxLoss.date}] ${maxLoss.detail}` : '-';

        if (curPlChartInstance) curPlChartInstance.destroy();
        curPlChartInstance = new Chart(document.getElementById('cur-plChart').getContext('2d'), {
            type: 'bar',
            data: { labels: chartLabels, datasets: [
                { label: 'Total Profit', data: profitDataArr, backgroundColor: '#00e676', borderRadius: 4 },
                { label: 'Total Loss', data: lossDataArr, backgroundColor: '#ff1744', borderRadius: 4 }
            ]},
            options: {
                maintainAspectRatio: false,
                scales: { x: { stacked: true }, y: { stacked: true } },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { footer: function(tooltipItems) { let total = 0; tooltipItems.forEach(function(ti) { total += ti.parsed.y; }); return 'Net P/L: ' + formatRupiah(total); } } }
                }
            }
        });

        if (curWinRateChartInstance) curWinRateChartInstance.destroy();
        curWinRateChartInstance = new Chart(document.getElementById('cur-winRateChart').getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['Win', 'Loss'], datasets: [{ data: [winCount, lossCount], backgroundColor: ['#00e676', '#ff1744'], borderWidth: 0 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        let curWinPct = closedTrades.length > 0 ? Math.round((winCount / closedTrades.length) * 100) : 0;
        let curLossPct = closedTrades.length > 0 ? 100 - curWinPct : 0;
        document.getElementById('cur-win-rate-text').innerHTML = `<span style="font-size:1.5rem;">${curWinPct}% Win</span><span style="font-size:1.1rem; color:#ff1744;">${curLossPct}% Loss</span>`;

        curTableMaster = tableRows;
        curTableCurrentPage = 1;
        renderCurTable();

        // Snapshot angka yang UDAH dihitung di atas - dipakai tombol "Analisa AI", gak hitung ulang apa-apa.
        lastCurDashboardStats = {
            totalEntries: tableRows.length, closedCount: closedTrades.length, winRate,
            monthPl, usedPct: periodPl < 0 ? usedPct.toFixed(0) : 0, riskLimitPct: masterS.riskLimitPct, riskPeriodLabel,
            signalStats, weeklyReports, maxWin, maxLoss,
        };
    }
    document.getElementById('cur-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderCurDashboard(currentCurPair()); };
    document.getElementById('cur-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderCurDashboard(currentCurPair()); };
    document.getElementById('btn-cur-llm-recommend').onclick = function() {
        if (!lastCurDashboardStats) { alert('Belum ada data bulan ini buat dianalisa.'); return; }
        requestEvalRecommendation(lastCurDashboardStats, currentCurPair(), 'cur-llm-recommendation', this);
    };

    let curTableMaster = [];
    let curTableSearch = '';
    let curTableSort = { col: 'date', dir: 'desc' };
    let curTablePageSize = 30;
    let curTableCurrentPage = 1;

    function renderCurTable() {
        let rows = [...curTableMaster];
        const q = curTableSearch.trim().toLowerCase();
        if (q) {
            rows = rows.filter(e => {
                const tpDisplay = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join('/') : (e.tp || '');
                return [e.date, e.arah, e.alasan, tpDisplay].some(v => (v || '').toString().toLowerCase().includes(q));
            });
        }
        const { col, dir } = curTableSort;
        rows.sort((a, b) => {
            let va = a[col], vb = b[col];
            if (typeof va === 'string' && typeof vb === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
            return dir === 'asc' ? va - vb : vb - va;
        });

        const total = rows.length;
        const pageSize = curTablePageSize === 'all' ? Math.max(total, 1) : curTablePageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (curTableCurrentPage > totalPages) curTableCurrentPage = totalPages;
        const startIdx = (curTableCurrentPage - 1) * pageSize;
        const pageRows = rows.slice(startIdx, startIdx + pageSize);

        const tbody = document.getElementById('cur-dashboard-table-body');
        tbody.innerHTML = pageRows.length ? '' : `<tr><td colspan="8" style="text-align:center;">Tidak ada data.</td></tr>`;
        pageRows.forEach((e, i) => {
            const tpDisplay = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join('/') : (e.tp || '-');
            tbody.innerHTML += dashRowsHtml(e, startIdx + i + 1, (currentCurPair().endsWith('JPY') ? 3 : 5));
        });

        const pagEl = document.getElementById('cur-table-pagination');
        pagEl.innerHTML = `<span style="color:#888; font-size:0.85rem;">${total === 0 ? 0 : startIdx + 1}-${Math.min(startIdx + pageSize, total)} dari ${total} entry</span>` +
            `<div style="display:flex; gap:6px; align-items:center;">
                <button type="button" class="btn-action" id="cur-table-prev" ${curTableCurrentPage <= 1 ? 'disabled' : ''} style="padding:4px 12px;">&lt; Prev</button>
                <span style="color:#ccc; font-size:0.85rem;">Hal ${curTableCurrentPage}/${totalPages}</span>
                <button type="button" class="btn-action" id="cur-table-next" ${curTableCurrentPage >= totalPages ? 'disabled' : ''} style="padding:4px 12px;">Next &gt;</button>
            </div>`;
        document.getElementById('cur-table-prev').onclick = () => { curTableCurrentPage--; renderCurTable(); };
        document.getElementById('cur-table-next').onclick = () => { curTableCurrentPage++; renderCurTable(); };

        document.querySelectorAll('#cur-view-dashboard th.cur-sortable').forEach(th => {
            const oldArrow = th.querySelector('.cur-sort-arrow'); if (oldArrow) oldArrow.remove();
            if (th.dataset.col === col) {
                const arrow = document.createElement('span'); arrow.className = 'cur-sort-arrow'; arrow.textContent = dir === 'asc' ? ' ▲' : ' ▼';
                th.appendChild(arrow);
            }
        });
    }
    document.getElementById('cur-table-search').addEventListener('input', (e) => { curTableSearch = e.target.value; curTableCurrentPage = 1; renderCurTable(); });
    document.getElementById('cur-table-page-size').addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('cur-table-page-size-custom').style.display = val === 'custom' ? 'inline-block' : 'none';
        if (val === 'custom') { const n = parseInt(document.getElementById('cur-table-page-size-custom').value); curTablePageSize = n > 0 ? n : 30; }
        else curTablePageSize = val === 'all' ? 'all' : parseInt(val);
        curTableCurrentPage = 1;
        renderCurTable();
    });
    document.getElementById('cur-table-page-size-custom').addEventListener('input', (e) => {
        const n = parseInt(e.target.value);
        if (n > 0) { curTablePageSize = n; curTableCurrentPage = 1; renderCurTable(); }
    });
    document.querySelectorAll('#cur-view-dashboard th.cur-sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            curTableSort = curTableSort.col === col ? { col, dir: curTableSort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' };
            curTableCurrentPage = 1;
            renderCurTable();
        });
    });

    // ---- Tab "Log Aktivitas" ----
    let curLastLogs = []; let curLogLimit = 10;
    let curLogFilter = new Set(['success', 'nihil', 'fail']);
    window.toggleCurLogFilter = function(category, btn) {
        if (curLogFilter.has(category)) curLogFilter.delete(category); else curLogFilter.add(category);
        btn.classList.toggle('ai-log-filter-off', !curLogFilter.has(category));
        renderCurLogList();
    };
    function renderCurLogList() {
        const el = document.getElementById('cur-log-list');
        if (!el) return;
        const filtered = curLastLogs.filter(l => curLogFilter.has(categorizeAiLog(l.outcome)));
        const shown = filtered.slice(0, curLogLimit === 'all' ? filtered.length : curLogLimit);
        el.innerHTML = shown.length ? shown.map(logRowHtml).join('') : '<p class="ec-empty">Belum ada aktivitas yang cocok.</p>';
        const info = document.getElementById('cur-log-count'); if (info) info.innerText = `${shown.length} dari ${filtered.length}`;
    }
    document.getElementById('cur-log-limit').addEventListener('change', e => { curLogLimit = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10); renderCurLogList(); });
    function renderCurrencyLog(pairKey) {
        const el = document.getElementById('cur-log-list');
        if (!el || !auth.currentUser) return;
        // Sengaja gak pakai .where('source',...) digabung .orderBy('time',...) di query - kombinasi itu
        // butuh composite index Firestore yang belum ke-setup, query-nya bakal gagal diam-diam. Pola sama
        // kayak renderAiLog() punya Gold: ambil dulu (single-field orderBy, gak butuh index tambahan),
        // filter source-nya belakangan di JS. Limit digedein (900, bukan 300) - 6 bot (Gold+5 currency)
        // nulis ke subcollection yang SAMA, jadi jatah 1 pair bisa abis duluan kalau limit-nya kekecilan.
        // Terima 2 jenis source: server_<PAIR> (dari bot VPS) & browser_<PAIR> (aksi manual di web, mis. Reset Data)
        // - kalau cuma nerima server_<PAIR>, aksi manual browser gak bakal pernah kebaca di sini.
        db.collection('appData').doc(auth.currentUser.uid).collection('ai_tick_log')
            .orderBy('time', 'desc').limit(900).get()
            .then(snap => {
                const logs = snap.docs.map(d => d.data()).filter(l => l.source === `server_${pairKey}` || l.source === `browser_${pairKey}`).slice(0, 200);
                curLastLogs = logs;
                let s = 0, n = 0, f = 0;
                logs.forEach(l => { const c = categorizeAiLog(l.outcome); if (c === 'success') s++; else if (c === 'fail') f++; else n++; });
                document.getElementById('cur-log-summary').innerHTML = logSummaryHtml(s, n, f);
                renderCurLogList();
            }).catch(err => console.error('Gagal ambil log Currency:', err));
    }

    // ---- Dispatcher utama (dipanggil dari klik menu, ganti pair, tombol refresh, & tiap update realtime Firestore) ----
    // Mirror pola rerenderActiveSection punya Gold (baris ~105-113): cuma render tab yang lagi AKTIF,
    // biar gak buang-buang kerja render ulang chart/tabel yang lagi gak keliatan tiap ada snapshot baru.
    window.renderCurrencyDashboard = function() {
        if (!isLoggedIn) return;
        const pairKey = currentCurPair();
        if (document.getElementById('cur-menu-dashboard').classList.contains('active')) renderCurDashboard(pairKey);
        else if (document.getElementById('cur-menu-calendar').classList.contains('active')) renderCurCalendar(pairKey);
        else if (document.getElementById('cur-menu-log').classList.contains('active')) renderCurrencyLog(pairKey);
        else renderCurMarketTab(pairKey);
    };

    document.getElementById('cur-pair-select').addEventListener('change', renderCurrencyDashboard);
    document.getElementById('btn-cur-refresh-market').addEventListener('click', renderCurrencyDashboard);
    document.getElementById('btn-cur-refresh-calendar').addEventListener('click', renderCurrencyDashboard);
    document.getElementById('btn-cur-refresh-dashboard').addEventListener('click', renderCurrencyDashboard);
    document.getElementById('btn-cur-refresh-log').addEventListener('click', renderCurrencyDashboard);

    function switchCurTab(activeMenuId, activeViewId) {
        ['cur-menu-market', 'cur-menu-calendar', 'cur-menu-dashboard', 'cur-menu-log'].forEach(id => document.getElementById(id).classList.toggle('active', id === activeMenuId));
        ['cur-view-market', 'cur-view-calendar', 'cur-view-dashboard', 'cur-view-log'].forEach(id => document.getElementById(id).style.display = id === activeViewId ? 'block' : 'none');
    }
    document.getElementById('cur-menu-market').addEventListener('click', () => { switchCurTab('cur-menu-market', 'cur-view-market'); renderCurrencyDashboard(); });
    document.getElementById('cur-menu-calendar').addEventListener('click', () => { switchCurTab('cur-menu-calendar', 'cur-view-calendar'); renderCurrencyDashboard(); });
    document.getElementById('cur-menu-dashboard').addEventListener('click', () => { switchCurTab('cur-menu-dashboard', 'cur-view-dashboard'); renderCurrencyDashboard(); });
    document.getElementById('cur-menu-log').addEventListener('click', () => { switchCurTab('cur-menu-log', 'cur-view-log'); renderCurrencyDashboard(); });

    // ==========================================
    // MONITORING - ringkasan gabungan Gold + 5 Currency, PER BULAN (semua card/chart di halaman ini ikut
    // 1 nav bulan yang sama, monTrendNavDate) - sengaja BUKAN globalNavDate yang dipakai bareng-bareng semua
    // dashboard lain, biar geser bulan di sini gak ikut nge-geser bulan yang lagi dibuka di tab Gold/Currency/dst.
    // ==========================================
    let monPlChartInstance = null;
    let monTrendChartInstance = null;
    let monTrendNavDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // tanggal 1, alasan sama dgn globalNavDate
    let monContradictionLimit = 10;
    // Kumulatif harian dalam 1 bulan (index array 1..daysInMonth, index 0 gak dipakai) - biar "reset" tiap
    // ganti bulan (bukan kumulatif dari awal semua histori), jadi kurvanya kebaca sebagai pergerakan bulan itu doang.
    function computeDailyCumulative(tradeDataList, year, month) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dailyPl = new Array(daysInMonth + 1).fill(0);
        const dailyOrders = new Array(daysInMonth + 1).fill(0);
        tradeDataList.forEach(tradeData => {
            for (let day = 1; day <= daysInMonth; day++) {
                const fDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                (tradeData[fDate] || []).forEach(t => { dailyPl[day] += parseFloat(t.pl || 0); dailyOrders[day]++; });
            }
        });
        const cumulative = new Array(daysInMonth + 1).fill(0);
        for (let day = 1; day <= daysInMonth; day++) cumulative[day] = cumulative[day - 1] + dailyPl[day];
        return { daysInMonth, dailyPl, dailyOrders, cumulative };
    }
    // P/L SEBELUM bulan yg lagi dibuka (buat hitung equity awal bulan itu) - perbandingan string tanggal ISO
    // (YYYY-MM-DD vs YYYY-MM) valid krn zero-padded, gak perlu parse ke Date.
    function sumPlBeforeMonth(tradeData, year, month, resetAt) {
        // Cuma jumlahin trade yang UDAH closed - trade open yang kebawa dari bulan lalu punya field
        // pl floating/belum final, gak boleh dianggap P/L realized sampai beneran ketutup.
        // resetAt (opsional, YYYY-MM-DD): trade sebelum tanggal ini di-skip (modal "berdiri sendiri").
        const targetPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        let sum = 0;
        for (const d in tradeData) {
            if (resetAt && d < resetAt) continue;
            if (d < targetPrefix) (tradeData[d] || []).forEach(t => { if (t.status === 'closed') sum += parseFloat(t.pl || 0); });
        }
        return sum;
    }
    function summarizeMonthPl(tradeData, year, month, resetAt) {
        const targetPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        let totalPl = 0, totalEntries = 0, closedCount = 0, winCount = 0;
        for (const d in tradeData) {
            if (resetAt && d < resetAt) continue;
            if (!d.startsWith(targetPrefix)) continue;
            (tradeData[d] || []).forEach(t => {
                totalEntries++;
                if (t.status === 'closed') {
                    const p = parseFloat(t.pl || 0);
                    totalPl += p; closedCount++; if (p >= 0) winCount++;
                }
            });
        }
        return { totalPl, totalEntries, closedCount, winCount };
    }

    function buildEquityBoxesHtml(equityAwal, totalPl) {
        const equityAkhir = equityAwal + totalPl;
        const growthPct = equityAwal > 0 ? (totalPl / equityAwal * 100) : 0;
        const growthClass = totalPl > 0 ? 'profit-text' : (totalPl < 0 ? 'loss-text' : 'netral');
        return `
            <div class="equity-box"><span class="label">Equity Awal Bulan Ini</span><h3>${formatRupiah(equityAwal)}</h3></div>
            <div class="equity-box"><span class="label">P/L Bulan Ini</span><h3 class="${growthClass}">${totalPl >= 0 ? '+' : ''}${formatRupiah(totalPl)}</h3></div>
            <div class="equity-box"><span class="label">Equity Akhir</span><h3>${formatRupiah(equityAkhir)}</h3></div>
            <div class="equity-box"><span class="label">Pertumbuhan</span><h3 class="${growthClass}">${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(2)}%</h3></div>`;
    }

    // Max drawdown ALL-TIME (bukan ngikut nav bulan - ini statistik risiko sepanjang masa, disengaja beda
    // scope dari sisa Monitoring, makanya dikasih label "(All-Time)" eksplisit biar gak ambigu lagi).
    function computeMaxDrawdown(tradeData, modalAwal) {
        const dates = Object.keys(tradeData).sort();
        let cumulative = modalAwal, peak = modalAwal, maxDD = 0;
        dates.forEach(d => {
            (tradeData[d] || []).forEach(t => { cumulative += parseFloat(t.pl || 0); });
            if (cumulative > peak) peak = cumulative;
            const dd = peak - cumulative;
            if (dd > maxDD) maxDD = dd;
        });
        return { maxDD, maxDDPct: peak > 0 ? (maxDD / peak * 100) : 0 };
    }
    // Beda dari jumlahin max drawdown tiap instrumen (yang bisa kejadian di tanggal beda2) - ini ngitung
    // drawdown dari KURVA EQUITY GABUNGAN (dijumlah dulu per tanggal, baru dicari peak-to-trough-nya).
    function computeCombinedMaxDrawdown(list) {
        // "All-Time" beneran - gak boleh ke-cutoff kayak equity per-bulan. Kurva jalan kronologis pakai
        // modal LAMA (rawModalBeforeReset) dari awal histori, terus pas nyampe rawResetAt modalnya
        // "disuntik ulang" ke rawModalAwal (dianggap setoran/deposit, gak masuk hitungan drawdown -
        // drawdown cuma dari hasil trading, bukan dari nambah modal).
        const allDates = new Set();
        list.forEach(i => Object.keys(i.tradeData).forEach(d => allDates.add(d)));
        const sortedDates = Array.from(allDates).sort();
        let cumulative = list.reduce((s, i) => s + (i.rawResetAt ? (i.rawModalBeforeReset || i.rawModalAwal) : i.rawModalAwal), 0);
        let peak = cumulative, maxDD = 0;
        const injected = list.map(() => false);
        sortedDates.forEach(d => {
            list.forEach((i, idx) => {
                if (i.rawResetAt && !injected[idx] && d >= i.rawResetAt) {
                    cumulative += i.rawModalAwal - (i.rawModalBeforeReset || i.rawModalAwal);
                    injected[idx] = true;
                }
                (i.tradeData[d] || []).forEach(t => { cumulative += parseFloat(t.pl || 0); });
            });
            if (cumulative > peak) peak = cumulative;
            const dd = peak - cumulative;
            if (dd > maxDD) maxDD = dd;
        });
        return { maxDD, maxDDPct: peak > 0 ? (maxDD / peak * 100) : 0 };
    }
    // Kejadian Metode 1 & Metode 2 buka posisi arah BERLAWANAN bersamaan (interval waktu overlap) di
    // instrumen yang sama - AI_METHOD_GROUPS udah didefinisikan di ~baris 1325, dipakai bareng di sini.
    function findMethodContradictions(tradeData, year, month) {
        const targetPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        const all = [];
        for (const d in tradeData) { if (d.startsWith(targetPrefix)) (tradeData[d] || []).forEach(t => all.push(Object.assign({ date: d }, t))); }
        const m1 = all.filter(t => AI_METHOD_GROUPS.method1.has(t.signalType) && t.openedAt);
        const m2 = all.filter(t => AI_METHOD_GROUPS.method2.has(t.signalType) && t.openedAt);
        const found = [];
        m1.forEach(t1 => {
            const s1 = new Date(t1.openedAt).getTime(), e1 = t1.closedAt ? new Date(t1.closedAt).getTime() : Date.now();
            m2.forEach(t2 => {
                if (t1.arah === t2.arah) return;
                const s2 = new Date(t2.openedAt).getTime(), e2 = t2.closedAt ? new Date(t2.closedAt).getTime() : Date.now();
                if (s1 <= e2 && s2 <= e1) found.push({ t1, t2 });
            });
        });
        return found;
    }

    let monBdSort = { key: 'pl', asc: false }; // default: P/L bulan ini tertinggi di atas
    window.renderMonitoringDashboard = function() {
        if (!isLoggedIn) return;
        const trendY = monTrendNavDate.getFullYear(), trendM = monTrendNavDate.getMonth();
        document.getElementById('mon-trend-month-year').innerText = `${monthNames[trendM]} ${trendY}`;

        // Bulan yang dibuka SEBELUM tanggal reset instrumen itu harus tetap kebaca pakai modal LAMA &
        // histori penuh (sama logikanya kayak updateAiEquity/updateCurEquity) - biar Monitoring gak
        // "ngilangin" P/L bulan lama pas modal instrumen itu udah di-reset.
        const buildInstrument = (label, color, tradeData, modalAwal, riskLimitPct, resetAt, modalBeforeReset) => {
            const monthPrefix = `${trendY}-${String(trendM + 1).padStart(2, '0')}`;
            const isPreReset = !!(resetAt && monthPrefix < resetAt.slice(0, 7));
            const baseModal = isPreReset ? (modalBeforeReset || modalAwal) : modalAwal;
            const cutoff = isPreReset ? null : resetAt;
            return {
                label, color, tradeData, modalAwal: baseModal, riskLimitPct, resetAt: cutoff,
                rawModalAwal: modalAwal, rawResetAt: resetAt, rawModalBeforeReset: modalBeforeReset,
                equityAwal: baseModal + sumPlBeforeMonth(tradeData, trendY, trendM, cutoff),
                ...summarizeMonthPl(tradeData, trendY, trendM, cutoff)
            };
        };
        const instruments = [
            buildInstrument('Gold (XAUUSD)', '#ffd700', aiTradeData, aiModalAwal, getMasterSettings().riskLimitPct, aiModalResetAt, aiModalBeforeReset),
            ...CURRENCY_PAIRS.map(p => buildInstrument(p, '#00bcd4', getCurInstrument(p).aiTradeData || {}, getCurInstrument(p).aiModalAwal || 2500000, getCurMasterSettings(p).riskLimitPct, getCurInstrument(p).aiModalResetAt || null, getCurInstrument(p).aiModalBeforeReset || null))
        ];
        const currencyOnly = instruments.slice(1);

        const renderCard = (list, equityElId, tradesElId, winrateElId) => {
            const equityAwal = list.reduce((s, i) => s + i.equityAwal, 0);
            const totalPl = list.reduce((s, i) => s + i.totalPl, 0);
            const totalEntries = list.reduce((s, i) => s + i.totalEntries, 0);
            const closedCount = list.reduce((s, i) => s + i.closedCount, 0);
            const winCount = list.reduce((s, i) => s + i.winCount, 0);
            document.getElementById(equityElId).innerHTML = buildEquityBoxesHtml(equityAwal, totalPl);
            document.getElementById(tradesElId).innerText = totalEntries;
            document.getElementById(winrateElId).innerText = closedCount > 0 ? `${((winCount / closedCount) * 100).toFixed(0)}%` : '-';
        };
        renderCard(instruments, 'mon-all-equity', 'mon-all-trades', 'mon-all-winrate');
        renderCard(currencyOnly, 'mon-cur-equity', 'mon-cur-trades', 'mon-cur-winrate');

        // Banner pause (Pilar 1, kill-switch) - dibaca dari botControl Gold (representatif, krn cuma
        // tombol Pause/Resume di bawah satu2nya cara nyalain/matiin, nulis ke ke-6 instrumen sekaligus).
        document.getElementById('mon-pause-banner').innerHTML = botControl.pauseRequested
            ? `<div class="insight-box insight-danger" style="margin-bottom:15px;"><b>Trading sedang dipause.</b> Semua entry baru ditahan di 6 instrumen. Buka "Kontrol darurat bot" di bagian bawah halaman untuk melanjutkan.</div>`
            : '';

        // Risk Overview - exposure gabungan bulan ini (limit tiap instrumen dijumlah, sesuai riskLimitPct
        // masing2 dari Master Setting) + max drawdown all-time.
        const totalLimit = instruments.reduce((s, i) => s + (i.equityAwal * ((i.riskLimitPct || 10) / 100)), 0);
        const totalLoss = instruments.reduce((s, i) => s + (i.totalPl < 0 ? Math.abs(i.totalPl) : 0), 0);
        const usedPct = totalLimit > 0 ? (totalLoss / totalLimit * 100) : 0;
        let riskBoxHtml;
        if (totalLoss === 0) riskBoxHtml = `<div class="insight-box insight-success">Aman! Belum ada rugi bulan ini dari semua instrumen.</div>`;
        else if (usedPct < 70) riskBoxHtml = `<div class="insight-box insight-success">Risk exposure gabungan terpakai ${usedPct.toFixed(0)}% dari total limit semua instrumen (${formatRupiah(totalLoss)} dari ${formatRupiah(totalLimit)}).</div>`;
        else if (usedPct < 100) riskBoxHtml = `<div class="insight-box insight-warning">Risk exposure gabungan udah ${usedPct.toFixed(0)}% dari total limit semua instrumen (${formatRupiah(totalLoss)} dari ${formatRupiah(totalLimit)}) - kemungkinan ada instrumen yang deket/kesentuh limit sendiri.</div>`;
        else riskBoxHtml = `<div class="insight-box insight-danger">Risk exposure gabungan udah ${usedPct.toFixed(0)}% dari total limit semua instrumen (${formatRupiah(totalLoss)} dari ${formatRupiah(totalLimit)}).</div>`;
        document.getElementById('mon-risk-insight').innerHTML = riskBoxHtml;

        const ddAll = computeCombinedMaxDrawdown(instruments);
        const ddCur = computeCombinedMaxDrawdown(currencyOnly);
        document.getElementById('mon-drawdown-stats').innerHTML = `
            <div class="equity-box"><span class="label">Max Drawdown (All-Time) - Semua Instrumen</span><h3 class="loss-text">${formatRupiah(ddAll.maxDD)}</h3><p style="color:#888; font-size:0.75rem; margin-top:4px;">${ddAll.maxDDPct.toFixed(2)}% dari peak equity</p></div>
            <div class="equity-box"><span class="label">Max Drawdown (All-Time) - Currency Saja</span><h3 class="loss-text">${formatRupiah(ddCur.maxDD)}</h3><p style="color:#888; font-size:0.75rem; margin-top:4px;">${ddCur.maxDDPct.toFixed(2)}% dari peak equity</p></div>`;

        const bdVal = { name: i => i.label, equityAwal: i => i.equityAwal, pl: i => i.totalPl, equityAkhir: i => i.equityAwal + i.totalPl, growth: i => (i.equityAwal > 0 ? i.totalPl / i.equityAwal : 0), wr: i => (i.closedCount ? i.winCount / i.closedCount : -1) };
        const bdFn = bdVal[monBdSort.key] || bdVal.pl;
        const bdList = instruments.slice().sort((x, y) => { const p = bdFn(x), q = bdFn(y); const c = typeof p === 'string' ? p.localeCompare(q) : (p - q); return monBdSort.asc ? c : -c; });
        const bdHead = (k, t) => `<span class="mon-sort ${monBdSort.key === k ? 'on' : ''}" data-k="${k}">${t}${monBdSort.key === k ? (monBdSort.asc ? ' ▲' : ' ▼') : ''}</span>`;
        document.getElementById('mon-breakdown-grid').innerHTML = `<div class="mon-tbl"><div class="mon-tr mon-th">${bdHead('name', 'Instrumen')}${bdHead('equityAwal', 'Equity awal')}${bdHead('pl', 'P/L bulan ini')}${bdHead('equityAkhir', 'Equity akhir')}${bdHead('growth', 'Pertumbuhan')}${bdHead('wr', 'Win rate')}</div>` + bdList.map(i => {
            const equityAkhir = i.equityAwal + i.totalPl;
            const growthPct = i.equityAwal > 0 ? (i.totalPl / i.equityAwal * 100) : 0;
            const tone = i.totalPl > 0 ? 'profit-text' : (i.totalPl < 0 ? 'loss-text' : 'netral');
            const winRate = i.closedCount > 0 ? ((i.winCount / i.closedCount) * 100).toFixed(0) + '%' : '-';
            return `<div class="mon-tr">
                <span class="mon-name" data-l="Instrumen"><i class="mon-dot" style="background:${i.color};"></i>${i.label}</span>
                <span data-l="Equity awal">${formatRupiah(i.equityAwal)}</span>
                <span data-l="P/L bulan ini" class="${tone}"><b>${i.totalPl >= 0 ? '+' : ''}${formatRupiah(i.totalPl)}</b></span>
                <span data-l="Equity akhir">${formatRupiah(equityAkhir)}</span>
                <span data-l="Pertumbuhan" class="${tone}">${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(2)}%</span>
                <span data-l="Win rate">${winRate} <small>(${i.closedCount} closed)</small></span>
            </div>`;
        }).join('') + '</div>';
        document.querySelectorAll('#mon-breakdown-grid .mon-sort').forEach(el => el.addEventListener('click', () => {
            const k = el.dataset.k;
            if (monBdSort.key === k) monBdSort.asc = !monBdSort.asc; else { monBdSort.key = k; monBdSort.asc = (k === 'name'); }
            window.renderMonitoringDashboard();
        }));

        let totalContradictions = 0;
        const contradictionDetails = [];
        document.getElementById('mon-contradiction-grid').innerHTML = instruments.map(i => {
            const found = findMethodContradictions(i.tradeData, trendY, trendM);
            totalContradictions += found.length;
            found.forEach(f => contradictionDetails.push({ instrument: i.label, ...f }));
            return `<span class="mon-chipcount ${found.length > 0 ? 'has' : ''}"><i class="mon-dot" style="background:${i.color};"></i>${i.label}<b>${found.length}x</b></span>`;
        }).join('');
        const contradictionLimitEl = document.getElementById('mon-contradiction-limit');
        if (contradictionLimitEl) contradictionLimitEl.value = String(monContradictionLimit);
        const shownContradictions = monContradictionLimit === 'all' ? contradictionDetails : contradictionDetails.slice(0, monContradictionLimit);
        document.getElementById('mon-contradiction-list').innerHTML = totalContradictions === 0
            ? `<p style="color:#888; font-size:0.85rem;">Gak ada kontradiksi sinyal bulan ini.</p>`
            : shownContradictions.map(d => {
                const n1 = SIGNAL_TYPE_LABELS[d.t1.signalType] || d.t1.signalType, n2 = SIGNAL_TYPE_LABELS[d.t2.signalType] || d.t2.signalType;
                const cls = (a) => String(a).toUpperCase() === 'BUY' ? 'buy' : 'sell';
                return `<div class="mon-contra"><span class="mon-contra-ins">${d.instrument}</span><span class="mon-contra-date">${d.t1.date}</span><span class="mon-contra-txt">${n1} <em class="${cls(d.t1.arah)}">${String(d.t1.arah).toUpperCase()}</em> bertemu ${n2} <em class="${cls(d.t2.arah)}">${String(d.t2.arah).toUpperCase()}</em></span></div>`;
            }).join('')
                + (contradictionDetails.length > shownContradictions.length ? `<p style="color:#777; font-size:0.75rem; margin-top:5px;">Menampilkan ${shownContradictions.length} dari ${contradictionDetails.length} kontradiksi.</p>` : '');

        // Chart di-buat SEKALI trus di-update in-place tiap render (bukan destroy+new tiap kali) - data doc Firestore
        // ini ke-update tiap ~10 detik dari 6 proses bot (trailing SL/lock jalan tiap tick pas ada posisi open),
        // jadi renderMonitoringDashboard() sering ke-panggil ulang - destroy+new bikin canvas "kedip" (blank sesaat
        // sebelum kegambar ulang), update() mulus gak ada jeda blank.
        if (!monPlChartInstance) {
            monPlChartInstance = new Chart(document.getElementById('mon-plChart').getContext('2d'), {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Total P/L', data: [], backgroundColor: [], borderRadius: 4 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }
        monPlChartInstance.data.labels = instruments.map(i => i.label);
        monPlChartInstance.data.datasets[0].data = instruments.map(i => i.totalPl);
        monPlChartInstance.data.datasets[0].backgroundColor = instruments.map(i => i.totalPl >= 0 ? '#00e676' : '#ff1744');
        monPlChartInstance.update();

        const allDaily = computeDailyCumulative([aiTradeData, ...CURRENCY_PAIRS.map(p => getCurInstrument(p).aiTradeData || {})], trendY, trendM);
        const curDaily = computeDailyCumulative(CURRENCY_PAIRS.map(p => getCurInstrument(p).aiTradeData || {}), trendY, trendM);
        const dayLabels = []; for (let d = 1; d <= allDaily.daysInMonth; d++) dayLabels.push(`Tgl ${d}`);
        const pointColor = dailyPl => dailyPl.slice(1).map(v => v > 0 ? '#00e676' : (v < 0 ? '#ff1744' : '#888'));

        if (!monTrendChartInstance) {
            monTrendChartInstance = new Chart(document.getElementById('mon-trendChart').getContext('2d'), {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'Semua Instrumen', data: [], borderColor: '#ffd700', backgroundColor: 'rgba(255,215,0,0.12)', tension: 0.3, fill: true, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: [] },
                        { label: 'Currency Saja', data: [], borderColor: '#00bcd4', backgroundColor: 'rgba(0,188,212,0.12)', tension: 0.3, fill: true, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: [] }
                    ]
                },
                options: {
                    maintainAspectRatio: false,
                    scales: { x: { grid: { color: chartGridColor() } }, y: { grid: { color: chartGridColor() }, ticks: { callback: v => formatRupiah(v) } } },
                    plugins: {
                        legend: { labels: { color: '#ccc' } },
                        tooltip: {
                            callbacks: {
                                label: ctx => {
                                    const day = ctx.dataIndex + 1;
                                    const meta = ctx.dataset.meta || { dailyPl: [], dailyOrders: [] };
                                    const dayPl = meta.dailyPl[day] || 0;
                                    const dayOrders = meta.dailyOrders[day] || 0;
                                    return [
                                        `${ctx.dataset.label} (kumulatif): ${formatRupiah(ctx.parsed.y)}`,
                                        `P/L tgl ini: ${dayPl >= 0 ? '+' : ''}${formatRupiah(dayPl)}`,
                                        `Total order: ${dayOrders}`
                                    ];
                                }
                            }
                        }
                    }
                }
            });
        }
        monTrendChartInstance.data.labels = dayLabels;
        monTrendChartInstance.data.datasets[0].data = dayLabels.map((_, idx) => allDaily.cumulative[idx + 1]);
        monTrendChartInstance.data.datasets[0].pointBackgroundColor = pointColor(allDaily.dailyPl);
        monTrendChartInstance.data.datasets[0].meta = { dailyPl: allDaily.dailyPl, dailyOrders: allDaily.dailyOrders };
        monTrendChartInstance.data.datasets[1].data = dayLabels.map((_, idx) => curDaily.cumulative[idx + 1]);
        monTrendChartInstance.data.datasets[1].pointBackgroundColor = pointColor(curDaily.dailyPl);
        monTrendChartInstance.data.datasets[1].meta = { dailyPl: curDaily.dailyPl, dailyOrders: curDaily.dailyOrders };
        monTrendChartInstance.update();
    };
    document.getElementById('mon-trend-prev-month').addEventListener('click', () => { monTrendNavDate.setMonth(monTrendNavDate.getMonth() - 1); renderMonitoringDashboard(); });
    document.getElementById('mon-trend-next-month').addEventListener('click', () => { monTrendNavDate.setMonth(monTrendNavDate.getMonth() + 1); renderMonitoringDashboard(); });
    document.getElementById('mon-contradiction-limit').addEventListener('change', (e) => {
        monContradictionLimit = e.target.value === 'all' ? 'all' : Number(e.target.value);
        renderMonitoringDashboard();
    });

    // Kill-switch global (Pilar 1) - nulis botControl.pauseRequested ke SEMUA 6 dokumen (root Gold +
    // 5 currencyPairs) sekaligus, 1 klik = pause/resume semua instrumen. BEDA dari restartRequested/
    // summaryRequested (one-shot) - flag ini PERSISTENT, bot cuma baca, cuma tombol ini yang matiin lagi.
    // closeAllRequested sengaja gak ikut disalin dari state lama - kalau web belum nerima reset dari bot,
    // klik Pause/Resume bisa nyalain tutup darurat lagi tanpa sengaja.
    function writeBotControlAll(fields) {
        const uid = auth.currentUser.uid;
        const merged = (existing) => {
            const { closeAllRequested, ...rest } = existing || {};
            return { botControl: { ...rest, ...fields } };
        };
        return Promise.all([
            db.collection('appData').doc(uid).set(merged(botControl), { merge: true }),
            ...CURRENCY_PAIRS.map(p => db.collection('appData').doc(uid).collection('currencyPairs').doc(p)
                .set(merged(getCurInstrument(p).botControl), { merge: true })),
        ]);
    }
    function setGlobalPause(paused) {
        if (!auth.currentUser) { alert('Login dulu.'); return; }
        writeBotControlAll({ pauseRequested: paused, pauseRequestedAt: new Date().toISOString() })
            .then(() => alert(paused
                ? '🚨 Sinyal pause terkirim ke 6 instrumen. Entry baru bakal ditahan mulai siklus tick berikutnya (~5 menit). Posisi yang udah open TETAP dilindungi SL/TP normal, order pending (layer 2/3 yang belum kefill) dibatalkan.'
                : '▶️ Sinyal resume terkirim ke 6 instrumen. Entry baru bakal aktif lagi mulai siklus tick berikutnya (~5 menit).'))
            .catch(err => alert('Gagal kirim sinyal: ' + err.message));
    }
    // Tombol darurat dikunci dulu: harus centang "Saya mengerti" biar tidak terklik tidak sengaja, dan kunci balik otomatis setelah dipakai.
    const monCtrlUnlock = document.getElementById('mon-ctrl-unlock');
    const monCtrlBtns = ['btn-mon-pause-all', 'btn-mon-resume-all', 'btn-mon-close-all'].map(id => document.getElementById(id));
    const monRelock = () => { monCtrlUnlock.checked = false; monCtrlBtns.forEach(b => { b.disabled = true; }); };
    monCtrlUnlock.addEventListener('change', () => monCtrlBtns.forEach(b => { b.disabled = !monCtrlUnlock.checked; }));
    monCtrlBtns.forEach(b => b.addEventListener('click', () => setTimeout(monRelock, 400)));
    document.getElementById('mon-danger').addEventListener('toggle', (e) => { if (!e.target.open) monRelock(); });
    document.getElementById('btn-mon-pause-all').onclick = () => {
        showConfirm('Pause SEMUA entry baru di 6 instrumen (Gold dan 5 Currency)?\n\nPosisi yang sudah terbuka tetap dilindungi SL/TP. Order pending (layer 2/3 yang belum terisi) dibatalkan. Entry baru ditahan sampai kamu klik Resume.', () => {
            setGlobalPause(true);
        });
    };
    document.getElementById('btn-mon-resume-all').onclick = () => {
        showConfirm('Lanjutkan entry baru di SEMUA 6 instrumen?', () => {
            setGlobalPause(false);
        });
    };
    // Tutup darurat: semua posisi open (simulasi + broker) ditutup di harga sekarang, order pending
    // dibatalkan, dan sekalian pause biar bot gak langsung entry lagi. closeAllRequested one-shot, di-reset bot.
    // Dua kali konfirmasi karena tidak bisa dibatalkan.
    document.getElementById('btn-mon-close-all').onclick = () => {
        if (!auth.currentUser) { showToast('Login dulu.', 'error'); return; }
        showConfirm('TUTUP SEMUA posisi di 6 instrumen SEKARANG di harga pasar, batalkan order pending, dan pause entry baru?\n\nTindakan ini tidak bisa dibatalkan.', () => {
            setTimeout(() => showConfirm('Konfirmasi terakhir: yakin menutup SEMUA posisi sekarang?', () => {
                const at = new Date().toISOString();
                writeBotControlAll({ closeAllRequested: true, closeAllRequestedAt: at, pauseRequested: true, pauseRequestedAt: at })
                    .then(() => showToast('Perintah tutup darurat terkirim ke 6 instrumen. Posisi ditutup dalam sekitar 10 detik, cek Telegram. Entry baru di-pause sampai kamu Resume.', 'success', 7000))
                    .catch(err => showToast('Gagal kirim perintah: ' + err.message, 'error'));
            }), 250);
        });
    };

    // Export multi-instrumen dari Monitoring - datanya udah ke-load di memori (sama kayak yang dipakai
    // render dashboard), jadi gak nambah baca Firestore sama sekali, murni proses browser doang.
    const MON_EXPORT_INSTRUMENTS = [
        { key: 'gold', label: 'Gold (XAUUSD)' },
        ...CURRENCY_PAIRS.map(p => ({ key: p, label: p })),
    ];
    function updateMonExportCount() {
        document.getElementById('mon-export-count').textContent = document.querySelectorAll('.mon-export-chip.selected').length;
    }
    // ---- Export Markdown untuk AI: semua instrumen terpilih digabung 1 file, urut waktu buka order ----
    function triggerFileDownload(content, filename, mime) {
        const blob = new Blob([content], { type: mime + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    function monPipSize(key) { return key === 'gold' ? 0.10 : key.endsWith('JPY') ? 0.01 : 0.0001; }
    function fmtWib(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return isNaN(d) ? '-' : d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16);
    }
    function fmtDurasi(a, b) {
        if (!a || !b) return '-';
        const ms = new Date(b) - new Date(a);
        if (isNaN(ms) || ms < 0) return '-';
        const m = Math.round(ms / 60000);
        return m < 60 ? `${m} menit` : m < 1440 ? `${Math.floor(m / 60)} jam ${m % 60} menit` : `${Math.floor(m / 1440)} hari ${Math.floor((m % 1440) / 60)} jam`;
    }
    function buildMonitoringMarkdown(selectedKeys, period, targetPrefix) {
        const all = [];
        selectedKeys.forEach(key => {
            const isGold = key === 'gold';
            const data = isGold ? aiTradeData : (getCurInstrument(key).aiTradeData || {});
            const name = isGold ? 'XAUUSD' : key;
            const dec = isGold ? 2 : (key.endsWith('JPY') ? 3 : 5);
            Object.keys(data).forEach(d => {
                if (period !== 'all' && !d.startsWith(targetPrefix)) return;
                (data[d] || []).forEach(t => all.push({ key, name, dec, date: d, t }));
            });
        });
        all.sort((a, b) => String(a.t.openedAt || a.date).localeCompare(String(b.t.openedAt || b.date)));
        const pl = (x) => parseFloat(x.t.pl || 0);
        const rp = (v) => (v < 0 ? '-' : '') + 'Rp ' + Math.abs(Math.round(v)).toLocaleString('id-ID');
        const closed = all.filter(x => x.t.status === 'closed');
        const stat = (list) => {
            const w = list.filter(x => pl(x) > 0), l = list.filter(x => pl(x) < 0);
            const tw = w.reduce((s, x) => s + pl(x), 0), tl = -l.reduce((s, x) => s + pl(x), 0);
            const aw = w.length ? tw / w.length : 0, al = l.length ? tl / l.length : 0;
            return { n: list.length, w: w.length, l: l.length, wr: list.length ? w.length / list.length * 100 : 0, total: tw - tl, aw, al, payoff: al ? aw / al : 0, pf: tl ? tw / tl : 0 };
        };
        const statRow = (label, list) => { const s = stat(list); return `| ${label} | ${s.n} | ${s.w} | ${s.l} | ${s.wr.toFixed(0)}% | ${rp(s.total)} | ${rp(s.aw)} | ${rp(s.al)} | ${s.payoff.toFixed(2)} | ${s.pf.toFixed(2)} |`; };
        const statHead = (first) => `| ${first} | Trade | Menang | Kalah | WR | Total P/L | Rata2 menang | Rata2 kalah | Payoff | Profit factor |\n|---|---|---|---|---|---|---|---|---|---|`;
        const names = Array.from(new Set(all.map(x => x.name)));
        const methods = Array.from(new Set(all.map(x => x.t.signalType || '-')));
        const first = all.length ? fmtWib(all[0].t.openedAt) : '-', last = all.length ? fmtWib(all[all.length - 1].t.openedAt) : '-';
        const out = [];
        out.push(`# Data Eksekusi Trading Simulasi`);
        out.push(`- Periode: ${period === 'all' ? 'Semua waktu' : targetPrefix}`);
        out.push(`- Instrumen: ${selectedKeys.map(k => k === 'gold' ? 'XAUUSD' : k).join(', ')}`);
        out.push(`- Total trade: ${all.length} (closed ${closed.length}, masih open ${all.length - closed.length})`);
        out.push(`- Rentang waktu buka order: ${first} s/d ${last} (WIB)`);
        out.push(`- Dibuat: ${fmtWib(new Date().toISOString())} WIB`);
        out.push('');
        out.push('## Cara membaca');
        out.push('- Urutan trade **kronologis berdasarkan waktu order dibuka** (semua instrumen digabung), bukan per instrumen.');
        out.push('- Waktu dalam WIB. P/L dalam Rupiah simulasi (positif = untung). Trade = 1 sinyal dengan hingga 3 layer (L1, L2, L3).');
        out.push('- Status layer: Kena TP, Kena SL, Dibatalkan (order tunggu tidak terisi), Ditutup (berita / sebelum weekend / timeout), Breakeven.');
        out.push('- Payoff = rata-rata menang / rata-rata kalah. Profit factor = total untung / total rugi. Statistik hanya dari trade berstatus closed.');
        out.push('- Pips SL/TP dihitung dari jarak entry ke SL/TP per layer. 1 pip Gold = 0,10, pair JPY = 0,01, pair lain = 0,0001.');
        out.push('');
        out.push('## Ringkasan per instrumen (closed)');
        out.push(statHead('Instrumen'));
        names.forEach(n => out.push(statRow(n, closed.filter(x => x.name === n))));
        out.push(statRow('**Semua**', closed));
        out.push('');
        out.push('## Ringkasan per metode (closed)');
        out.push(statHead('Metode'));
        methods.forEach(m => out.push(statRow(m, closed.filter(x => (x.t.signalType || '-') === m))));
        out.push('');
        out.push('## Ringkasan per instrumen x metode (closed)');
        out.push(statHead('Instrumen / metode'));
        names.forEach(n => methods.forEach(m => { const l = closed.filter(x => x.name === n && (x.t.signalType || '-') === m); if (l.length) out.push(statRow(`${n} / ${m}`, l)); }));
        out.push('');
        const layerCount = {};
        all.forEach(x => (x.t.layers || []).forEach(ly => { const k = AI_LAYER_STATUS_LABEL[ly.status] || ly.status || '-'; layerCount[k] = (layerCount[k] || 0) + 1; }));
        out.push('## Hasil per layer');
        out.push(Object.keys(layerCount).map(k => `- ${k}: ${layerCount[k]}`).join('\n') || '- (kosong)');
        out.push('');
        out.push('## Daftar trade (kronologis)');
        all.forEach((x, i) => {
            const t = x.t;
            const ps = monPipSize(x.key);
            out.push('');
            out.push(`### ${i + 1}. ${fmtWib(t.openedAt)} WIB · ${x.name} · ${String(t.arah || '').toUpperCase()} @ ${parseFloat(t.entry).toFixed(x.dec)}`);
            out.push(`- Metode: ${t.signalType || '-'} · Timeframe: ${t.tf || '-'} · Status: ${t.status} · Total P/L: ${rp(pl(x))}`);
            out.push(`- Buka: ${fmtWib(t.openedAt)} · Tutup: ${t.closedAt ? fmtWib(t.closedAt) : 'masih open'} · Durasi: ${fmtDurasi(t.openedAt, t.closedAt)}`);
            out.push('');
            out.push('| Layer | Entry | SL | SL pips | TP | TP pips | Lot | Status | P/L |');
            out.push('|---|---|---|---|---|---|---|---|---|');
            (t.layers || []).forEach((ly, k) => {
                const slp = Math.round(Math.abs(parseFloat(ly.entry) - parseFloat(ly.sl)) / ps);
                out.push(`| L${k + 1} | ${parseFloat(ly.entry).toFixed(x.dec)} | ${parseFloat(ly.sl).toFixed(x.dec)} | ${slp} | ${parseFloat(ly.tp).toFixed(x.dec)} | ${ly.tpPips ?? '-'} | ${ly.lot ?? '-'} | ${AI_LAYER_STATUS_LABEL[ly.status] || ly.status || '-'} | ${rp(parseFloat(ly.pl || 0))} |`);
            });
            if (t.alasan) out.push('\n- Alasan entry: ' + String(t.alasan).replace(/\s*\n\s*/g, ' '));
        });
        out.push('');
        return out.join('\n');
    }
    let monExportFormat = 'csv';
    function updateMonExportFormat() {
        document.querySelectorAll('#mon-export-format .exp-format').forEach(el => el.classList.toggle('selected', el.dataset.fmt === monExportFormat));
        document.getElementById('mon-export-fmt-label').innerText = monExportFormat === 'md' ? 'Markdown' : 'CSV';
    }
    document.querySelectorAll('#mon-export-format .exp-format').forEach(el => el.addEventListener('click', () => { monExportFormat = el.dataset.fmt; updateMonExportFormat(); }));

    document.getElementById('btn-mon-open-export').addEventListener('click', () => {
        document.getElementById('mon-export-checklist').innerHTML = MON_EXPORT_INSTRUMENTS.map(i => `
            <div class="mon-export-chip" data-key="${i.key}"><span class="chip-check"></span><span class="chip-label">${i.label}</span></div>`).join('');
        document.querySelectorAll('.mon-export-chip').forEach(chip => {
            chip.addEventListener('click', () => { chip.classList.toggle('selected'); updateMonExportCount(); });
        });
        updateMonExportCount();
        document.getElementById('mon-export-modal').style.display = 'flex';
    });
    document.getElementById('mon-export-select-all').addEventListener('click', () => {
        const chips = document.querySelectorAll('.mon-export-chip');
        const allSelected = Array.from(chips).every(c => c.classList.contains('selected'));
        chips.forEach(c => c.classList.toggle('selected', !allSelected));
        updateMonExportCount();
    });
    document.getElementById('btn-mon-export-confirm').addEventListener('click', () => {
        const period = document.getElementById('mon-export-period').value;
        const y = monTrendNavDate.getFullYear(), m = monTrendNavDate.getMonth();
        const targetPrefix = `${y}-${String(m + 1).padStart(2, '0')}`;
        const selectedKeys = Array.from(document.querySelectorAll('.mon-export-chip.selected')).map(chip => chip.dataset.key);
        if (selectedKeys.length === 0) { showToast('Pilih minimal 1 instrumen dulu.', 'error'); return; }
        const periodLabel = period === 'all' ? 'All' : targetPrefix;
        if (monExportFormat === 'md') {
            triggerFileDownload(buildMonitoringMarkdown(selectedKeys, period, targetPrefix), `Eksekusi_Trading_${periodLabel}.md`, 'text/markdown');
        } else {
            selectedKeys.forEach((key, i) => {
                // Stagger tiap download dikit - browser suka nge-block kalau banyak file di-trigger bersamaan persis di tick yang sama.
                setTimeout(() => {
                    const isGold = key === 'gold';
                    const tradeData = isGold ? aiTradeData : (getCurInstrument(key).aiTradeData || {});
                    const csv = buildAiTradeCsv(tradeData, period, targetPrefix, isGold ? 2 : 5);
                    triggerCsvDownload(csv, `Data_${isGold ? 'Gold' : key}_${periodLabel}.csv`);
                }, i * 400);
            });
        }
        document.getElementById('mon-export-modal').style.display = 'none';
    });

    document.getElementById('btn-cur-more-menu').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('cur-more-menu-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
        const dd = document.getElementById('cur-more-menu-dropdown');
        if (dd && dd.classList.contains('open') && !dd.contains(e.target) && e.target.id !== 'btn-cur-more-menu') dd.classList.remove('open');
    });

    // ---- Master Setting (Poin F: +Risk Insight fields & preview) ----
    document.getElementById('btn-cur-master-settings').onclick = () => {
        const pairKey = currentCurPair();
        const m = getCurMasterSettings(pairKey);
        document.getElementById('cur-master-pair-label').innerText = pairKey;
        document.getElementById('cur-master-risk-limit-pct').value = m.riskLimitPct;
        document.getElementById('cur-master-risk-period').value = m.riskPeriod;
        document.getElementById('cur-master-sl-pips').value = m.slPips;
        document.getElementById('cur-master-sl-mode').value = m.slMode;
        document.getElementById('cur-master-atr-multiplier').value = m.atrMultiplier;
        document.getElementById('cur-master-tp-mode').value = m.tpMode;
        document.getElementById('cur-master-tp1-pips').value = m.tpLayerPips[0];
        document.getElementById('cur-master-tp2-pips').value = m.tpLayerPips[1];
        document.getElementById('cur-master-tp3-pips').value = m.tpLayerPips[2];
        document.getElementById('cur-master-l3-tp-atr-mode').value = m.l3TpAtrMode ? 'on' : 'off';
        document.getElementById('cur-master-l3-tp-atr-multiplier').value = m.l3TpAtrMultiplier;
        document.getElementById('cur-master-pip-value-unit').value = m.pipValueUnit;
        document.getElementById('cur-master-pip-value-per-lot').value = m.pipValuePerLot;
        document.getElementById('cur-master-lot-size').value = m.lotSize;
        document.getElementById('cur-master-lot-scale-threshold1').value = m.lotScaleThreshold1Pips;
        document.getElementById('cur-master-lot-scale-lot1').value = m.lotScaleLot1;
        document.getElementById('cur-master-lot-scale-threshold2').value = m.lotScaleThreshold2Pips;
        document.getElementById('cur-master-lot-scale-lot2').value = m.lotScaleLot2;
        document.getElementById('cur-master-lot-scale-threshold3').value = m.lotScaleThreshold3Pips;
        document.getElementById('cur-master-lot-scale-lot3').value = m.lotScaleLot3;
        document.getElementById('cur-master-layer-stagger-pips').value = m.layerStaggerPips;
        document.getElementById('cur-master-lock-pips-after-tp1').value = m.lockPipsAfterTp1;
        document.getElementById('cur-master-deep-lock-trigger-pips').value = m.deepLockTriggerPips;
        document.getElementById('cur-master-deep-lock-pips').value = m.deepLockPips;
        document.getElementById('cur-master-deep-lock-timeout-minutes').value = m.deepLockTimeoutMinutes;
        document.getElementById('cur-master-min-signal-winrate').value = m.minSignalWinrate;
        document.getElementById('cur-master-winrate-lookback-days').value = m.winrateLookbackDays;
        document.getElementById('cur-master-winrate-min-samples').value = m.winrateMinSamples;
        document.getElementById('cur-master-news-pre-minutes').value = m.newsPreMinutes;
        document.getElementById('cur-master-news-post-minutes').value = m.newsPostMinutes;
        document.getElementById('cur-master-summary-interval-hours').value = m.summaryIntervalHours;
        document.getElementById('cur-master-method-two-enabled').value = m.methodTwoEnabled ? 'on' : 'off';
        document.getElementById('cur-master-modal').style.display = 'flex';
        updateCurMasterPreview();
    };

    function updateCurMasterPreview() {
        const readNum = (id) => parseFloat(document.getElementById(id).value);
        const lot = readNum('cur-master-lot-size');
        const slPips = readNum('cur-master-sl-pips');
        const tp1 = readNum('cur-master-tp1-pips'), tp2 = readNum('cur-master-tp2-pips'), tp3 = readNum('cur-master-tp3-pips');
        const unit = document.getElementById('cur-master-pip-value-unit').value;
        const pipValue = readNum('cur-master-pip-value-per-lot');
        const el = document.getElementById('cur-master-pl-preview');
        if ([lot, slPips, tp1, tp2, tp3, pipValue].some(v => isNaN(v) || v <= 0)) { el.innerHTML = '<span style="color:#888;">Isi semua field lot/SL/TP/nilai-pip dulu buat lihat preview.</span>'; return; }
        const toRp = (pips) => { const amount = pips * (lot / 0.1) * pipValue; const usd = unit === 'usd' ? amount : amount / 100; return usd * liveKursIDR; };
        el.innerHTML = `Preview nilai (lot ${lot}, kurs saat ini):<br>` +
            `SL &nbsp;&nbsp;&nbsp;: <span class="loss-text">-${formatRupiah(toRp(slPips))}</span><br>` +
            `TP L1 : <span class="profit-text">+${formatRupiah(toRp(tp1))}</span><br>` +
            `TP L2 : <span class="profit-text">+${formatRupiah(toRp(tp2))}</span><br>` +
            `TP L3 : <span class="profit-text">+${formatRupiah(toRp(tp3))}</span>`;
    }
    ['cur-master-lot-size', 'cur-master-sl-pips', 'cur-master-tp1-pips', 'cur-master-tp2-pips', 'cur-master-tp3-pips', 'cur-master-pip-value-per-lot'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateCurMasterPreview);
    });
    document.getElementById('cur-master-pip-value-unit').addEventListener('change', updateCurMasterPreview);

    document.getElementById('btn-reset-cur-master').onclick = () => {
        const pairKey = currentCurPair();
        if (!auth.currentUser) { alert('Login dulu biar tersimpan ke cloud.'); return; }
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set({ aiSettings: { master: Object.assign({}, CURRENCY_MASTER_DEFAULTS) } }, { merge: true })
            .then(() => { alert(`Master Setting ${pairKey} dikembalikan ke default.`); document.getElementById('cur-master-modal').style.display = 'none'; })
            .catch(err => alert('Gagal reset: ' + err.message));
    };

    document.getElementById('btn-save-cur-master').onclick = () => {
        const pairKey = currentCurPair();
        const readNum = (id) => parseFloat(document.getElementById(id).value);
        const fields = {
            riskLimitPct: readNum('cur-master-risk-limit-pct'),
            slPips: readNum('cur-master-sl-pips'),
            atrMultiplier: readNum('cur-master-atr-multiplier'),
            tp1: readNum('cur-master-tp1-pips'), tp2: readNum('cur-master-tp2-pips'), tp3: readNum('cur-master-tp3-pips'),
            l3TpAtrMultiplier: readNum('cur-master-l3-tp-atr-multiplier'),
            pipValuePerLot: readNum('cur-master-pip-value-per-lot'),
            lotSize: readNum('cur-master-lot-size'),
            lotScaleThreshold1Pips: readNum('cur-master-lot-scale-threshold1'),
            lotScaleLot1: readNum('cur-master-lot-scale-lot1'),
            lotScaleThreshold2Pips: readNum('cur-master-lot-scale-threshold2'),
            lotScaleLot2: readNum('cur-master-lot-scale-lot2'),
            lotScaleThreshold3Pips: readNum('cur-master-lot-scale-threshold3'),
            lotScaleLot3: readNum('cur-master-lot-scale-lot3'),
            layerStaggerPips: readNum('cur-master-layer-stagger-pips'),
            lockPipsAfterTp1: readNum('cur-master-lock-pips-after-tp1'),
            deepLockTriggerPips: readNum('cur-master-deep-lock-trigger-pips'),
            deepLockPips: readNum('cur-master-deep-lock-pips'),
            deepLockTimeoutMinutes: readNum('cur-master-deep-lock-timeout-minutes'),
            minSignalWinrate: readNum('cur-master-min-signal-winrate'),
            winrateLookbackDays: readNum('cur-master-winrate-lookback-days'),
            winrateMinSamples: readNum('cur-master-winrate-min-samples'),
            newsPreMinutes: readNum('cur-master-news-pre-minutes'),
            newsPostMinutes: readNum('cur-master-news-post-minutes'),
            summaryIntervalHours: readNum('cur-master-summary-interval-hours')
        };
        const allValid = Object.values(fields).every(v => !isNaN(v) && v >= 0) && fields.riskLimitPct > 0 && fields.slPips > 0 && fields.atrMultiplier > 0 && fields.lotSize > 0 && fields.layerStaggerPips > 0 && fields.deepLockTriggerPips > 0 && fields.winrateLookbackDays > 0 && fields.winrateMinSamples > 0 && fields.tp1 > 0 && fields.tp2 > 0 && fields.tp3 > 0 && fields.pipValuePerLot > 0 && fields.summaryIntervalHours > 0 && fields.l3TpAtrMultiplier > 0 && fields.lotScaleThreshold1Pips > 0 && fields.lotScaleLot1 > 0 && fields.lotScaleThreshold2Pips > fields.lotScaleThreshold1Pips && fields.lotScaleLot2 > 0 && fields.lotScaleThreshold3Pips > fields.lotScaleThreshold2Pips && fields.lotScaleLot3 > 0;
        if (!allValid) { alert('Ada input yang kosong/gak valid. Semua field harus angka positif (kecuali beberapa yang boleh 0), dan tiap Threshold lot menyesuaikan harus lebih besar dari Threshold sebelumnya.'); return; }
        if (!auth.currentUser) { alert('Login dulu biar tersimpan ke cloud & kepakai bot VPS.'); return; }
        const master = {
            riskLimitPct: fields.riskLimitPct, riskPeriod: document.getElementById('cur-master-risk-period').value,
            slPips: fields.slPips, slMode: document.getElementById('cur-master-sl-mode').value,
            atrMultiplier: fields.atrMultiplier, tpMode: document.getElementById('cur-master-tp-mode').value,
            tpLayerPips: [fields.tp1, fields.tp2, fields.tp3],
            l3TpAtrMode: document.getElementById('cur-master-l3-tp-atr-mode').value === 'on',
            l3TpAtrMultiplier: fields.l3TpAtrMultiplier,
            pipValueUnit: document.getElementById('cur-master-pip-value-unit').value, pipValuePerLot: fields.pipValuePerLot,
            lotSize: fields.lotSize,
            lotScaleThreshold1Pips: fields.lotScaleThreshold1Pips, lotScaleLot1: fields.lotScaleLot1,
            lotScaleThreshold2Pips: fields.lotScaleThreshold2Pips, lotScaleLot2: fields.lotScaleLot2,
            lotScaleThreshold3Pips: fields.lotScaleThreshold3Pips, lotScaleLot3: fields.lotScaleLot3,
            layerStaggerPips: fields.layerStaggerPips,
            lockPipsAfterTp1: fields.lockPipsAfterTp1, deepLockTriggerPips: fields.deepLockTriggerPips,
            deepLockPips: fields.deepLockPips, deepLockTimeoutMinutes: fields.deepLockTimeoutMinutes,
            minSignalWinrate: fields.minSignalWinrate, winrateLookbackDays: fields.winrateLookbackDays,
            winrateMinSamples: fields.winrateMinSamples, newsPreMinutes: fields.newsPreMinutes,
            newsPostMinutes: fields.newsPostMinutes, summaryIntervalHours: fields.summaryIntervalHours,
            methodTwoEnabled: document.getElementById('cur-master-method-two-enabled').value === 'on'
        };
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set({ aiSettings: { master } }, { merge: true })
            .then(() => {
                document.getElementById('cur-master-modal').style.display = 'none';
                alert(`Master Setting ${pairKey} tersimpan & disinkronkan — otomatis kepakai bot VPS pair ini dalam ~10 detik.`);
            })
            .catch(err => alert('Gagal simpan: ' + err.message));
    };

    // ---- Restart Bot, Kirim Summary, Export, Reset Data (Poin F) ----
    // Sama pola kayak restart Gold - pakai spread (...existingBotControl) biar field lain (summaryRequested dkk) gak ke-wipe.
    document.getElementById('btn-cur-restart-bot').onclick = () => {
        const pairKey = currentCurPair();
        if (!confirm(`Restart bot VPS pair ${pairKey} sekarang? Bot bakal ambil kode terbaru & jalan ulang otomatis dalam ~10 detik (cuma jalan kalau prosesnya lagi hidup).`)) return;
        if (!auth.currentUser) { alert('Login dulu.'); return; }
        const existingBotControl = getCurInstrument(pairKey).botControl || {};
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set({
            botControl: { ...existingBotControl, restartRequested: true, requestedAt: new Date().toISOString() }
        }, { merge: true })
            .then(() => alert(`Sinyal restart ${pairKey} terkirim. Cek tab Log Aktivitas dalam ~30 detik.`))
            .catch(err => alert('Gagal kirim sinyal restart: ' + err.message));
    };

    // Backend (ai-tick-currency.py) udah support botControl.summaryRequested dari sesi kemarin - tombol ini baru nambahin sisi web-nya.
    document.getElementById('btn-cur-send-summary').onclick = () => {
        const pairKey = currentCurPair();
        if (!confirm(`Kirim summary posisi & P/L ${pairKey} ke Telegram sekarang?`)) return;
        if (!auth.currentUser) { alert('Login dulu.'); return; }
        const existingBotControl = getCurInstrument(pairKey).botControl || {};
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set({
            botControl: { ...existingBotControl, summaryRequested: true, summaryRequestedAt: new Date().toISOString() }
        }, { merge: true })
            .then(() => alert(`Sinyal summary ${pairKey} terkirim. Cek Telegram dalam ~30 detik (cuma jalan kalau proses bot lagi hidup).`))
            .catch(err => alert('Gagal kirim sinyal summary: ' + err.message));
    };

    document.getElementById('btn-cur-export').onclick = () => openExportMenu('cur');

    document.getElementById('btn-cur-clear-data').onclick = () => {
        const pairKey = currentCurPair();
        document.getElementById('cur-reset-pair-label').innerText = pairKey;
        document.getElementById('cur-reset-reason').value = '';
        document.getElementById('cur-reset-reason-error').style.display = 'none';
        document.getElementById('cur-reset-modal').style.display = 'flex';
    };
    document.getElementById('close-cur-reset-modal').onclick = () => document.getElementById('cur-reset-modal').style.display = 'none';
    document.getElementById('btn-confirm-cur-reset').onclick = () => {
        const pairKey = currentCurPair();
        const reason = document.getElementById('cur-reset-reason').value.trim();
        if (!reason) { document.getElementById('cur-reset-reason-error').style.display = 'block'; return; }
        if (!auth.currentUser) { alert('Login dulu.'); return; }
        // BUKAN panggil logAiTick() punya Gold - itu hardcode source:'browser' yang bakal nyasar ke Log Aktivitas
        // GOLD (bug class yang sama kayak yang difix pas maintenance kemarin). Tulis manual dgn source per-pair,
        // renderCurrencyLog udah diperluas buat nerima browser_<PAIR> juga.
        db.collection('appData').doc(auth.currentUser.uid).collection('ai_tick_log')
            .add({ time: new Date().toISOString(), outcome: 'manual_reset', detail: reason, source: `browser_${pairKey}` })
            .catch(err => console.error('Gagal catat log reset:', err));
        db.collection('appData').doc(auth.currentUser.uid).collection('currencyPairs').doc(pairKey).set({ aiTradeData: {} }, { merge: true })
            .then(() => {
                document.getElementById('cur-reset-modal').style.display = 'none';
                alert(`Data simulasi ${pairKey} direset. Pair lain & Gold gak kesenggol.`);
                renderCurrencyDashboard();
            })
            .catch(err => alert('Gagal reset: ' + err.message));
    };

    // ==========================================
    // MODULE PEKERJAAN (My Task + Kanban) - 1 data tugas, 2 tampilan (daftar & papan).
    // Kolom = tahapan project (Antri > Req/FSD > Dev > Testing > Selesai), disesuaikan sama laporan harian
    // "List Start Task" user: bisa di-import dari teks laporan & di-generate balik jadi teks yang sama.
    // Disimpan di appData/{uid}/workspace/tasks (subkoleksi) - dokumen root appData/{uid} gak berubah,
    // jadi 6 bot VPS yang listen ke root gak ikut ke-trigger tiap kali tugas diedit.
    // ==========================================
    const WORK_STATUSES = [
        { key: 'antri', label: 'Antri', color: '#90a4ae', tahap: 'On Queue' },
        { key: 'req', label: 'Requirement / FSD', color: '#ba68c8', tahap: 'FSD On Progress' },
        { key: 'dev', label: 'Development', color: '#2196f3', tahap: 'Dev On Progress' },
        { key: 'test', label: 'Testing (SIT/UAT)', color: '#ffb300', tahap: 'SIT On Progress' },
        { key: 'done', label: 'Selesai', color: '#00e676', tahap: 'Done' },
    ];
    const WORK_STATUS_KEYS = WORK_STATUSES.map(s => s.key);
    const WORK_LEGACY_STATUS = { todo: 'antri', doing: 'dev' };
    const WORK_KATEGORI = ['Utama', 'Internal', 'Kecil', 'Approval Digital', 'Additional Task'];
    const WORK_PRIORITY = { high: { label: 'Tinggi', color: '#ff5252' }, medium: { label: 'Sedang', color: '#ffb300' }, low: { label: 'Rendah', color: '#78909c' } };
    const WORK_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const WORK_MONTH_ALIASES = { ags: 7, agt: 7, aug: 7, agst: 7, oct: 9, dec: 11, may: 4 };
    const WK_ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    const WK_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    let workView = 'list';
    let workFilterKategori = '';
    let workShowDone = false;
    let workEditId = null;
    let workEditChecklist = [];
    let workEditLogs = [];
    let workImportPending = null;
    let pushTimerWork = null;

    function workDocRef(uid) { return db.collection('appData').doc(uid).collection('workspace').doc('tasks'); }

    function saveWork() {
        localStorage.setItem('work_data_v1', JSON.stringify(workData));
        clearTimeout(pushTimerWork);
        pushTimerWork = setTimeout(() => {
            if (!auth.currentUser) return;
            workDocRef(auth.currentUser.uid).set(workData)
                .catch(err => { console.error('Gagal sync tugas ke cloud:', err); showToast('Gagal simpan tugas ke cloud — ' + err.code, 'err', 6000); });
        }, 800);
    }

    function attachWorkListener(uid) {
        if (workUnsub) workUnsub();
        workUnsub = workDocRef(uid).onSnapshot(doc => {
            if (!doc.exists) {
                // Cloud masih kosong (pertama kali): tugas yang udah ada di browser diunggah, bukan dihapus.
                if (Object.keys((workData && workData.tasks) || {}).length && !doc.metadata.fromCache) saveWork();
                return;
            }
            workData = { tasks: {}, ...doc.data() };
            localStorage.setItem('work_data_v1', JSON.stringify(workData));
            const active = document.querySelector('.menu-item.active');
            if (active && active.getAttribute('data-target') === 'view-work') renderWork();
        }, err => console.error('Gagal ambil tugas dari cloud:', err));
    }

    // ---------- Helper tanggal & teks ----------
    function workIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    function workTodayIso() { return workIsoDate(new Date()); }
    function workDaysSince(iso) { return Math.round((new Date(workTodayIso() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000); }
    function workEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function workFormatWhen(iso) { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${WORK_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`; }

    function workMonthIndex(word) {
        const w = (word || '').toLowerCase().slice(0, 4);
        if (WORK_MONTH_ALIASES[w] != null) return WORK_MONTH_ALIASES[w];
        const i = WORK_MONTHS_SHORT.findIndex(m => w.startsWith(m.toLowerCase()));
        return i;
    }

    // "16 Okt 26" / "12 - 19 Okt 26" / "28 Sep - 2 Okt 26" / "W4 Okt 26" -> {date, end} (ISO) atau null kalau gak kebaca.
    function parseWorkWhen(when) {
        const s = (when || '').trim();
        const week = s.match(/^W(\d)\s+([A-Za-z]+)\s+(\d{2,4})$/i);
        if (week) {
            const m = workMonthIndex(week[2]); if (m < 0) return { date: null, end: null };
            const y = Number(week[3].length === 2 ? '20' + week[3] : week[3]);
            const startDay = (Number(week[1]) - 1) * 7 + 1;
            const last = new Date(y, m + 1, 0).getDate();
            return { date: workIsoDate(new Date(y, m, Math.min(startDay, last))), end: workIsoDate(new Date(y, m, Math.min(startDay + 6, last))) };
        }
        const parts = s.split(/\s*-\s*/);
        const parsePart = (p, fallback) => {
            const mm = p.match(/^(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{2,4}))?$/);
            if (!mm) return null;
            const m = mm[2] ? workMonthIndex(mm[2]) : (fallback ? fallback.m : -1);
            const yRaw = mm[3] || (fallback ? String(fallback.y) : null);
            if (m < 0 || !yRaw) return { d: Number(mm[1]), m, y: null };
            return { d: Number(mm[1]), m, y: Number(yRaw.length === 2 ? '20' + yRaw : yRaw) };
        };
        const endP = parsePart(parts[parts.length - 1], null);
        if (!endP || endP.y == null || endP.m < 0) return { date: null, end: null };
        const startP = parts.length > 1 ? parsePart(parts[0], endP) : endP;
        if (!startP || startP.m < 0) return { date: null, end: null };
        const toIso = p => workIsoDate(new Date(p.y || endP.y, p.m, p.d));
        return { date: toIso(startP), end: toIso(endP) };
    }

    function workTahapToColumn(tahap) {
        const t = (tahap || '').toLowerCase();
        if (!t) return 'antri';
        if (t.includes('queue')) return 'antri';
        if (/\b(done|selesai|live)\b/.test(t)) return 'done';
        if (/testing|\bsit\b|\buat\b/.test(t)) return 'test';
        if (/\bdev\b|develop/.test(t)) return 'dev';
        if (/requirement|\bfsd\b|change request|\bcr\b|pending/.test(t)) return 'req';
        return 'antri';
    }

    // Tugas lama (versi 3 kolom) & field yang belum ada di-normalize di memori, kesimpen pas diedit berikutnya.
    function migrateWorkTask(t) {
        if (!WORK_STATUS_KEYS.includes(t.status)) t.status = WORK_LEGACY_STATUS[t.status] || 'antri';
        if (!t.kategori && t.project) t.kategori = t.project;
        if (!Array.isArray(t.logs)) t.logs = [];
        if (typeof t.order !== 'number') t.order = 9999;
        return t;
    }

    function workAllTasks() { return Object.values(workData.tasks || {}).map(migrateWorkTask); }
    function workKategoriList() { return [...new Set([...WORK_KATEGORI, ...workAllTasks().map(t => t.kategori).filter(Boolean)])]; }
    function workByOrder(a, b) { return (a.order - b.order) || (a.createdAt || '').localeCompare(b.createdAt || ''); }
    function workNextOrder() { return workAllTasks().reduce((m, t) => (t.order < 9999 ? Math.max(m, t.order) : m), 0) + 1; }
    function workLastLog(t) { return t.logs.length ? t.logs[t.logs.length - 1] : null; }
    function workLastLogDate(t) { const dated = t.logs.filter(l => l.date); return dated.length ? (dated[dated.length - 1].end || dated[dated.length - 1].date) : null; }

    function workTodayEntries(t) {
        const today = workTodayIso();
        const hits = t.logs.filter(l => l.date && l.date <= today && today <= (l.end || l.date));
        if (t.deadline === today) hits.push({ text: 'Deadline hari ini' });
        return hits;
    }

    // ---------- Saran fokus hari ini (berbasis aturan, tanpa AI berbayar) ----------
    function buildWorkSuggestions(tasks) {
        const active = tasks.filter(t => t.status !== 'done').sort(workByOrder);
        const out = [];
        const used = new Set();
        const push = (t, text) => { if (out.length < 3 && !used.has(t.id)) { used.add(t.id); out.push(text); } };
        active.forEach(t => { const hit = workTodayEntries(t)[0]; if (hit) push(t, `Hari ini: ${t.title} - ${hit.text}`); });
        active.forEach(t => {
            const last = workLastLog(t);
            if (last && /reminder|\bfu\b|follow/i.test(last.text) && last.date && workDaysSince(last.end || last.date) >= 2) push(t, `Follow up lagi: ${t.title}${t.kode ? ` (${t.kode})` : ''}`);
        });
        active.filter(t => ['Utama', 'Approval Digital'].includes(t.kategori)).forEach(t => {
            const last = workLastLogDate(t);
            if (last) { const n = workDaysSince(last); if (n > 5) push(t, `Belum ada update ${n} hari: ${t.title}`); }
        });
        active.forEach(t => { if (['dev', 'test'].includes(t.status) && typeof t.progress === 'number' && t.progress < 20) push(t, `Progress masih ${t.progress}%: ${t.title}`); });
        return out;
    }

    // ---------- Render ----------
    function workCardMetaHtml(t) {
        const parts = [];
        if (t.tahap) parts.push(`<span class="wk-tahap" style="--c:${(WORK_STATUSES.find(s => s.key === t.status) || WORK_STATUSES[0]).color}">${workEsc(t.tahap)}</span>`);
        if (t.deadline) parts.push(`<span class="wk-due${t.deadline < workTodayIso() && t.status !== 'done' ? ' overdue' : ''}">${WK_ICON_CAL}${workFormatWhen(t.deadline)}</span>`);
        if (t.priority === 'high') parts.push(`<span class="wk-pri" style="--c:${WORK_PRIORITY.high.color}">Prioritas tinggi</span>`);
        const cl = t.checklist || [];
        if (cl.length) parts.push(`<span class="wk-cl${cl.every(c => c.done) ? ' full' : ''}">${WK_ICON_CHECK}${cl.filter(c => c.done).length}/${cl.length}</span>`);
        return parts.join('');
    }

    function workItemInnerHtml(t) {
        const head = [t.kode, t.kategori].filter(Boolean).map(workEsc).join(' · ');
        const last = workLastLog(t);
        const today = workTodayEntries(t).length > 0 && t.status !== 'done';
        const progress = typeof t.progress === 'number'
            ? `<div class="wk-progress"><div class="wk-progress-bar"><span style="width:${Math.max(0, Math.min(100, t.progress))}%"></span></div><b>${t.progress}%</b></div>` : '';
        return `${head || today ? `<div class="wk-head">${head}${today ? '<span class="wk-today-badge">Hari ini</span>' : ''}</div>` : ''}
            <div class="wk-title">${workEsc(t.title)}</div>
            <div class="wk-meta">${workCardMetaHtml(t)}</div>
            ${progress}
            ${last ? `<div class="wk-lastlog"><b>${workEsc(last.when)}</b> ${workEsc(last.text)}</div>` : ''}`;
    }

    function renderWork() {
        if (!isLoggedIn) return;
        const kategoriList = workKategoriList();
        const sel = document.getElementById('wk-filter-project');
        sel.innerHTML = `<option value="">Semua kategori</option>` + kategoriList.map(k => `<option value="${workEsc(k)}"${k === workFilterKategori ? ' selected' : ''}>${workEsc(k)}</option>`).join('');
        document.getElementById('wk-kategori-list').innerHTML = kategoriList.map(k => `<option value="${workEsc(k)}">`).join('');
        document.getElementById('wk-tab-list').classList.toggle('active', workView === 'list');
        document.getElementById('wk-tab-board').classList.toggle('active', workView === 'board');

        const tasks = workAllTasks().filter(t => !workFilterKategori || t.kategori === workFilterKategori);
        const active = tasks.filter(t => t.status !== 'done');
        const weekAgo = Date.now() - 7 * 86400000;
        const stats = [
            ['Project aktif', active.length, 'doing'],
            ['Jadwal hari ini', active.filter(t => workTodayEntries(t).length).length, 'today'],
            ['Di Testing', active.filter(t => t.status === 'test').length, 'test'],
            ['Selesai 7 hari', tasks.filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= weekAgo).length, 'done'],
        ];
        document.getElementById('wk-summary').innerHTML = stats.map(([label, n, cls]) =>
            `<div class="wk-stat ${cls}${n ? '' : ' zero'}"><b>${n}</b><span>${label}</span></div>`).join('');

        const sug = buildWorkSuggestions(tasks);
        document.getElementById('wk-focus').innerHTML = sug.length
            ? `<div class="wk-focus"><div class="wk-focus-title">Fokus hari ini</div><ol>${sug.map(s => `<li>${workEsc(s)}</li>`).join('')}</ol></div>` : '';

        document.getElementById('wk-body').innerHTML = workView === 'list' ? renderWorkList(tasks) : renderWorkBoard(tasks);
    }

    function workRowHtml(t) {
        const done = t.status === 'done';
        return `<div class="wk-row${done ? ' done' : ''}" data-id="${t.id}">
            <button class="wk-check${done ? ' on' : ''}" data-act="toggle" aria-label="${done ? 'Tandai belum selesai' : 'Tandai selesai'}">${WK_ICON_CHECK}</button>
            <div class="wk-row-main">${workItemInnerHtml(t)}</div>
        </div>`;
    }

    function renderWorkList(tasks) {
        if (!tasks.length) return `<div class="wk-empty">Belum ada project${workFilterKategori ? ' di kategori ini' : ''}. Klik <b>Import</b> buat tempel teks "List Start Task", atau <b>+ Tugas Baru</b>.</div>`;
        const active = tasks.filter(t => t.status !== 'done').sort(workByOrder);
        const todays = active.filter(t => workTodayEntries(t).length);
        const todayIds = new Set(todays.map(t => t.id));
        let html = todays.length ? `<div class="wk-group"><div class="wk-group-head today">Hari ini<span>${todays.length}</span></div>${todays.map(workRowHtml).join('')}</div>` : '';
        WORK_STATUSES.filter(s => s.key !== 'done').forEach(s => {
            const items = active.filter(t => t.status === s.key && !todayIds.has(t.id));
            if (!items.length) return;
            html += `<div class="wk-group"><div class="wk-group-head"><span class="wk-col-dot" style="background:${s.color}"></span>${s.label}<span>${items.length}</span></div>${items.map(workRowHtml).join('')}</div>`;
        });
        if (!active.length) html += `<div class="wk-empty">Semua project beres.</div>`;
        const done = tasks.filter(t => t.status === 'done').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
        if (done.length) {
            html += `<div class="wk-group"><button class="wk-group-head wk-done-toggle" data-act="toggle-done">Selesai<span>${done.length}</span><em>${workShowDone ? 'Sembunyikan' : 'Tampilkan'}</em></button>${workShowDone ? done.map(workRowHtml).join('') : ''}</div>`;
        }
        return html;
    }

    function renderWorkBoard(tasks) {
        return `<div class="wk-board">${WORK_STATUSES.map((s, si) => {
            const items = tasks.filter(t => t.status === s.key)
                .sort(s.key === 'done' ? (a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') : workByOrder);
            const prev = WORK_STATUSES[si - 1], next = WORK_STATUSES[si + 1];
            const cards = items.map(t => `<div class="wk-card${s.key === 'done' ? ' done' : ''}" draggable="true" data-id="${t.id}">
                    ${workItemInnerHtml(t)}
                    <div class="wk-card-move">
                        ${prev ? `<button data-act="move" data-to="${prev.key}" aria-label="Pindah ke ${prev.label}">‹ ${prev.label}</button>` : '<span></span>'}
                        ${next ? `<button data-act="move" data-to="${next.key}" aria-label="Pindah ke ${next.label}">${next.label} ›</button>` : ''}
                    </div>
                </div>`).join('');
            return `<div class="wk-col" data-status="${s.key}">
                <div class="wk-col-head"><span class="wk-col-dot" style="background:${s.color}"></span>${s.label}<span class="wk-col-count">${items.length}</span></div>
                <div class="wk-col-body">${cards || '<div class="wk-col-empty">Kosong</div>'}</div>
                <button class="wk-col-add" data-act="add" data-status="${s.key}">+ Tambah</button>
            </div>`;
        }).join('')}</div>`;
    }

    function setWorkStatus(id, status) {
        const t = workData.tasks[id];
        if (!t || t.status === status) return;
        migrateWorkTask(t);
        if (status === 'done') { t.prevStatus = t.status; t.prevTahap = t.tahap; }
        // Tahap teks yang nunjuk kolom lain diganti default kolom tujuan biar laporan tetap konsisten
        // (balik dari Selesai -> pakai teks tahap sebelum diselesaikan kalau masih cocok).
        if (t.status === 'done' && t.prevTahap && workTahapToColumn(t.prevTahap) === status) t.tahap = t.prevTahap;
        else if (workTahapToColumn(t.tahap) !== status) t.tahap = (WORK_STATUSES.find(s => s.key === status) || {}).tahap || t.tahap;
        t.status = status;
        t.completedAt = status === 'done' ? new Date().toISOString() : null;
        t.updatedAt = new Date().toISOString();
        saveWork();
        renderWork();
    }

    // ---------- Modal tambah/edit ----------
    function renderWorkChecklistEditor() {
        document.getElementById('wk-f-checklist').innerHTML = workEditChecklist.map((c, i) => `
            <div class="wk-cl-item${c.done ? ' done' : ''}">
                <button type="button" class="wk-check${c.done ? ' on' : ''}" data-cl-toggle="${i}" aria-label="Centang item">${WK_ICON_CHECK}</button>
                <span>${workEsc(c.text)}</span>
                <button type="button" class="wk-cl-del" data-cl-del="${i}" aria-label="Hapus item">&times;</button>
            </div>`).join('');
    }

    function renderWorkLogEditor() {
        // Terbaru di atas (data disimpan urut kronologis, sama kayak laporan).
        document.getElementById('wk-f-logs').innerHTML = workEditLogs.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => `
            <div class="wk-log-item">
                <b>${workEsc(l.when)}</b><span>${workEsc(l.text)}</span>
                <button type="button" class="wk-cl-del" data-log-del="${i}" aria-label="Hapus log">&times;</button>
            </div>`).join('') || '<div class="wk-log-empty">Belum ada log.</div>';
    }

    function syncWorkProgressInputs(v) {
        const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
        document.getElementById('wk-f-progress').value = n;
        document.getElementById('wk-f-progress-num').value = n;
    }

    function openWorkModal(id, presetStatus) {
        const t = id ? migrateWorkTask(workData.tasks[id]) : null;
        const status = t ? t.status : (presetStatus || 'antri');
        workEditId = t ? id : null;
        const $ = (x) => document.getElementById(x);
        $('work-modal-title').innerText = t ? 'Edit Project / Tugas' : 'Project / Tugas Baru';
        $('wk-f-title').value = t ? t.title : '';
        $('wk-f-kode').value = t ? (t.kode || '') : '';
        $('wk-f-kategori').value = t ? (t.kategori || '') : (workFilterKategori || '');
        $('wk-f-status').value = status;
        $('wk-f-tahap').value = t ? (t.tahap || '') : (WORK_STATUSES.find(s => s.key === status) || {}).tahap || '';
        syncWorkProgressInputs(t && typeof t.progress === 'number' ? t.progress : 0);
        $('wk-f-order').value = t && t.order < 9999 ? t.order : workNextOrder();
        $('wk-f-priority').value = t ? (t.priority || 'medium') : 'medium';
        $('wk-f-deadline').value = t ? (t.deadline || '') : '';
        $('wk-f-notes').value = t ? (t.notes || '') : '';
        $('wk-f-cl-input').value = '';
        $('wk-f-log-date').value = workTodayIso();
        $('wk-f-log-text').value = '';
        workEditChecklist = t ? (t.checklist || []).map(c => ({ ...c })) : [];
        workEditLogs = t ? t.logs.map(l => ({ ...l })) : [];
        renderWorkChecklistEditor();
        renderWorkLogEditor();
        $('wk-f-more').open = !!(t && (t.deadline || t.notes || (t.checklist || []).length || t.priority === 'high'));
        $('wk-f-delete').style.display = t ? '' : 'none';
        $('work-modal').style.display = 'flex';
        setTimeout(() => $('wk-f-title').focus(), 50);
    }

    function closeWorkModal() { document.getElementById('work-modal').style.display = 'none'; workEditId = null; }

    function addWorkChecklistItem() {
        const input = document.getElementById('wk-f-cl-input');
        const text = input.value.trim();
        if (!text) return;
        workEditChecklist.push({ text, done: false });
        input.value = '';
        renderWorkChecklistEditor();
    }

    function addWorkLogItem() {
        const textEl = document.getElementById('wk-f-log-text');
        const text = textEl.value.trim();
        if (!text) return;
        const iso = document.getElementById('wk-f-log-date').value || workTodayIso();
        workEditLogs.push({ when: workFormatWhen(iso), date: iso, end: iso, text });
        workEditLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        textEl.value = '';
        renderWorkLogEditor();
    }

    function saveWorkModal() {
        const $ = (x) => document.getElementById(x);
        const title = $('wk-f-title').value.trim();
        if (!title) { showToast('Judul wajib diisi.', 'err'); $('wk-f-title').focus(); return; }
        if ($('wk-f-cl-input').value.trim()) addWorkChecklistItem();
        if ($('wk-f-log-text').value.trim()) addWorkLogItem();
        const now = new Date().toISOString();
        const id = workEditId || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        const prev = workData.tasks[id] || { createdAt: now };
        const status = $('wk-f-status').value;
        const orderVal = parseInt($('wk-f-order').value, 10);
        workData.tasks[id] = {
            ...prev, id, title,
            kode: $('wk-f-kode').value.trim(),
            kategori: $('wk-f-kategori').value.trim(),
            status,
            tahap: $('wk-f-tahap').value.trim(),
            progress: Number($('wk-f-progress-num').value) || 0,
            order: Number.isFinite(orderVal) ? orderVal : workNextOrder(),
            logs: workEditLogs,
            priority: $('wk-f-priority').value,
            deadline: $('wk-f-deadline').value || null,
            notes: $('wk-f-notes').value.trim(),
            checklist: workEditChecklist,
            prevStatus: status === 'done' ? (prev.status !== 'done' ? prev.status : prev.prevStatus) : null,
            completedAt: status === 'done' ? (prev.status === 'done' && prev.completedAt ? prev.completedAt : now) : null,
            updatedAt: now,
        };
        saveWork();
        closeWorkModal();
        renderWork();
        showToast(workEditId ? 'Tersimpan.' : 'Ditambahkan.', 'ok', 2500);
    }

    // ---------- Import teks "List Start Task" ----------
    function parseStartTaskText(text) {
        const items = [];
        let cur = null;
        text.split(/\r?\n/).forEach(raw => {
            const line = raw.trim();
            const head = line.match(/^(\d+)\.\s+(.+)$/);
            if (head) {
                const segs = head[2].split('|').map(s => s.trim()).filter((s, i, arr) => s !== '' || i < arr.length - 1);
                const item = { order: Number(head[1]), kategori: segs.shift() || '', kode: '', title: '', tahap: '', progress: null, logs: [] };
                if (segs.length && /^\d{5,}$/.test(segs[0])) item.kode = segs.shift();
                if (segs.length && /^\d{1,3}\s*%$/.test(segs[segs.length - 1])) item.progress = parseInt(segs.pop(), 10);
                if (item.progress != null && segs.length > 1) item.tahap = segs.pop();
                item.title = segs.join(' | ') || item.kategori;
                cur = item;
                items.push(item);
                return;
            }
            const log = line.match(/^\*\s*(.+?)\s*:\s*(.+)$/);
            if (log && cur) {
                const when = log[1].replace(/\s+/g, ' ');
                cur.logs.push({ when, ...parseWorkWhen(when), text: log[2].trim() });
            }
        });
        return items;
    }

    function workFindMatch(item) {
        const tasks = workAllTasks();
        if (item.kode) return tasks.find(t => t.kode === item.kode && t.title === item.title) || tasks.find(t => t.kode === item.kode && !tasks.some(o => o !== t && o.kode === item.kode));
        return tasks.find(t => !t.kode && t.title.toLowerCase() === item.title.toLowerCase());
    }

    function previewWorkImport() {
        const items = parseStartTaskText(document.getElementById('wk-import-text').value);
        const box = document.getElementById('wk-import-preview');
        if (!items.length) { workImportPending = null; box.innerHTML = '<div class="wk-log-empty">Gak ada baris project yang kebaca. Pastikan formatnya "1. Kategori | Kode | Judul | Tahap | 70%".</div>'; document.getElementById('wk-import-apply').disabled = true; return; }
        workImportPending = items.map(it => ({ ...it, match: workFindMatch(it) }));
        const nNew = workImportPending.filter(i => !i.match).length;
        box.innerHTML = `<div class="wk-import-sum"><b>${workImportPending.length}</b> project kebaca: <b>${nNew}</b> baru, <b>${workImportPending.length - nNew}</b> diupdate.</div>` +
            workImportPending.map(i => {
                const col = WORK_STATUSES.find(s => s.key === workTahapToColumn(i.tahap));
                return `<div class="wk-import-row"><span class="wk-import-tag ${i.match ? 'upd' : 'new'}">${i.match ? 'Update' : 'Baru'}</span>
                    <div><div class="wk-title">${i.order}. ${workEsc(i.title)}</div>
                    <div class="wk-import-info">${[i.kode, i.kategori].filter(Boolean).map(workEsc).join(' · ')} → <b style="color:${col.color}">${col.label}</b>${i.progress != null ? ` · ${i.progress}%` : ''} · ${i.logs.length} log</div></div></div>`;
            }).join('');
        document.getElementById('wk-import-apply').disabled = false;
    }

    function applyWorkImport() {
        if (!workImportPending) return;
        const now = new Date().toISOString();
        workImportPending.forEach(i => {
            const status = workTahapToColumn(i.tahap);
            const base = i.match || { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: now, priority: 'medium', checklist: [], notes: '', deadline: null };
            workData.tasks[base.id] = {
                ...base,
                title: i.title, kode: i.kode, kategori: i.kategori, tahap: i.tahap, order: i.order,
                progress: i.progress, logs: i.logs, status,
                completedAt: status === 'done' ? (base.completedAt || now) : null,
                updatedAt: now,
            };
        });
        const n = workImportPending.length;
        workImportPending = null;
        saveWork();
        document.getElementById('work-import-modal').style.display = 'none';
        renderWork();
        showToast(`${n} project di-import.`, 'ok', 3000);
    }

    // ---------- Export teks "List Start Task" ----------
    function buildStartTaskText() {
        const name = (document.getElementById('wk-export-name').value || 'Hasan').trim();
        const d = new Date();
        const lines = [`List Start Task ${name}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()} :`, '', '> Urutan Berdasarkan Prioritas :', ''];
        const active = workAllTasks().filter(t => t.status !== 'done').sort(workByOrder);
        active.forEach((t, i) => {
            const segs = [t.kategori, t.kode, t.title, t.tahap, typeof t.progress === 'number' ? `${t.progress}%` : ''].filter(s => s !== '' && s != null);
            lines.push(`${i + 1}. ${segs.join(' | ')}`);
            t.logs.slice(-3).forEach(l => lines.push(`* ${l.when} : ${l.text}`));
            lines.push('');
        });
        const sug = buildWorkSuggestions(workAllTasks());
        if (sug.length) {
            lines.push('> Rekomendasi Fokus Hari Ini :', '');
            sug.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        }
        return lines.join('\n').replace(/\n+$/, '');
    }

    function refreshWorkExport() { document.getElementById('wk-export-text').value = buildStartTaskText(); }

    function copyWorkExport() {
        const ta = document.getElementById('wk-export-text');
        const done = () => showToast('Tersalin. Tinggal paste di WA.', 'ok', 2500);
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(ta.value).then(done).catch(() => { ta.select(); document.execCommand('copy'); done(); });
        } else { ta.select(); document.execCommand('copy'); done(); }
    }

    // ---------- Event ----------
    const $w = (x) => document.getElementById(x);
    $w('wk-tab-list').onclick = () => { workView = 'list'; renderWork(); };
    $w('wk-tab-board').onclick = () => { workView = 'board'; renderWork(); };
    $w('wk-filter-project').onchange = (e) => { workFilterKategori = e.target.value; renderWork(); };
    $w('wk-new').onclick = () => openWorkModal(null);
    $w('wk-import').onclick = () => { $w('wk-import-text').value = ''; $w('wk-import-preview').innerHTML = ''; $w('wk-import-apply').disabled = true; workImportPending = null; $w('work-import-modal').style.display = 'flex'; setTimeout(() => $w('wk-import-text').focus(), 50); };
    $w('wk-import-text').addEventListener('input', previewWorkImport);
    $w('wk-import-apply').onclick = applyWorkImport;
    $w('wk-export').onclick = () => { try { $w('wk-export-name').value = localStorage.getItem('work_report_name') || 'Hasan'; } catch (e) { $w('wk-export-name').value = 'Hasan'; } refreshWorkExport(); $w('work-export-modal').style.display = 'flex'; };
    $w('wk-export-name').addEventListener('input', () => { try { localStorage.setItem('work_report_name', $w('wk-export-name').value.trim()); } catch (e) { /* abaikan */ } refreshWorkExport(); });
    $w('wk-export-copy').onclick = copyWorkExport;
    ['work-modal', 'work-import-modal', 'work-export-modal'].forEach(mid => {
        $w(mid).addEventListener('click', (e) => { if (e.target.id === mid) { if (mid === 'work-modal') closeWorkModal(); else $w(mid).style.display = 'none'; } });
    });
    document.querySelectorAll('[data-close-modal]').forEach(btn => { btn.onclick = () => { $w(btn.dataset.closeModal).style.display = 'none'; if (btn.dataset.closeModal === 'work-modal') workEditId = null; }; });
    $w('wk-f-save').onclick = saveWorkModal;
    $w('wk-f-cl-add').onclick = addWorkChecklistItem;
    $w('wk-f-cl-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWorkChecklistItem(); } });
    $w('wk-f-log-add').onclick = addWorkLogItem;
    $w('wk-f-log-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWorkLogItem(); } });
    $w('wk-f-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveWorkModal(); } });
    $w('wk-f-progress').addEventListener('input', (e) => syncWorkProgressInputs(e.target.value));
    $w('wk-f-progress-num').addEventListener('input', (e) => { $w('wk-f-progress').value = e.target.value; });
    $w('wk-f-progress-num').addEventListener('change', (e) => syncWorkProgressInputs(e.target.value));
    // Kolom & teks tahap saling ngikut: ganti kolom -> tahap default kolom itu; ketik tahap -> kolom yang cocok.
    $w('wk-f-status').addEventListener('change', (e) => {
        if (workTahapToColumn($w('wk-f-tahap').value) !== e.target.value) $w('wk-f-tahap').value = (WORK_STATUSES.find(s => s.key === e.target.value) || {}).tahap || '';
    });
    $w('wk-f-tahap').addEventListener('change', (e) => { if (e.target.value.trim()) $w('wk-f-status').value = workTahapToColumn(e.target.value); });
    $w('wk-f-checklist').onclick = (e) => {
        const tog = e.target.closest('[data-cl-toggle]');
        const del = e.target.closest('[data-cl-del]');
        if (tog) { const c = workEditChecklist[Number(tog.dataset.clToggle)]; c.done = !c.done; renderWorkChecklistEditor(); }
        if (del) { workEditChecklist.splice(Number(del.dataset.clDel), 1); renderWorkChecklistEditor(); }
    };
    $w('wk-f-logs').onclick = (e) => {
        const del = e.target.closest('[data-log-del]');
        if (del) { workEditLogs.splice(Number(del.dataset.logDel), 1); renderWorkLogEditor(); }
    };
    $w('wk-f-delete').onclick = () => {
        const id = workEditId;
        if (!id) return;
        showConfirm('Hapus project/tugas ini? Gak bisa dikembalikan.', () => {
            delete workData.tasks[id];
            saveWork();
            closeWorkModal();
            renderWork();
            showToast('Dihapus.', 'ok', 2500);
        });
    };

    const wkBody = $w('wk-body');
    wkBody.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        const item = e.target.closest('[data-id]');
        if (act) {
            const a = act.dataset.act;
            if (a === 'toggle-done') { workShowDone = !workShowDone; renderWork(); return; }
            if (a === 'add') { openWorkModal(null, act.dataset.status); return; }
            if (a === 'toggle' && item) { const t = workData.tasks[item.dataset.id]; setWorkStatus(item.dataset.id, t.status === 'done' ? (t.prevStatus || 'antri') : 'done'); return; }
            if (a === 'move' && item) { setWorkStatus(item.dataset.id, act.dataset.to); return; }
        }
        if (item) openWorkModal(item.dataset.id);
    });
    // Drag & drop kartu antar kolom (desktop). Di HP pakai tombol "‹ / ›" di kartu.
    wkBody.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.wk-card');
        if (!card) return;
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
    });
    wkBody.addEventListener('dragend', (e) => { const card = e.target.closest('.wk-card'); if (card) card.classList.remove('dragging'); });
    wkBody.addEventListener('dragover', (e) => {
        const col = e.target.closest('.wk-col');
        if (!col) return;
        e.preventDefault();
        wkBody.querySelectorAll('.wk-col.drop').forEach(c => { if (c !== col) c.classList.remove('drop'); });
        col.classList.add('drop');
    });
    wkBody.addEventListener('dragleave', (e) => { const col = e.target.closest('.wk-col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    wkBody.addEventListener('drop', (e) => {
        const col = e.target.closest('.wk-col');
        if (!col) return;
        e.preventDefault();
        col.classList.remove('drop');
        setWorkStatus(e.dataTransfer.getData('text/plain'), col.dataset.status);
    });

    renderXAUCalendar();
});