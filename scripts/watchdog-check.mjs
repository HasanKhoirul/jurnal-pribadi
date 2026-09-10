// Watchdog eksternal - jalan di GitHub Actions (.github/workflows/watchdog.yml), BUKAN di VPS.
// Tujuannya: kalau VPS/bot mati (misal kesuspend kayak kejadian Contabo Sept 2026), alert Telegram
// tetap terkirim - soalnya proses pengirim alert normal (ai-tick.py/ai-tick-currency.py) ikut mati
// bareng VPS-nya, jadi butuh pengecek yang jalan di luar VPS.
//
// Sumber "kapan terakhir bot aktif": field aiLivePriceMt5UpdatedAt(_<PAIR>) di appData/public, yang
// udah ditulis bot tiap ~60 detik (lihat push_live_price_to_public() di ai-tick.py/ai-tick-currency.py) -
// gak perlu nambah write baru di sisi bot.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Env belum lengkap: butuh TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID.');
    process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const publicDocRef = db.collection('appData').doc('public');

const STALE_THRESHOLD_MINUTES = 15;
const REMINDER_INTERVAL_HOURS = 2;

// Sama persis definisi is_market_open() di scripts/ai_trading_core.py - kalau beda, watchdog bisa
// false-alarm "bot mati" pas weekend (market emang tutup, bukan bot yang mati).
function isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(); // Minggu=0 ... Sabtu=6
    const hour = now.getUTCHours();
    if (day === 6) return false; // Sabtu
    if (day === 0 && hour < 22) return false; // Minggu sebelum 22:00 UTC
    if (day === 5 && hour >= 21) return false; // Jumat setelah 21:00 UTC
    return true;
}

const INSTRUMENTS = [
    { label: 'Gold', field: 'aiLivePriceMt5UpdatedAt' },
    ...['USDJPY', 'GBPUSD', 'AUDUSD', 'EURUSD', 'USDCAD'].map(pair => ({
        label: pair,
        field: `aiLivePriceMt5UpdatedAt_${pair}`,
    })),
];

function formatMinutes(mins) {
    if (mins < 60) return `${Math.round(mins)} menit`;
    return `${(mins / 60).toFixed(1)} jam`;
}

async function sendTelegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
        });
    } catch (err) {
        console.error('Gagal kirim Telegram:', err.message);
    }
}

async function main() {
    if (!isMarketOpen()) {
        console.log('Market tutup (weekend), skip pengecekan.');
        return;
    }

    const snap = await publicDocRef.get();
    const data = snap.exists ? snap.data() : {};
    const now = Date.now();

    const stale = INSTRUMENTS.map(inst => {
        const updatedAt = data[inst.field];
        const ageMinutes = updatedAt ? (now - new Date(updatedAt).getTime()) / 60000 : Infinity;
        return { ...inst, ageMinutes };
    }).filter(inst => inst.ageMinutes > STALE_THRESHOLD_MINUTES);

    const prevState = data.watchdogState || { down: false, downSince: null, lastAlertAt: null };

    if (stale.length > 0) {
        const detail = stale.map(s => `${s.label} (${s.ageMinutes === Infinity ? 'belum pernah update' : formatMinutes(s.ageMinutes) + ' lalu'})`).join(', ');
        if (!prevState.down) {
            await sendTelegram(`🚨 <b>Bot berhenti kirim update</b>\nInstrumen diam: ${detail}\nCek VPS/bot - kemungkinan mati atau VPS kesuspend.`);
            await publicDocRef.set({ watchdogState: { down: true, downSince: new Date().toISOString(), lastAlertAt: new Date().toISOString() } }, { merge: true });
            console.log('Alert dikirim: bot baru terdeteksi mati.');
        } else {
            const hoursSinceLastAlert = (now - new Date(prevState.lastAlertAt).getTime()) / 3600000;
            if (hoursSinceLastAlert >= REMINDER_INTERVAL_HOURS) {
                const downDuration = formatMinutes((now - new Date(prevState.downSince).getTime()) / 60000);
                await sendTelegram(`🚨 <b>Bot masih mati</b> (sejak ${downDuration} lalu)\nInstrumen diam: ${detail}`);
                await publicDocRef.set({ watchdogState: { ...prevState, lastAlertAt: new Date().toISOString() } }, { merge: true });
                console.log('Reminder dikirim: bot masih mati.');
            } else {
                console.log('Bot masih mati, belum waktunya reminder lagi.');
            }
        }
    } else if (prevState.down) {
        const downDuration = formatMinutes((now - new Date(prevState.downSince).getTime()) / 60000);
        await sendTelegram(`✅ <b>Bot nyala lagi</b> (sempat mati ${downDuration})`);
        await publicDocRef.set({ watchdogState: { down: false, downSince: null, lastAlertAt: null } }, { merge: true });
        console.log('Alert dikirim: bot recovery.');
    } else {
        console.log('Semua instrumen aktif normal.');
    }
}

main().catch(err => { console.error('❌ Watchdog error:', err); process.exit(1); });
