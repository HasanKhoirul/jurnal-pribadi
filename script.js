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
    const defaultWealthHistory = { items: [], realMoney: 0 };
    if(!localStorage.getItem('wealth_data_v1')) { localStorage.setItem('wealth_data_v1', JSON.stringify(defaultWealthHistory)); }
    let wealthData = JSON.parse(localStorage.getItem('wealth_data_v1'));
    let aiTradeData = JSON.parse(localStorage.getItem('ai_trade_data_v1')) || {};
    let aiModalAwal = parseFloat(localStorage.getItem('ai_modal_awal')) || 2500000;

    // ==========================================
    // MODULE CLOUD SYNC (FIREBASE)
    // Dokumen "public": journalData/modalAwal/sportData -> bisa dibaca siapapun tanpa login (view-only kalau belum login, karena form/tombol edit di UI sudah otomatis ke-hide di locked-mode).
    // Dokumen per-UID: expData/wealthData -> cuma bisa dibaca & ditulis kalau login asli.
    // ==========================================
    let privateUnsub = null;
    let pushTimer = null;

    function saveData(key, obj) {
        localStorage.setItem(key, JSON.stringify(obj));
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            if (key === 'expense_data_v1' || key === 'wealth_data_v1' || key === 'ai_trade_data_v1' || key === 'ai_modal_awal') pushPrivateToCloud();
            else pushPublicToCloud();
        }, 800);
    }

    function pushPublicToCloud() {
        if (!auth.currentUser) return Promise.resolve();
        return db.collection('appData').doc('public').set({ journalData, modalAwal, sportData })
            .catch(err => { console.error('Gagal sync data publik ke cloud:', err); throw err; });
    }

    function pushPrivateToCloud() {
        if (!auth.currentUser) return Promise.resolve();
        return db.collection('appData').doc(auth.currentUser.uid).set({ expData, wealthData, aiTradeData, aiModalAwal })
            .catch(err => { console.error('Gagal sync data privat ke cloud:', err); throw err; });
    }

    function attachPublicListener() {
        db.collection('appData').doc('public').onSnapshot(doc => {
            if (doc.exists) {
                const d = doc.data();
                journalData = d.journalData || {}; modalAwal = d.modalAwal || 2500000; sportData = d.sportData || {};
                localStorage.setItem('xauusd_data_v3', JSON.stringify(journalData)); localStorage.setItem('xauusd_modal', modalAwal); localStorage.setItem('sport_data_v1', JSON.stringify(sportData));
                rerenderActiveSection();
            }
        }, err => console.error('Gagal ambil data publik dari cloud:', err));
    }

    function attachPrivateListener(uid) {
        if (privateUnsub) privateUnsub();
        privateUnsub = db.collection('appData').doc(uid).onSnapshot(doc => {
            if (doc.exists) {
                const d = doc.data();
                expData = d.expData || {}; wealthData = d.wealthData || defaultWealthHistory;
                aiTradeData = d.aiTradeData || {}; aiModalAwal = d.aiModalAwal || 2500000;
                localStorage.setItem('expense_data_v1', JSON.stringify(expData)); localStorage.setItem('wealth_data_v1', JSON.stringify(wealthData));
                localStorage.setItem('ai_trade_data_v1', JSON.stringify(aiTradeData)); localStorage.setItem('ai_modal_awal', aiModalAwal);
                rerenderActiveSection();
            }
        }, err => { console.error('Gagal ambil data privat dari cloud:', err); alert('Gagal ambil data privat: ' + err.code); });
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
        else if (targetId === 'view-ai-trading' && isLoggedIn) { if (document.getElementById('ai-menu-dashboard').classList.contains('active')) renderAiDashboard(); else if (document.getElementById('ai-menu-calendar').classList.contains('active')) renderAiCalendar(); }
    }

    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    function formatRupiah(angka) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka); }
    let globalNavDate = new Date();

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

    let isLoggedIn = false;

    function resetActivityTimer() { if(isLoggedIn) localStorage.setItem('lastActivity', Date.now()); }
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivityTimer));

    function checkInactivity() {
        if(isLoggedIn) {
            const lastAct = parseInt(localStorage.getItem('lastActivity') || '0');
            if(Date.now() - lastAct > 30 * 60 * 1000) {
                auth.signOut(); alert("Sesi habis (30 menit tanpa aktivitas). Silakan login kembali.");
            }
        }
    }
    setInterval(checkInactivity, 60000); checkInactivity();

    function applyAuthState() {
        const btnLogin = document.getElementById('btn-login');
        const btnUpload = document.getElementById('btn-upload-cloud');
        if (isLoggedIn) {
            document.body.classList.remove('locked-mode');
            btnLogin.innerHTML = '🔓 Logout'; btnLogin.style.borderColor = '#ff1744'; btnLogin.style.color = '#ff1744';
            if (btnUpload) btnUpload.style.display = 'block';
            resetActivityTimer();
        } else {
            document.body.classList.add('locked-mode');
            btnLogin.innerHTML = '🔒 Login System'; btnLogin.style.borderColor = '#ffd700'; btnLogin.style.color = '#ffd700';
            if (btnUpload) btnUpload.style.display = 'none';
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
        if (user) attachPrivateListener(user.uid);
        else { if (privateUnsub) { privateUnsub(); privateUnsub = null; } stopAiAutoTick(); }
    });

    document.getElementById('btn-login').addEventListener('click', () => {
        if (isLoggedIn) { showConfirm("Yakin mau logout bos?", () => { auth.signOut(); }); }
        else { document.getElementById('login-modal').style.display = 'flex'; }
    });

    document.getElementById('btn-upload-cloud').addEventListener('click', () => {
        showConfirm("Ini akan MENIMPA data cloud dengan data di device ini. Cuma pakai ini di device yang punya data paling lengkap. Yakin?", () => {
            Promise.all([pushPublicToCloud(), pushPrivateToCloud()]).then(() => {
                alert("Data lokal berhasil di-upload ke Cloud!");
            }).catch(err => {
                alert("Gagal upload ke Cloud: " + err.code + "\n" + err.message);
            });
        });
    });

    const togglePassBtn = document.getElementById('toggle-pass');
    if(togglePassBtn) {
        togglePassBtn.addEventListener('click', function() {
            const passInput = document.getElementById('login-pass');
            if (passInput.type === 'password') { passInput.type = 'text'; this.innerText = '🙈'; }
            else { passInput.type = 'password'; this.innerText = '👁️'; }
        });
    }

    document.getElementById('btn-submit-login').addEventListener('click', () => {
        const uRaw = document.getElementById('login-user').value.trim().toLowerCase(); const p = document.getElementById('login-pass').value;
        const u = uRaw.includes('@') ? uRaw : uRaw + '@jurnal.local';
        auth.signInWithEmailAndPassword(u, p).then(() => {
            document.getElementById('login-modal').style.display = 'none'; document.getElementById('login-user').value = ''; document.getElementById('login-pass').value = ''; document.getElementById('login-pass').type = 'password';
            if(togglePassBtn) togglePassBtn.innerText = '👁️';
            alert("Akses Dibuka! Selamat datang 🚀");
        }).catch((err) => { console.error(err); alert("Login gagal: " + err.code + "\n" + err.message); });
    });

    const titleMap = { 'view-home': 'Pusat Kendali', 'view-trading': 'Jurnal XAUUSD', 'view-ai-trading': 'Trading AI', 'view-expenses': 'Pengeluaran Bulanan', 'view-sports': 'Jurnal Olahraga', 'view-wealth': 'History Kekayaan', 'view-career': 'Peningkatan Karir', 'view-roadmap': 'Roadmap Masa Depan' };

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
            if (targetId !== 'view-ai-trading') stopAiAutoTick();
        });
    });

    window.showConfirm = function(msg, onYes) {
        document.getElementById('confirm-msg').innerText = msg; document.getElementById('custom-confirm').style.display = 'flex';
        document.getElementById('confirm-yes').onclick = function() { document.getElementById('custom-confirm').style.display = 'none'; onYes(); };
        document.getElementById('confirm-no').onclick = function() { document.getElementById('custom-confirm').style.display = 'none'; };
    }

    const emptyStateHTML = `<h3 style="color:#ffd700; margin-bottom:10px;">Belum ada transaksi/progress bulan ini yah 👀</h3><p style="color:#aaa;">Semoga kamu di bulan sebelumnya dan ini akan lebih baik gituu! 🚀</p>`;

    // ==========================================
    // MODULE EXPORT CSV SUPER LENGKAP
    // ==========================================
    let currentExportType = '';
    window.openExportMenu = function(type) {
        currentExportType = type;
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
        } else if (currentExportType === 'wealth') {
            csvContent += "ID,Tanggal,Jenis Transaksi,Keterangan,Jumlah (Rp)\n";
            wealthData.items.forEach(t => {
                if(period === 'all' || t.date.startsWith(targetPrefix)) {
                    let notes = t.note ? t.note.replace(/"/g, '""') : '';
                    let row = [t.id, t.date, t.type, `"${notes}"`, t.amount];
                    csvContent += row.join(",") + "\n";
                }
            });
        }
        
        var encodedUri = encodeURI(csvContent);
        var link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Data_${currentExportType}_${period === 'all' ? 'All' : targetPrefix}.csv`);
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
                    const rows = parseCSVRows(ev.target.result);
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
        
        let expHtml = '';
        if(!isLoggedIn) { expHtml = `<div style="display:flex; align-items:center; gap:10px; margin-top:10px;"><span style="font-size:2rem;">🔒</span><div><h4 style="color:#aaa;">Terkunci</h4><p style="font-size:0.75rem; color:#666;">Login System untuk melihat</p></div></div>`; } 
        else { let expTotal = 0; for(let d in expData) { if(d.startsWith(targetPrefix)) expData[d].forEach(t => expTotal += parseFloat(t.amount)); } expHtml = `<h3 style="color:#ff1744; margin-top:10px;">-${formatRupiah(expTotal)}</h3><p style="font-size:0.8rem; color:#aaa;">Pengeluaran ${monthNames[m]} ${y}</p>`; }
        
        let wealthHtml = '';
        if(!isLoggedIn) { wealthHtml = `<div style="display:flex; align-items:center; gap:10px; margin-top:10px;"><span style="font-size:2rem;">🔒</span><div><h4 style="color:#aaa;">Terkunci</h4><p style="font-size:0.75rem; color:#666;">Login System untuk melihat</p></div></div>`; } 
        else {
            let wInc = 0, wExp = 0; wealthData.items.forEach(i => { if(i.type === 'income') wInc += parseFloat(i.amount); else wExp += parseFloat(i.amount); });
            let defisit = (wInc - wExp) - wealthData.realMoney;
            if(defisit > 0) wealthHtml = `<h3 style="color:#ff1744; margin-top:10px;">Defisit: ${formatRupiah(defisit)}</h3><p style="font-size:0.8rem; color:#aaa;">Target Recovery</p>`;
            else wealthHtml = `<h3 style="color:#00e676; margin-top:10px;">Aman / Surplus</h3><p style="font-size:0.8rem; color:#aaa;">Tabungan terjaga</p>`;
        }

        const homeWidgets = document.getElementById('home-widgets');
        if(homeWidgets) {
            homeWidgets.innerHTML = `
                <div class="dash-card"><h3 style="color:#ffd700; border-bottom: 1px dashed #444; padding-bottom:10px;">📊 Performa XAUUSD</h3><h3 class="${xauPl >= 0 ? 'profit-text' : 'loss-text'}" style="margin-top:10px;">${xauPl > 0 ? '+' : ''}${formatRupiah(xauPl)}</h3><p style="font-size:0.8rem; color:#aaa;">P/L Bulan ${monthNames[m]} ${y}</p></div>
                <div class="dash-card"><h3 style="color:#ff1744; border-bottom: 1px dashed #444; padding-bottom:10px;">🛒 Belanja Bulanan</h3>${expHtml}</div>
                <div class="dash-card"><h3 style="color:#2196f3; border-bottom: 1px dashed #444; padding-bottom:10px;">🏃‍♂️ Jurnal Olahraga</h3><h3 style="color:#2196f3; margin-top:10px;">${sportSesi} Sesi | ${sportMenit} Menit</h3><p style="font-size:0.8rem; color:#aaa;">Aktivitas Fisik ${monthNames[m]} ${y}</p></div>
                <div class="dash-card"><h3 style="color:#ffb300; border-bottom: 1px dashed #444; padding-bottom:10px;">💰 Status Kekayaan</h3>${wealthHtml}</div>
            `;
        }
    }
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
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData?(weeklyPl>0?'weekly-profit':'weekly-loss'):'empty-card'}`;
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
            document.getElementById('today-history').innerHTML += `<div class="history-item ${t.pl>0?'hist-profit':'hist-loss'}"><div><strong>${formatRupiah(t.pl)}</strong><br><span style="color:#aaa; font-size:0.75rem;">[${t.tf}] ${t.arah} | Layer: ${(t.layers||[]).length}</span></div><div class="action-group">${upBtn}${downBtn}<button type="button" class="edit-btn" onclick="editXAUTrade('${dateStr}', ${i})">✏️</button><button type="button" class="del-btn" onclick="deleteXAUTrade('${dateStr}', ${i})">🗑️</button></div></div>`; 
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
                monthHasData = true; weeklyReports[wIdx].hasData = true; labels.push(`Tgl ${i}`);
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
            tbody.innerHTML += `<tr><td>${i+1}</td><td>${e.date}</td><td>${e.tf||'-'}</td><td>${e.arah||'-'}</td><td>${e.duration||'-'}</td><td>${layersCount} L</td><td style="white-space: normal; line-height: 1.6; min-width: 250px;">${e.alasan||'-'}</td><td align="right" class="${e.plVal>=0?'profit-text':'loss-text'}"><strong>${formatRupiah(e.plVal)}</strong></td></tr>`;
        });
    }

    // ==========================================
    // MODUL TRADING AI (SIMULASI PAPER TRADING)
    // ==========================================
    let currentAiDateStr = null; let calWidgetLoaded = false;
    let aiChart = null, aiCandleSeries = null, aiPriceLines = [];
    let aiTickInterval = null; let lastAiCandles = null;
    let aiTimeframe = '5min';

    // 1 pip = 0.1 harga (konsisten sama perhitungan "Pips" di Jurnal XAUUSD manual). Lot 0.1 Cent Exness: 1 pip = 1 USC (dari contoh broker user).
    const AI_PIP_SIZE = 0.1;
    const AI_LOT_SIZE = 0.1;
    const AI_SL_PIPS = 50;
    const AI_TP_LAYERS_PIPS = [80, 100, 150];
    function pipToPrice(pips) { return pips * AI_PIP_SIZE; }
    function calcLayerPlUsc(pips) { return pips * (AI_LOT_SIZE / 0.1) * 1; }
    function uscToRupiah(usc) { return (usc / 100) * liveKursIDR; }

    function getAiSettings() {
        return {
            twelvedata: localStorage.getItem('ai_key_twelvedata') || '',
            llmProvider: localStorage.getItem('ai_llm_provider') || 'none',
            llmKey: localStorage.getItem('ai_key_llm') || ''
        };
    }

    document.getElementById('btn-ai-settings').onclick = () => {
        const s = getAiSettings();
        document.getElementById('ai-key-twelvedata').value = s.twelvedata;
        document.getElementById('ai-llm-provider').value = s.llmProvider;
        document.getElementById('ai-key-llm').value = s.llmKey;
        document.getElementById('ai-settings-modal').style.display = 'flex';
    };
    document.getElementById('btn-save-ai-settings').onclick = () => {
        localStorage.setItem('ai_key_twelvedata', document.getElementById('ai-key-twelvedata').value.trim());
        localStorage.setItem('ai_llm_provider', document.getElementById('ai-llm-provider').value);
        localStorage.setItem('ai_key_llm', document.getElementById('ai-key-llm').value.trim());
        document.getElementById('ai-settings-modal').style.display = 'none';
        alert('Settings tersimpan di device ini.');
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
                aiCandleSeries = aiChart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff1744', borderVisible: false, wickUpColor: '#00e676', wickDownColor: '#ff1744' });
                window.addEventListener('resize', () => { if (aiChart) aiChart.applyOptions({ width: container.clientWidth }); });
            }
            aiCandleSeries.setData(candles.map(c => ({ time: Math.floor(new Date(c.time).getTime() / 1000), open: c.open, high: c.high, low: c.low, close: c.close })));
            const openInfo = findOpenAiTrade();
            if (openInfo) updateTradeLines(openInfo.trade); else clearAiPriceLines();
        });
    }

    document.getElementById('ai-menu-market').addEventListener('click', function() {
        this.classList.add('active'); document.getElementById('ai-menu-calendar').classList.remove('active'); document.getElementById('ai-menu-dashboard').classList.remove('active');
        document.getElementById('ai-view-market').style.display = 'block'; document.getElementById('ai-view-calendar').style.display = 'none'; document.getElementById('ai-view-dashboard').style.display = 'none';
        loadEconomicCalendarWidget();
        if (lastAiCandles) renderLightweightChart(lastAiCandles);
    });
    document.getElementById('btn-ai-refresh-market').addEventListener('click', function() {
        this.disabled = true; this.innerText = '⏳ Refresh...';
        aiDisplayTick().finally(() => { this.disabled = false; this.innerText = '🔄 Refresh'; });
    });
    document.getElementById('ai-menu-calendar').addEventListener('click', function() {
        this.classList.add('active'); document.getElementById('ai-menu-market').classList.remove('active'); document.getElementById('ai-menu-dashboard').classList.remove('active');
        document.getElementById('ai-view-market').style.display = 'none'; document.getElementById('ai-view-calendar').style.display = 'block'; document.getElementById('ai-view-dashboard').style.display = 'none';
        renderAiCalendar();
    });
    document.getElementById('ai-menu-dashboard').addEventListener('click', function() {
        this.classList.add('active'); document.getElementById('ai-menu-market').classList.remove('active'); document.getElementById('ai-menu-calendar').classList.remove('active');
        document.getElementById('ai-view-market').style.display = 'none'; document.getElementById('ai-view-calendar').style.display = 'none'; document.getElementById('ai-view-dashboard').style.display = 'block';
        renderAiDashboard();
    });

    document.getElementById('ai-modal-box').onclick = () => {
        const val = prompt('Masukkan modal simulasi baru (Rp):', aiModalAwal);
        if (val === null) return;
        const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
        if (isNaN(num) || num <= 0) { alert('Angka gak valid.'); return; }
        aiModalAwal = num;
        saveData('ai_modal_awal', aiModalAwal);
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

    // --- Guard waktu: hindari auto-entry saat market tutup / ada berita high-impact ---
    function isMarketOpen() {
        const now = new Date(); const day = now.getUTCDay(); const hour = now.getUTCHours();
        if (day === 6) return false;
        if (day === 0 && hour < 22) return false;
        if (day === 5 && hour >= 21) return false;
        return true;
    }
    // Fallback kalau fetch kalender berita gagal (endpoint komunitas non-resmi, bisa down/berubah format) — perkiraan jam umum rilis data AS.
    function isHighImpactNewsWindowFallback() {
        const now = new Date(); const day = now.getUTCDay(); const hour = now.getUTCHours();
        if (day === 0 || day === 6) return false;
        return hour >= 12 && hour < 15;
    }
    const AI_NEWS_PRE_MINUTES = 10;
    const AI_NEWS_POST_MINUTES = 40;
    async function fetchActiveHighImpactNews() {
        try {
            const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
            const events = await res.json();
            const now = Date.now();
            const hit = events.find(e => {
                if (e.impact !== 'High' || e.country !== 'USD') return false;
                const t = new Date(e.date).getTime();
                return now >= t - AI_NEWS_PRE_MINUTES * 60000 && now <= t + AI_NEWS_POST_MINUTES * 60000;
            });
            return hit ? { title: hit.title, time: hit.date } : null;
        } catch (err) {
            console.error('Gagal ambil kalender berita, fallback ke perkiraan jam kasar:', err.message);
            return isHighImpactNewsWindowFallback() ? { title: '(perkiraan, kalender gagal diambil)', time: null } : null;
        }
    }

    async function fetchAiPriceData() {
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

    async function polishReasonWithLLM(rawReason, settings) {
        const prompt_ = `Tuliskan ulang analisa trading berikut jadi lebih natural dan enak dibaca dalam Bahasa Indonesia, TANPA mengubah angka atau menambah fakta baru:\n\n${rawReason}`;
        try {
            if (settings.llmProvider === 'gemini') {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${settings.llmKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt_ }] }] }) });
                const data = await res.json();
                return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            } else if (settings.llmProvider === 'claude') {
                const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': settings.llmKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt_ }] }) });
                const data = await res.json();
                return data?.content?.[0]?.text || null;
            }
        } catch (err) { console.error('LLM polish gagal, fallback ke template:', err); return null; }
        return null;
    }

    // Adaptif: kalau win rate tipe sinyal tertentu lagi jelek belakangan ini, bot skip generate sinyal itu dulu (proporsi entry condong ke yang lebih akurat).
    const AI_MIN_SIGNAL_WINRATE = 35;
    const AI_WINRATE_LOOKBACK_DAYS = 14;
    const AI_WINRATE_MIN_SAMPLES = 5;
    function getRecentSignalWinRate(tradeData, signalType) {
        const cutoff = Date.now() - AI_WINRATE_LOOKBACK_DAYS * 86400000;
        let total = 0, win = 0;
        for (const d in tradeData) {
            if (new Date(d).getTime() < cutoff) continue;
            tradeData[d].forEach(t => {
                if (t.status !== 'closed' || t.signalType !== signalType) return;
                total++; if (parseFloat(t.pl || 0) >= 0) win++;
            });
        }
        return total >= AI_WINRATE_MIN_SAMPLES ? (win / total) * 100 : null;
    }

    async function computeAiSuggestion(candles, tradeData) {
        const closes = candles.map(c => c.close);
        const lastClose = closes[closes.length - 1];
        const ma20 = calcSMA(closes, 20); const ma50 = calcSMA(closes, 50); const rsi = calcRSI(closes, 14);
        if (ma20 === null || ma50 === null || rsi === null) return null;

        const trend = ma20 > ma50 ? 'uptrend' : 'downtrend';
        let arah; let signalType;
        let reasonParts = [
            `Harga saat ini ${lastClose.toFixed(2)}.`,
            `MA20 (${ma20.toFixed(2)}) ${ma20 > ma50 ? 'di atas' : 'di bawah'} MA50 (${ma50.toFixed(2)}) → ${trend}.`,
            `RSI(14) = ${rsi.toFixed(1)} (${rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'netral'}).`
        ];
        if (rsi >= 70) { arah = 'SELL'; signalType = 'rsi_reversal'; reasonParts.push(`RSI overbought → potensi koreksi turun.`); }
        else if (rsi <= 30) { arah = 'BUY'; signalType = 'rsi_reversal'; reasonParts.push(`RSI oversold → potensi rebound naik.`); }
        else if (trend === 'uptrend') { arah = 'BUY'; signalType = 'trend_following'; reasonParts.push(`Trend naik & RSI netral → peluang BUY mengikuti trend.`); }
        else { arah = 'SELL'; signalType = 'trend_following'; reasonParts.push(`Trend turun & RSI netral → peluang SELL mengikuti trend.`); }

        const recentWr = getRecentSignalWinRate(tradeData, signalType);
        if (recentWr !== null && recentWr < AI_MIN_SIGNAL_WINRATE) {
            console.log(`Skip sinyal ${signalType}: win rate ${recentWr.toFixed(0)}% dalam ${AI_WINRATE_LOOKBACK_DAYS} hari terakhir (di bawah ambang ${AI_MIN_SIGNAL_WINRATE}%).`);
            return null;
        }

        // Confluence filter: MACD harus searah, kalau enggak, batalkan entry (kualitas sinyal lebih ketat)
        const macd = calcMACD(closes);
        if (macd) {
            const macdBullish = macd.macd > macd.signal;
            reasonParts.push(`MACD ${macdBullish ? 'bullish' : 'bearish'} (${macd.macd.toFixed(2)} vs signal ${macd.signal.toFixed(2)}).`);
            if ((arah === 'BUY' && !macdBullish) || (arah === 'SELL' && macdBullish)) {
                reasonParts.push(`MACD gak konfirmasi arah ${arah} → skip entry, tunggu konfirmasi lebih kuat.`);
                return null;
            }
        }
        const bb = calcBollinger(closes, 20, 2);
        if (bb) reasonParts.push(`Bollinger Band: harga ${lastClose.toFixed(2)} (upper ${bb.upper.toFixed(2)}, lower ${bb.lower.toFixed(2)}).`);

        const entry = lastClose;
        const dirSign = arah === 'BUY' ? 1 : -1;
        const sl = entry - dirSign * pipToPrice(AI_SL_PIPS);
        reasonParts.push(`Entry ${entry.toFixed(2)}, SL ${AI_SL_PIPS} pips (${sl.toFixed(2)}), TP berlapis ${AI_TP_LAYERS_PIPS.join('/')} pips, lot ${AI_LOT_SIZE} x3 layer.`);

        let reasonText = reasonParts.join(' ');
        const settings = getAiSettings();
        if (settings.llmProvider !== 'none' && settings.llmKey) {
            const polished = await polishReasonWithLLM(reasonText, settings);
            if (polished) reasonText = polished;
        }
        return { arah, entry, sl, dirSign, reasonText, tf: aiTimeframe, signalType };
    }

    function findOpenAiTrade() {
        for (const d in aiTradeData) {
            const list = aiTradeData[d];
            for (let i = 0; i < list.length; i++) { if (list[i].status === 'open') return { dateKey: d, index: i, trade: list[i] }; }
        }
        return null;
    }

    async function autoOpenAiPosition(candles) {
        const sug = await computeAiSuggestion(candles, aiTradeData);
        if (!sug) return;
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (!aiTradeData[dateStr]) aiTradeData[dateStr] = [];
        const layers = AI_TP_LAYERS_PIPS.map(tpPips => ({ tpPips, tp: sug.entry + sug.dirSign * pipToPrice(tpPips), lot: AI_LOT_SIZE, status: 'open', pl: 0, sl: sug.sl, slMoved: false }));
        aiTradeData[dateStr].push({ arah: sug.arah, tf: sug.tf, entry: sug.entry, sl: sug.sl, layers, alasan: sug.reasonText, signalType: sug.signalType, status: 'open', pl: 0, openedAt: new Date().toISOString(), closedAt: null });
        saveData('ai_trade_data_v1', aiTradeData);
        if (document.getElementById('ai-view-calendar').style.display !== 'none') renderAiCalendar();
        if (document.getElementById('ai-view-dashboard').style.display !== 'none') renderAiDashboard();
    }

    // Begitu TP1 (layer pertama, 80 pips) kena, layer 2 langsung dikunci profit +10 pips dan layer 3 ke breakeven — biar aman kalau harga balik arah.
    const AI_LOCK_PIPS_AFTER_TP1 = 10;

    // Paksa tutup semua layer yang masih open di harga market sekarang (dipakai buat news guard, pola sama kayak timeout).
    function forceCloseAllLayersAtMarket(trade, candles, statusLabel) {
        if (!trade.layers) return false;
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let changed = false;
        trade.layers.forEach(ly => {
            if (ly.status !== 'open') return;
            const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
            ly.status = statusLabel; ly.pl = uscToRupiah(calcLayerPlUsc(pipsMoved)); changed = true;
        });
        if (!changed) return false;
        trade.pl = trade.layers.reduce((sum, ly) => sum + (ly.status !== 'open' ? ly.pl : 0), 0);
        const allResolved = trade.layers.every(ly => ly.status !== 'open');
        if (allResolved) { trade.status = 'closed'; trade.closedAt = new Date().toISOString(); }
        return true;
    }

    function checkAndCloseAiPosition(openInfo, candles) {
        const { trade } = openInfo;
        if (!trade.openedAt) trade.openedAt = new Date().toISOString();
        if (!trade.layers) return false; // trade lama/manual tanpa struktur layer, biarkan diedit manual
        const openedTime = new Date(trade.openedAt).getTime();
        const relevantCandles = candles.filter(c => new Date(c.time).getTime() >= openedTime);
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let changed = false;

        for (const c of relevantCandles) {
            trade.layers.forEach((ly, idx) => {
                if (ly.status !== 'open') return;
                const slPrice = ly.sl !== undefined ? ly.sl : trade.sl;
                const slHit = trade.arah === 'BUY' ? c.low <= slPrice : c.high >= slPrice;
                if (slHit) {
                    const pipsAtSl = ((ly.sl - trade.entry) * dirSign) / AI_PIP_SIZE;
                    ly.status = pipsAtSl >= 0 ? 'be' : 'sl';
                    ly.pl = uscToRupiah(calcLayerPlUsc(pipsAtSl));
                    changed = true;
                    return;
                }
                const tpHit = trade.arah === 'BUY' ? c.high >= ly.tp : c.low <= ly.tp;
                if (tpHit) {
                    ly.status = 'tp'; ly.pl = uscToRupiah(calcLayerPlUsc(ly.tpPips)); changed = true;
                    if (idx === 0) {
                        const l2 = trade.layers[1], l3 = trade.layers[2];
                        if (l2 && l2.status === 'open' && !l2.slMoved) { l2.sl = trade.entry + dirSign * pipToPrice(AI_LOCK_PIPS_AFTER_TP1); l2.slMoved = true; }
                        if (l3 && l3.status === 'open' && !l3.slMoved) { l3.sl = trade.entry; l3.slMoved = true; }
                        console.log(`🔵 TP1 kena, layer 2 dikunci +${AI_LOCK_PIPS_AFTER_TP1} pips, layer 3 ke breakeven.`);
                    }
                }
            });
            if (trade.layers.every(ly => ly.status !== 'open')) break;
        }

        const stillHasOpenLayer = trade.layers.some(ly => ly.status === 'open');
        if (stillHasOpenLayer && (Date.now() - openedTime) / (1000 * 60 * 60 * 24) >= 3) {
            const lastClose = candles[candles.length - 1].close;
            trade.layers.forEach(ly => {
                if (ly.status !== 'open') return;
                const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
                ly.status = 'timeout'; ly.pl = uscToRupiah(calcLayerPlUsc(pipsMoved)); changed = true;
            });
        }

        if (!changed) return false;
        trade.pl = trade.layers.reduce((sum, ly) => sum + (ly.status !== 'open' ? ly.pl : 0), 0);
        const allResolved = trade.layers.every(ly => ly.status !== 'open');
        if (allResolved) { trade.status = 'closed'; trade.closedAt = new Date().toISOString(); }

        saveData('ai_trade_data_v1', aiTradeData);
        if (allResolved) { clearAiPriceLines(); document.getElementById('ai-floating-pl').innerHTML = ''; }
        if (document.getElementById('ai-view-calendar').style.display !== 'none') renderAiCalendar();
        if (document.getElementById('ai-view-dashboard').style.display !== 'none') renderAiDashboard();
        return allResolved;
    }

    function updateFloatingPl(openInfo, candles) {
        const trade = openInfo.trade;
        if (!trade.layers) return;
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        let totalFloating = 0;
        const layerRows = trade.layers.map((ly, i) => {
            if (ly.status !== 'open') { totalFloating += ly.pl; return `Layer ${i + 1} (TP ${ly.tpPips}p): <span class="${ly.pl >= 0 ? 'profit-text' : 'loss-text'}">${ly.status.toUpperCase()} ${ly.pl >= 0 ? '+' : ''}${formatRupiah(ly.pl)}</span>`; }
            const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
            const floatPl = uscToRupiah(calcLayerPlUsc(pipsMoved));
            totalFloating += floatPl;
            return `Layer ${i + 1} (TP ${ly.tpPips}p): <span class="${floatPl >= 0 ? 'profit-text' : 'loss-text'}">Floating ${floatPl >= 0 ? '+' : ''}${formatRupiah(floatPl)}</span>`;
        });
        const el = document.getElementById('ai-floating-pl');
        if (el) el.innerHTML = `<div class="insight-box ${totalFloating >= 0 ? 'insight-success' : 'insight-danger'}" style="flex-direction:column; align-items:flex-start; gap:6px;"><strong>${trade.arah} @ ${parseFloat(trade.entry).toFixed(2)} (Lot ${AI_LOT_SIZE} × 3 Layer) — Total: ${totalFloating >= 0 ? '+' : ''}${formatRupiah(totalFloating)}</strong><div style="font-size:0.8rem; font-weight:normal; display:flex; flex-direction:column; gap:3px;">${layerRows.join('')}</div></div>`;
    }

    // --- Tick "penuh" (buka/tutup posisi) — cuma dipanggil manual dari tombol. Otomatis 24/7-nya dijalankan server via GitHub Actions (scripts/ai-tick.mjs), biar gak dobel/race sama browser. ---
    async function aiAutoTick() {
        const candles = await fetchAiPriceData();
        if (!candles) return;
        lastAiCandles = candles;
        if (document.getElementById('ai-view-market').style.display !== 'none') renderLightweightChart(candles);

        const newsInfo = await fetchActiveHighImpactNews();
        const openInfo = findOpenAiTrade();
        updateLiveStatsBoxes(openInfo, candles);

        if (openInfo && newsInfo) {
            const closed = forceCloseAllLayersAtMarket(openInfo.trade, candles, 'news_close');
            if (closed) {
                console.log(`📰 Posisi ditutup paksa: berita high-impact "${newsInfo.title}".`);
                saveData('ai_trade_data_v1', aiTradeData);
                document.getElementById('ai-floating-pl').innerHTML = `<div class="insight-box insight-danger">📰 Posisi ditutup paksa: berita high-impact "${newsInfo.title}".</div>`;
                if (document.getElementById('ai-view-calendar').style.display !== 'none') renderAiCalendar();
                if (document.getElementById('ai-view-dashboard').style.display !== 'none') renderAiDashboard();
            }
            return;
        }

        if (openInfo) {
            const stillOpen = !checkAndCloseAiPosition(openInfo, candles);
            if (stillOpen) updateFloatingPl(openInfo, candles);
        } else if (!isMarketOpen()) {
            document.getElementById('ai-floating-pl').innerHTML = `<div class="insight-box insight-warning">💤 Market lagi tutup (weekend), bot standby nunggu buka lagi.</div>`;
        } else if (newsInfo) {
            document.getElementById('ai-floating-pl').innerHTML = `<div class="insight-box insight-warning">📰 Berita high-impact "${newsInfo.title}" lagi berlangsung, bot menunda entry baru.</div>`;
        } else {
            document.getElementById('ai-floating-pl').innerHTML = '';
            await autoOpenAiPosition(candles);
            const newOpenInfo = findOpenAiTrade();
            updateLiveStatsBoxes(newOpenInfo, candles);
            if (!newOpenInfo) {
                document.getElementById('ai-floating-pl').innerHTML = `<div class="insight-box insight-warning">🔍 Belum ada sinyal valid tick ini (nunggu konfirmasi trend/RSI/MACD). Mohon tunggu, bot bakal coba lagi tick berikutnya.</div>`;
            }
        }
    }

    function updateLiveStatsBoxes(openInfo, candles) {
        const priceEl = document.getElementById('ai-live-price');
        const entryEl = document.getElementById('ai-live-entry');
        const totalEl = document.getElementById('ai-live-total-pl');
        if (!priceEl) return;
        if (candles && candles.length) priceEl.innerText = candles[candles.length - 1].close.toFixed(2);
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
            if (ly.status !== 'open') { totalFloating += ly.pl; return; }
            const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
            totalFloating += uscToRupiah(calcLayerPlUsc(pipsMoved));
        });
        totalEl.innerText = `${totalFloating >= 0 ? '+' : ''}${formatRupiah(totalFloating)}`;
        totalEl.className = totalFloating >= 0 ? 'profit-text' : 'loss-text';
    }

    // --- Tick "display" — dipanggil otomatis selagi tab browser kebuka. Cuma update chart & floating P/L, TIDAK buka/tutup posisi (biar gak race sama bot server). ---
    async function aiDisplayTick() {
        const candles = await fetchAiPriceData();
        if (!candles) return;
        lastAiCandles = candles;
        if (document.getElementById('ai-view-market').style.display !== 'none') renderLightweightChart(candles);

        const openInfo = findOpenAiTrade();
        updateLiveStatsBoxes(openInfo, candles);
        // Kalau gak ada posisi open, biarkan pesan status terakhir (dari tombol "Cek Sekarang") tetap kelihatan — jangan dikosongin di sini, biar gak ketiban race sama tick manual.
        if (openInfo) updateFloatingPl(openInfo, candles);
    }

    function startAiAutoTick() {
        if (aiTickInterval) return;
        aiDisplayTick();
        aiTickInterval = setInterval(aiDisplayTick, 2 * 60 * 1000); // refresh tampilan tiap 2 menit (view-only, gak nulis data — keputusan buka/tutup posisi tetap di server tiap 15 menit)
    }
    function stopAiAutoTick() {
        if (aiTickInterval) { clearInterval(aiTickInterval); aiTickInterval = null; }
    }

    document.getElementById('btn-ai-generate').onclick = () => {
        const btn = document.getElementById('btn-ai-generate');
        btn.disabled = true; btn.innerText = '⏳ Cek...';
        // Pindah ke tab Live Market dulu — di situlah kotak notif hasil cek (#ai-floating-pl) ditampilkan, biar hasilnya kelihatan walau tombolnya dipencet dari tab lain.
        document.getElementById('ai-menu-market').click();
        aiAutoTick().finally(() => { btn.disabled = false; btn.innerText = '🔄 Cek Sekarang'; });
    };

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
            const wCard = document.createElement('div'); wCard.className = `weekly-summary-card ${hasData ? (weeklyPl > 0 ? 'weekly-profit' : 'weekly-loss') : 'empty-card'}`;
            if (hasData) wCard.innerHTML = `<div class="week-title">Mg ${w + 1}</div><div class="week-pl ${weeklyPl > 0 ? 'profit-text' : 'loss-text'}">${weeklyPl > 0 ? '+' : ''}${formatRupiah(weeklyPl)}</div>`;
            cal.appendChild(wCard);
        }
        const totalEl = document.getElementById('ai-monthly-total'); totalEl.innerText = formatRupiah(totalBulan); totalEl.className = totalBulan > 0 ? 'profit-text' : (totalBulan < 0 ? 'loss-text' : 'netral');
        document.getElementById('ai-base-equity').innerText = formatRupiah(aiModalAwal);
        updateAiEquity(y, m);
    }
    document.getElementById('ai-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderAiCalendar(); };
    document.getElementById('ai-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderAiCalendar(); };
    document.getElementById('ai-clear-data-btn').onclick = () => { showConfirm("Data simulasi bakal kehapus permanen loh. Yakin?", () => { aiTradeData = {}; saveData('ai_trade_data_v1', aiTradeData); renderAiCalendar(); }); };

    function updateAiEquity(vY, vM) {
        let sumBefore = 0; let sumDuring = 0;
        for (const d in aiTradeData) {
            let tY = new Date(d).getFullYear(); let tM = new Date(d).getMonth(); let dt = 0;
            aiTradeData[d].forEach(t => dt += parseFloat(t.pl || 0));
            if (tY < vY || (tY === vY && tM < vM)) sumBefore += dt; else if (tY === vY && tM === vM) sumDuring += dt;
        }
        let stEq = aiModalAwal + sumBefore; let enEq = stEq + sumDuring;
        document.getElementById('ai-start-equity').innerText = formatRupiah(stEq);
        document.getElementById('ai-current-equity').innerText = formatRupiah(enEq);
        document.getElementById('ai-equity-growth').innerHTML = sumDuring > 0 ? `<span style="color:#00e676;">+${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : (sumDuring < 0 ? `<span style="color:#ff1744;">${(stEq > 0 ? sumDuring / stEq * 100 : 0).toFixed(2)}%</span>` : `<span style="color:#aaa;">0.00%</span>`);
    }

    function openAiModal(dateStr, dayNum) {
        currentAiDateStr = dateStr;
        document.getElementById('ai-modal-date-title').innerText = `Entry Simulasi Tgl ${dayNum}`;
        document.getElementById('ai-today-history').innerHTML = '';
        (aiTradeData[dateStr] || []).forEach((t, i) => {
            let detail = t.layers ? `SL:${parseFloat(t.sl).toFixed(2)} | ${t.layers.map((ly, idx) => `TP${idx + 1}(${ly.tpPips}p):${ly.status === 'open' ? 'Open' : ly.status.toUpperCase()}`).join(' ')}` : `SL:${t.sl} TP:${t.tp}`;
            document.getElementById('ai-today-history').innerHTML += `<div class="history-item ${parseFloat(t.pl || 0) > 0 ? 'hist-profit' : 'hist-loss'}"><div><strong>${t.arah} @ ${parseFloat(t.entry).toFixed(2)}</strong><br><span style="color:#aaa; font-size:0.75rem;">${detail} | ${t.status === 'closed' ? formatRupiah(t.pl || 0) : 'Open'}</span></div><div class="action-group"><button type="button" class="edit-btn" onclick="editAiTrade('${dateStr}', ${i})">✏️</button><button type="button" class="del-btn" onclick="deleteAiTrade('${dateStr}', ${i})">🗑️</button></div></div>`;
        });
        document.getElementById('ai-entry-form').reset();
        document.getElementById('ai-edit-index').value = '-1';
        document.getElementById('ai-cancel-edit-btn').style.display = 'none';
        document.getElementById('ai-pl-group').style.display = 'none';
        document.getElementById('ai-entry-modal').style.display = 'flex';
    }
    document.getElementById('close-ai-modal').onclick = () => document.getElementById('ai-entry-modal').style.display = 'none';
    document.getElementById('ai-input-status').addEventListener('change', function () { document.getElementById('ai-pl-group').style.display = this.value === 'closed' ? 'block' : 'none'; });

    window.editAiTrade = (d, i) => {
        let t = aiTradeData[d][i];
        document.getElementById('ai-input-arah').value = t.arah; document.getElementById('ai-input-tf').value = t.tf || 'H1'; document.getElementById('ai-input-entry').value = t.entry; document.getElementById('ai-input-sl').value = t.sl; document.getElementById('ai-input-tp').value = t.layers ? t.layers[0].tp : t.tp; document.getElementById('ai-input-risk').value = t.layers ? `Lot ${AI_LOT_SIZE} x3 layer (edit manual = jadi 1 layer)` : t.risk; document.getElementById('ai-input-alasan').value = t.alasan; document.getElementById('ai-input-status').value = t.status;
        document.getElementById('ai-pl-group').style.display = t.status === 'closed' ? 'block' : 'none';
        document.getElementById('ai-input-pl').value = t.pl || '';
        document.getElementById('ai-edit-index').value = i; document.getElementById('ai-cancel-edit-btn').style.display = 'block';
    };
    window.deleteAiTrade = (d, i) => { aiTradeData[d].splice(i, 1); if (!aiTradeData[d].length) delete aiTradeData[d]; saveData('ai_trade_data_v1', aiTradeData); openAiModal(d, new Date(d).getDate()); renderAiCalendar(); };
    document.getElementById('ai-cancel-edit-btn').onclick = () => { document.getElementById('ai-entry-form').reset(); document.getElementById('ai-edit-index').value = '-1'; document.getElementById('ai-cancel-edit-btn').style.display = 'none'; document.getElementById('ai-pl-group').style.display = 'none'; };

    document.getElementById('ai-entry-form').onsubmit = (e) => {
        e.preventDefault();
        const saveAiEntry = () => {
            if (!aiTradeData[currentAiDateStr]) aiTradeData[currentAiDateStr] = [];
            let statusVal = document.getElementById('ai-input-status').value;
            let idx = parseInt(document.getElementById('ai-edit-index').value);
            let existing = idx > -1 ? aiTradeData[currentAiDateStr][idx] : {};
            let newData = { ...existing, arah: document.getElementById('ai-input-arah').value, tf: document.getElementById('ai-input-tf').value, entry: document.getElementById('ai-input-entry').value, sl: document.getElementById('ai-input-sl').value, tp: document.getElementById('ai-input-tp').value, risk: document.getElementById('ai-input-risk').value, alasan: document.getElementById('ai-input-alasan').value, status: statusVal, pl: statusVal === 'closed' ? document.getElementById('ai-input-pl').value : 0 };
            if (idx > -1) aiTradeData[currentAiDateStr][idx] = newData; else aiTradeData[currentAiDateStr].push(newData);
            saveData('ai_trade_data_v1', aiTradeData);
            document.getElementById('ai-cancel-edit-btn').click();
            openAiModal(currentAiDateStr, new Date(currentAiDateStr).getDate());
            renderAiCalendar();
        };
        const editIdx = parseInt(document.getElementById('ai-edit-index').value);
        if (editIdx > -1) showConfirm("Ini bakal timpa data entry (termasuk yang otomatis dari bot) dengan perubahan manual kamu. Yakin?", saveAiEntry);
        else saveAiEntry();
    };

    // --- Dashboard evaluasi ---
    function renderAiDashboard() {
        const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth();
        document.getElementById('ai-dash-month-year-display').innerText = `${monthNames[m]} ${y}`;

        let monthHasData = false; let monthPl = 0; let winCount = 0;
        let maxWin = { pl: 0, date: '-', detail: '-' }; let maxLoss = { pl: 0, date: '-', detail: '-' };
        const firstDay = new Date(y, m, 1).getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate();
        let weeklyReports = []; for (let i = 0; i < Math.ceil((firstDay + daysInMonth) / 7); i++) weeklyReports.push({ wins: 0, losses: 0, pl: 0, hasData: false });
        let tableRows = [];

        for (let i = 1; i <= daysInMonth; i++) {
            const fDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const trades = aiTradeData[fDate] || []; let wIdx = Math.floor((firstDay + i - 1) / 7);
            if (trades.length > 0) {
                monthHasData = true; weeklyReports[wIdx].hasData = true;
                trades.forEach(t => {
                    let p = parseFloat(t.pl || 0); monthPl += p;
                    if (t.status === 'closed') { if (p >= 0) { winCount++; weeklyReports[wIdx].wins++; } else { weeklyReports[wIdx].losses++; } }
                    weeklyReports[wIdx].pl += p;
                    if (p > maxWin.pl) maxWin = { pl: p, date: fDate, detail: t.alasan };
                    if (p < maxLoss.pl) maxLoss = { pl: p, date: fDate, detail: t.alasan };
                    tableRows.push({ date: fDate, ...t, plVal: p });
                });
            }
        }

        const emptyState = document.getElementById('ai-empty-state'); const dashContent = document.getElementById('ai-dash-content');
        if (!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; return; }
        emptyState.style.display = 'none'; dashContent.style.display = 'block';

        const riskLimit = aiModalAwal * 0.10;
        const usedPct = monthPl < 0 ? Math.min((Math.abs(monthPl) / riskLimit) * 100, 999) : 0;
        const riskBox = document.getElementById('ai-risk-insight');
        if (monthPl >= 0) riskBox.innerHTML = `<div class="insight-box insight-success">✅ Aman! Bulan ini masih profit ${formatRupiah(monthPl)}, belum kepakai risk budget.</div>`;
        else if (usedPct < 70) riskBox.innerHTML = `<div class="insight-box insight-success">✅ Risk terpakai ${usedPct.toFixed(0)}% dari limit 10%/bulan (${formatRupiah(Math.abs(monthPl))} dari ${formatRupiah(riskLimit)}).</div>`;
        else if (usedPct < 100) riskBox.innerHTML = `<div class="insight-box insight-warning">⚠️ Waspada! Risk terpakai ${usedPct.toFixed(0)}% dari limit 10%/bulan. Kurangi ukuran posisi.</div>`;
        else riskBox.innerHTML = `<div class="insight-box insight-danger">🚨 LIMIT TERLAMPAUI! Rugi bulan ini ${formatRupiah(Math.abs(monthPl))}, lewat batas 10% modal (${formatRupiah(riskLimit)}). STOP entry baru bulan ini.</div>`;

        let closedTrades = tableRows.filter(t => t.status === 'closed');
        let overboughtMistakes = closedTrades.filter(t => t.arah === 'BUY' && t.alasan && t.alasan.toLowerCase().includes('overbought')).length;
        let oversoldMistakes = closedTrades.filter(t => t.arah === 'SELL' && t.alasan && t.alasan.toLowerCase().includes('oversold')).length;
        let winRate = closedTrades.length > 0 ? ((winCount / closedTrades.length) * 100).toFixed(0) : 0;
        document.getElementById('ai-eval-text').innerHTML = `<ul style="padding-left:20px;"><li>Total entry simulasi bulan ini: <strong>${tableRows.length}</strong> (${closedTrades.length} closed, win rate ${winRate}%).</li><li>Risk budget terpakai: <strong>${monthPl < 0 ? usedPct.toFixed(0) : 0}%</strong> dari limit 10%/bulan.</li>${overboughtMistakes > 0 ? `<li style="color:#ff9800;">⚠️ ${overboughtMistakes}x entry BUY meski overbought — tunggu koreksi dulu.</li>` : ''}${oversoldMistakes > 0 ? `<li style="color:#ff9800;">⚠️ ${oversoldMistakes}x entry SELL meski oversold — tunggu rebound dulu.</li>` : ''}${winRate >= 50 && closedTrades.length >= 3 ? `<li style="color:#00e676;">✅ Win rate di atas 50%, konsistensi mulai terbentuk. Pertahankan!</li>` : ''}</ul>`;

        let signalStats = {};
        closedTrades.forEach(t => {
            const type = t.signalType || 'lainnya';
            if (!signalStats[type]) signalStats[type] = { total: 0, win: 0 };
            signalStats[type].total++;
            if (t.plVal >= 0) signalStats[type].win++;
        });
        const signalLabels = { rsi_reversal: '🔄 RSI Reversal', trend_following: '📈 Trend-Following', lainnya: 'Lainnya' };
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

        const tbody = document.getElementById('ai-dashboard-table-body'); tbody.innerHTML = tableRows.length ? '' : `<tr><td colspan="8" style="text-align:center;">Tidak ada data.</td></tr>`;
        tableRows.forEach((e, i) => {
            const tpDisplay = e.layers ? e.layers.map(ly => `${ly.tpPips}p`).join('/') : (e.tp || '-');
            tbody.innerHTML += `<tr><td>${i + 1}</td><td>${e.date}</td><td>${e.arah}</td><td>${parseFloat(e.entry).toFixed(2)}</td><td>${parseFloat(e.sl).toFixed(2)}</td><td>${tpDisplay}</td><td style="min-width:250px;">${e.alasan || '-'}</td><td align="right" class="${e.plVal >= 0 ? 'profit-text' : 'loss-text'}"><strong>${e.status === 'closed' ? formatRupiah(e.plVal) : 'Open'}</strong></td></tr>`;
        });
    }
    document.getElementById('ai-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() - 1); renderAiDashboard(); };
    document.getElementById('ai-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth() + 1); renderAiDashboard(); };

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

    function renderExpDashboard() {
        if(!isLoggedIn) return; const y = globalNavDate.getFullYear(); const m = globalNavDate.getMonth(); document.getElementById('exp-dash-month-year-display').innerText = `${monthNames[m]} ${y}`; let catTotals = {}; let bankTotals = {}; let totalBelanja = 0; let monthHasData = false; let allTx = []; let maxTx = null;
        for (let i = 1; i <= 31; i++) { const fDate = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`; if(expData[fDate] && expData[fDate].length > 0) { monthHasData = true; expData[fDate].forEach(t => { let amt = parseFloat(t.amount); totalBelanja += amt; catTotals[t.category] = (catTotals[t.category] || 0) + amt; let bankKey = t.type === 'Cash' ? 'Tunai' : t.bank; bankTotals[bankKey] = (bankTotals[bankKey] || 0) + amt; let tx = { date: fDate, ...t, amt }; allTx.push(tx); if (!maxTx || amt > maxTx.amt) maxTx = tx; }); } }
        const emptyState = document.getElementById('exp-empty-state'); const dashContent = document.getElementById('exp-dash-content');
        document.getElementById('exp-category-detail').style.display = 'none';
        if(!monthHasData) { emptyState.innerHTML = emptyStateHTML; emptyState.style.display = 'block'; dashContent.style.display = 'none'; }
        else {
            emptyState.style.display = 'none'; dashContent.style.display = 'block';
            let insightHTML = `Total keluar: <strong style="color:#ff1744;">${formatRupiah(totalBelanja)}</strong>. `;
            if(catTotals['Gak penting banget'] > 300000) insightHTML += `Banyak keluar untuk hal gak penting, kurangi fomo!`; else if(totalBelanja > 0) insightHTML += `Manajemen cukup baik.`; document.getElementById('exp-dash-insight').innerHTML = `<div class="insight-box insight-warning">${insightHTML}</div>`;

            if (maxTx) { document.getElementById('exp-highest-pl').innerText = formatRupiah(maxTx.amt); document.getElementById('exp-highest-desc').innerText = `[${maxTx.date}] ${maxTx.notes} (${maxTx.category})`; }
            let topCatEntry = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];
            if (topCatEntry) { document.getElementById('exp-top-category').innerText = topCatEntry[0]; document.getElementById('exp-top-category-desc').innerText = `${formatRupiah(topCatEntry[1])} (${((topCatEntry[1]/totalBelanja)*100).toFixed(0)}% dari total)`; }

            if(expCatChartInst) expCatChartInst.destroy(); if(expBankChartInst) expBankChartInst.destroy();

            const catLabels = Object.keys(catTotals);
            expCatChartInst = new Chart(document.getElementById('expCategoryChart').getContext('2d'), { type: 'bar', data: { labels: catLabels, datasets: [{ label: 'Total Rp', data: Object.values(catTotals), backgroundColor: ['#4caf50', '#ff9800', '#f44336', '#e91e63', '#9c27b0'] }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (evt, elements) => { if (!elements.length) return; const cat = catLabels[elements[0].index]; showExpCategoryDetail(cat, allTx.filter(t => t.category === cat)); } } });
            expBankChartInst = new Chart(document.getElementById('expBankChart').getContext('2d'), { type: 'pie', data: { labels: Object.keys(bankTotals), datasets: [{ data: Object.values(bankTotals), backgroundColor: ['#0066ae', '#00aed6', '#4c2a86', '#ff9800', '#4caf50'] }] }, options: { plugins: { legend: { position: 'bottom', labels: {color:'#fff'} } } } });
        }
    }

    function showExpCategoryDetail(category, txList) {
        const box = document.getElementById('exp-category-detail');
        txList = [...txList].sort((a,b) => b.date.localeCompare(a.date));
        let rows = txList.map(t => `<tr><td>${t.date}</td><td>${t.type === 'Cash' ? 'Tunai' : t.bank}</td><td>${t.notes}</td><td align="right" class="loss-text">${formatRupiah(t.amt)}</td></tr>`).join('');
        box.innerHTML = `<h3 class="chart-title" style="color:#ff1744;">Detail Kategori: ${category} (${txList.length} transaksi)</h3><table class="data-table"><thead><tr><th>Tanggal</th><th>Bank/Tunai</th><th>Catatan</th><th style="text-align:right;">Jumlah</th></tr></thead><tbody>${rows}</tbody></table>`;
        box.style.display = 'block';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    document.getElementById('exp-dash-prev-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()-1); renderExpDashboard(); }; document.getElementById('exp-dash-next-month').onclick = () => { globalNavDate.setMonth(globalNavDate.getMonth()+1); renderExpDashboard(); };

    function openExpModal(dateStr, dayNum) {
        currentExpDateStr = dateStr; document.getElementById('exp-modal-title').innerText = `Pengeluaran Tgl ${dayNum}`; document.getElementById('exp-history').innerHTML=''; (expData[dateStr]||[]).forEach((t,i) => { document.getElementById('exp-history').innerHTML += `<div class="history-item" style="border-left-color:#ff1744;"><div><strong style="color:#ff1744;">-${formatRupiah(t.amount)}</strong><br><span style="color:#aaa; font-size:0.75rem;">[${t.type==='Cash'?'Tunai':t.bank}] ${t.notes} (${t.category})</span></div><div class="action-group"><button type="button" class="edit-btn" onclick="editExp('${dateStr}', ${i})">✏️</button><button type="button" class="del-btn" onclick="deleteExp('${dateStr}', ${i})">🗑️</button></div></div>`; }); document.getElementById('exp-modal').style.display = 'flex';
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
                    else if (isMissed) statusHTML = `<span class="day-pl sport-text" style="font-size:0.8rem; color:#ff1744; margin-top:auto;">❌ Tidak Olahraga</span>`;

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
            let insightHTML = `Total hari aktif latihan: <strong style="color:#2196f3;">${activeDays} Hari</strong>. Bolong (Tidak Olahraga): <strong style="color:#ff1744;">${missedDays} Hari</strong>. `;
            if (activeDays < 4) { insightHTML += `Woy pemalas! Masa sebulan olahraganya kurang dari 4 hari? Ayo gerak buat Naik Gunung!`; document.getElementById('sport-dash-insight').innerHTML = `<div class="insight-box insight-danger">${insightHTML}</div>`; }
            else if (activeDays > 15) { insightHTML += `Gila lu ndro! Mantap banget konsistensinya, pertahankan!`; document.getElementById('sport-dash-insight').innerHTML = `<div class="insight-box insight-success">${insightHTML}</div>`; }
            else { insightHTML += `Bagus, sudah mulai rutin. `; document.getElementById('sport-dash-insight').innerHTML = `<div class="insight-box insight-warning">${insightHTML}</div>`; }

            let topType = Object.entries(domSport).sort((a,b) => b[1]-a[1])[0];
            document.getElementById('sport-top-type').innerText = topType ? topType[0] : '-';
            document.getElementById('sport-top-type-desc').innerText = topType ? `${topType[1]}x dari ${totalSessions} sesi bulan ini` : '-';
            document.getElementById('sport-avg-dur').innerText = `${totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0} Menit`;

            const daysInMonthActual = new Date(y, m + 1, 0).getDate();
            const isCurrentMonth = (y === today.getFullYear() && m === today.getMonth());
            const relevantDays = isCurrentMonth ? today.getDate() : daysInMonthActual;
            const daysOff = Math.max(relevantDays - activeDays, 0);
            const pctAktif = relevantDays > 0 ? Math.round((activeDays / relevantDays) * 100) : 0;

            if(sportFreqChartInst) sportFreqChartInst.destroy(); if(sportTypeChartInst) sportTypeChartInst.destroy(); if(sportActiveChartInst) sportActiveChartInst.destroy();

            sportTypeChartInst = new Chart(document.getElementById('sportTypeChart').getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(domSport), datasets: [{ data: Object.values(domSport), backgroundColor: ['#ff9800', '#9c27b0', '#f44336', '#4caf50', '#2196f3'], borderWidth: 0 }] }, options: { plugins: { legend: { position: 'bottom', labels: { color: '#fff' } } } } });

            sportActiveChartInst = new Chart(document.getElementById('sportActiveChart').getContext('2d'), { type: 'doughnut', data: { labels: ['Aktif', 'Tidak Aktif'], datasets: [{ data: [activeDays, daysOff], backgroundColor: ['#00e676', '#333'], borderWidth: 0 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
            document.getElementById('sport-active-text').innerHTML = `<span style="font-size:1.5rem;">${pctAktif}% Aktif</span><span style="font-size:0.85rem; color:#aaa;">${activeDays}/${relevantDays} hari</span>`;

            sportFreqChartInst = new Chart(document.getElementById('sportFreqChart').getContext('2d'), { type: 'bar', data: { labels: labels, datasets: [{ label: 'Durasi (Menit)', data: dataFreq, backgroundColor: '#2196f3', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#333' } }, x: { grid: { display: false } } } } });
        }
    }

    function openSportModal(dateStr, dayNum, diffDays = 0) {
        currentSportDateStr = dateStr; document.getElementById('sport-modal-title').innerText = `Latihan Tgl ${dayNum}`; document.getElementById('sport-history').innerHTML=''; 
        (sportData[dateStr]||[]).forEach((t,i) => { let lateInfo = t.lateReason ? `<br><span style="color:#ff9800; font-size:0.75rem;">(Telat Input: ${t.lateReason})</span>` : ''; let sClass = getSportClass(t.type); document.getElementById('sport-history').innerHTML += `<div class="history-item ${sClass}"><div><strong class="sport-badge ${sClass}" style="display:inline-block;">${t.type} (${t.totalDur} Mnt)</strong><br><span style="color:#aaa; font-size:0.75rem;">${t.time} | Target: ${t.target} | ${t.achieved}</span>${lateInfo}</div><div class="action-group"><button type="button" class="edit-btn" onclick="editSport('${dateStr}', ${i})">✏️</button><button type="button" class="del-btn" onclick="deleteSport('${dateStr}', ${i})">🗑️</button></div></div>`; });
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
    window.renderWealthDashboard = function() {
        if(!isLoggedIn) return; let totalIncome = 0; let totalExpense = 0; const incList = document.getElementById('wealth-income-list'); incList.innerHTML = ''; const expList = document.getElementById('wealth-expense-list'); expList.innerHTML = '';
        let incSort = document.getElementById('wealth-sort-inc')?.value || 'terbaru'; let expSort = document.getElementById('wealth-sort-exp')?.value || 'terbaru';
        let incomeItems = wealthData.items.filter(i => i.type === 'income'); let expenseItems = wealthData.items.filter(i => i.type === 'expense');
        const sortFn = (sortType) => (a,b) => { if(sortType === 'terbaru') return b.date.localeCompare(a.date); if(sortType === 'terlama') return a.date.localeCompare(b.date); if(sortType === 'terbesar') return parseFloat(b.amount) - parseFloat(a.amount); if(sortType === 'terkecil') return parseFloat(a.amount) - parseFloat(b.amount); return 0; };
        incomeItems.sort(sortFn(incSort)); expenseItems.sort(sortFn(expSort));

        incomeItems.forEach(item => { let realIdx = wealthData.items.indexOf(item); let amt = parseFloat(item.amount); totalIncome += amt; let li = document.createElement('li'); li.className = `wealth-list-item wealth-income-item`; li.innerHTML = `<div style="flex:1;"><strong style="color:#00e676">${formatRupiah(amt)}</strong><br><span style="color:#aaa; font-size:0.8rem;">[${item.date}] ${item.note}</span></div><div class="action-group"><button type="button" class="edit-btn" onclick="editWealthItem(${realIdx})">✏️</button><button type="button" class="del-btn" onclick="deleteWealthItem(${realIdx})">🗑️</button></div>`; incList.appendChild(li); });
        expenseItems.forEach(item => { let realIdx = wealthData.items.indexOf(item); let amt = parseFloat(item.amount); totalExpense += amt; let li = document.createElement('li'); li.className = `wealth-list-item wealth-expense-item`; li.innerHTML = `<div style="flex:1;"><strong style="color:#ff9800">${formatRupiah(amt)}</strong><br><span style="color:#aaa; font-size:0.8rem;">[${item.date}] ${item.note}</span></div><div class="action-group"><button type="button" class="edit-btn" onclick="editWealthItem(${realIdx})">✏️</button><button type="button" class="del-btn" onclick="deleteWealthItem(${realIdx})">🗑️</button></div>`; expList.appendChild(li); });

        let expectedSavings = totalIncome - totalExpense; let defisit = expectedSavings - wealthData.realMoney; 
        document.getElementById('wealth-income').innerText = formatRupiah(totalIncome); document.getElementById('wealth-expense').innerText = formatRupiah(totalExpense); document.getElementById('wealth-expected').innerText = formatRupiah(expectedSavings); document.getElementById('wealth-actual').innerText = formatRupiah(wealthData.realMoney);
        
        let minusEl = document.getElementById('wealth-minus');
        if (defisit > 0) { minusEl.innerText = `- ${formatRupiah(defisit)}`; document.getElementById('wealth-recovery-card').style.display = 'block'; document.getElementById('wealth-recovery-card').style.borderColor = "#ff1744"; document.querySelector('#wealth-recovery-card h2').innerText = "🚨 DEFISIT KEUANGAN (Trading & Pengeluaran Tak Terduga)"; document.querySelector('#wealth-recovery-card h2').style.color = "#ff1744"; } 
        else { minusEl.innerText = "Aman Bosku!"; minusEl.style.color = "#00e676"; document.getElementById('wealth-recovery-card').style.borderColor = "#00e676"; document.querySelector('#wealth-recovery-card h2').innerText = "✅ TABUNGAN SURPLUS"; document.querySelector('#wealth-recovery-card h2').style.color = "#00e676"; }
    }

    window.openWealthModal = () => { document.getElementById('wealth-form').reset(); document.getElementById('wealth-edit-index').value = "-1"; document.getElementById('wealth-modal-title').innerText = "+ Catat Keuangan"; document.getElementById('wealth-cancel-edit-btn').style.display = "none"; document.getElementById('wealth-modal').style.display = 'flex'; };
    window.editWealthItem = (idx) => { let item = wealthData.items[idx]; document.getElementById('wealth-type').value = item.type; document.getElementById('wealth-date').value = item.date; document.getElementById('wealth-amount').value = item.amount; document.getElementById('wealth-notes').value = item.note; document.getElementById('wealth-edit-index').value = idx; document.getElementById('wealth-modal-title').innerText = "✏️ Edit Catatan Keuangan"; document.getElementById('wealth-cancel-edit-btn').style.display = "block"; document.getElementById('wealth-modal').style.display = 'flex'; };
    document.getElementById('wealth-cancel-edit-btn').onclick = () => { document.getElementById('wealth-modal').style.display = 'none'; };
    document.getElementById('wealth-form').onsubmit = (e) => { e.preventDefault(); showConfirm("Yakin mau simpan perubahan data kekayaan ini?", () => { let idx = parseInt(document.getElementById('wealth-edit-index').value); let newData = { type: document.getElementById('wealth-type').value, date: document.getElementById('wealth-date').value, amount: document.getElementById('wealth-amount').value, note: document.getElementById('wealth-notes').value }; if (idx > -1) { newData.id = wealthData.items[idx].id; wealthData.items[idx] = newData; } else { newData.id = Date.now(); wealthData.items.push(newData); } saveData('wealth_data_v1', wealthData); document.getElementById('wealth-modal').style.display = 'none'; renderWealthDashboard(); }); };
    window.deleteWealthItem = (idx) => { showConfirm("Yakin hapus data historis ini? Perhitungan tabungan akan berubah loh!", () => { wealthData.items.splice(idx, 1); saveData('wealth_data_v1', wealthData); renderWealthDashboard(); }); };
    document.getElementById('btn-save-rt').onclick = () => { let rt = parseFloat(document.getElementById('wealth-rt-amount').value); if(!isNaN(rt)) { showConfirm("Yakin update Uang Real Time ini?", () => { wealthData.realMoney = rt; saveData('wealth_data_v1', wealthData); document.getElementById('wealth-modal-rt').style.display = 'none'; renderWealthDashboard(); }); } };

    renderXAUCalendar();
});