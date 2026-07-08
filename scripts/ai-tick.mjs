// Bot Trading AI - versi server, dijalankan otomatis via GitHub Actions (lihat .github/workflows/ai-trading-tick.yml).
// Logic & rumus di sini identik dengan modul "MODUL TRADING AI" di script.js (biar hasilnya konsisten
// sama versi browser) - bedanya cuma sumber data (Firestore Admin SDK, bukan client SDK) dan gak ada DOM.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AI_TARGET_UID = process.env.AI_TARGET_UID;
const AI_TIMEFRAME = '1h';

if (!TWELVEDATA_API_KEY || !AI_TARGET_UID) {
    console.error('Env belum lengkap: butuh TWELVEDATA_API_KEY dan AI_TARGET_UID.');
    process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const AI_PIP_SIZE = 0.1;
// Nilai default di sini - dibaca ulang & bisa di-override tiap tick lewat aiSettings.master
// di Firestore (diatur dari menu "Master Setting" web app), lewat applyAiSettings().
const AI_MASTER_DEFAULTS = {
    slPips: 50, slMode: 'fixed', atrMultiplier: 1.5, tpLayerPips: [80, 100, 150], lotSize: 0.1, layerStaggerPips: 10,
    lockPipsAfterTp1: 10, deepLockTriggerPips: 100, deepLockPips: 80, deepLockTimeoutMinutes: 15,
    minSignalWinrate: 35, winrateLookbackDays: 14, winrateMinSamples: 5,
    newsPreMinutes: 10, newsPostMinutes: 40
};
let AI_LOT_SIZE = AI_MASTER_DEFAULTS.lotSize;
let AI_SL_PIPS = AI_MASTER_DEFAULTS.slPips;
let AI_SL_MODE = AI_MASTER_DEFAULTS.slMode; // 'fixed' | 'atr' - kalau 'atr', SL ikut ATR(14) x AI_ATR_MULTIPLIER (clamp 30-120 pips)
let AI_ATR_MULTIPLIER = AI_MASTER_DEFAULTS.atrMultiplier;
let AI_TP_LAYERS_PIPS = AI_MASTER_DEFAULTS.tpLayerPips;

function pipToPrice(pips) { return pips * AI_PIP_SIZE; }
function calcLayerPlUsc(pips) { return pips * (AI_LOT_SIZE / 0.1) * 1; }
function uscToRupiah(usc, liveKursIDR) { return (usc / 100) * liveKursIDR; }

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
// Average True Range - jarak SL adaptif ikut volatilitas terkini (dipakai kalau AI_SL_MODE === 'atr')
function calcATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trs = [];
    for (let i = candles.length - period; i < candles.length; i++) {
        const c = candles[i], prevClose = candles[i - 1].close;
        trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / period;
}

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
let AI_NEWS_PRE_MINUTES = AI_MASTER_DEFAULTS.newsPreMinutes;
let AI_NEWS_POST_MINUTES = AI_MASTER_DEFAULTS.newsPostMinutes;
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

async function fetchLiveKursIDR() {
    try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        return data?.rates?.IDR || 16000;
    } catch (err) { console.error('Gagal ambil kurs, pakai fallback 16000:', err.message); return 16000; }
}

async function fetchAiPriceData() {
    const res = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${AI_TIMEFRAME}&outputsize=100&timezone=UTC&apikey=${TWELVEDATA_API_KEY}`);
    const data = await res.json();
    if (data.status === 'error' || !data.values) throw new Error('TwelveData error: ' + (data.message || 'unknown'));
    return data.values.reverse().map(v => ({ time: v.datetime.replace(' ', 'T') + 'Z', open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close) }));
}

async function polishReasonWithLLM(rawReason) {
    if (!GEMINI_API_KEY) return null;
    const prompt = `Tuliskan ulang analisa trading berikut jadi lebih natural dan enak dibaca dalam Bahasa Indonesia, TANPA mengubah angka atau menambah fakta baru:\n\n${rawReason}`;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (err) { console.error('LLM polish gagal, fallback ke template:', err.message); return null; }
}

// Adaptif: kalau win rate tipe sinyal tertentu lagi jelek belakangan ini, bot skip generate sinyal itu dulu (proporsi entry condong ke yang lebih akurat).
let AI_MIN_SIGNAL_WINRATE = AI_MASTER_DEFAULTS.minSignalWinrate;
let AI_WINRATE_LOOKBACK_DAYS = AI_MASTER_DEFAULTS.winrateLookbackDays;
let AI_WINRATE_MIN_SAMPLES = AI_MASTER_DEFAULTS.winrateMinSamples;
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

let lastSignalSkipReason = null;
async function computeAiSuggestion(candles, tradeData) {
    const closes = candles.map(c => c.close);
    const lastClose = closes[closes.length - 1];
    const ma20 = calcSMA(closes, 20); const ma50 = calcSMA(closes, 50); const rsi = calcRSI(closes, 14);
    if (ma20 === null || ma50 === null || rsi === null) { lastSignalSkipReason = 'Data candle belum cukup buat hitung indikator.'; return null; }

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
        lastSignalSkipReason = `Win rate ${signalType} ${recentWr.toFixed(0)}% dalam ${AI_WINRATE_LOOKBACK_DAYS} hari terakhir (di bawah ambang ${AI_MIN_SIGNAL_WINRATE}%).`;
        console.log(`Skip sinyal ${signalType}: ${lastSignalSkipReason}`);
        return null;
    }

    const macd = calcMACD(closes);
    if (macd) {
        const macdBullish = macd.macd > macd.signal;
        reasonParts.push(`MACD ${macdBullish ? 'bullish' : 'bearish'} (${macd.macd.toFixed(2)} vs signal ${macd.signal.toFixed(2)}).`);
        if ((arah === 'BUY' && !macdBullish) || (arah === 'SELL' && macdBullish)) {
            lastSignalSkipReason = `MACD gak konfirmasi arah ${arah} (trend/RSI nunjuk ${arah}, tapi MACD ${macdBullish ? 'bullish' : 'bearish'}).`;
            reasonParts.push(`MACD gak konfirmasi arah ${arah} → skip entry, tunggu konfirmasi lebih kuat.`);
            return null;
        }
    }
    const bb = calcBollinger(closes, 20, 2);
    if (bb) reasonParts.push(`Bollinger Band: harga ${lastClose.toFixed(2)} (upper ${bb.upper.toFixed(2)}, lower ${bb.lower.toFixed(2)}).`);

    const entry = lastClose;
    const dirSign = arah === 'BUY' ? 1 : -1;
    let slPipsUsed = AI_SL_PIPS;
    if (AI_SL_MODE === 'atr') {
        const atr = calcATR(candles, 14);
        if (atr !== null) slPipsUsed = Math.min(120, Math.max(30, Math.round((atr / AI_PIP_SIZE) * AI_ATR_MULTIPLIER)));
    }
    const sl = entry - dirSign * pipToPrice(slPipsUsed);
    reasonParts.push(`Entry ${entry.toFixed(2)}, SL ${slPipsUsed} pips${AI_SL_MODE === 'atr' ? ' (adaptif ATR)' : ''} (${sl.toFixed(2)}), TP berlapis ${AI_TP_LAYERS_PIPS.join('/')} pips, lot ${AI_LOT_SIZE} x3 layer.`);

    let reasonText = reasonParts.join(' ');
    const polished = await polishReasonWithLLM(reasonText);
    if (polished) reasonText = polished;

    return { arah, entry, sl, dirSign, reasonText, tf: AI_TIMEFRAME, signalType, slPipsUsed };
}

function findOpenAiTrade(aiTradeData) {
    for (const d in aiTradeData) {
        const list = aiTradeData[d];
        for (let i = 0; i < list.length; i++) { if (list[i].status === 'open') return { dateKey: d, index: i, trade: list[i] }; }
    }
    return null;
}

function todayWibDateStr() {
    const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000); // perkiraan WIB (UTC+7), biar konsisten sama grouping tanggal di browser
    return `${nowWib.getUTCFullYear()}-${String(nowWib.getUTCMonth() + 1).padStart(2, '0')}-${String(nowWib.getUTCDate()).padStart(2, '0')}`;
}

// Jarak antar layer pending order bertingkat: layer 0 = harga sinyal (market), layer 1 = -10 pips, layer 2 = -20 pips (arah "lebih murah/baik").
let AI_LAYER_STAGGER_PIPS = AI_MASTER_DEFAULTS.layerStaggerPips;

async function autoOpenAiPosition(aiTradeData, candles) {
    const sug = await computeAiSuggestion(candles, aiTradeData);
    if (!sug) { console.log('Gak ada sinyal valid tick ini (confluence gak terpenuhi).'); return false; }
    const dateStr = todayWibDateStr();
    if (!aiTradeData[dateStr]) aiTradeData[dateStr] = [];
    const layers = AI_TP_LAYERS_PIPS.map((tpPips, i) => {
        const layerEntry = sug.entry - sug.dirSign * pipToPrice(i * AI_LAYER_STAGGER_PIPS);
        return { tpPips, entry: layerEntry, tp: layerEntry + sug.dirSign * pipToPrice(tpPips), sl: layerEntry - sug.dirSign * pipToPrice(sug.slPipsUsed), lot: AI_LOT_SIZE, status: i === 0 ? 'open' : 'pending', pl: 0, slMoved: false };
    });
    aiTradeData[dateStr].push({ arah: sug.arah, tf: sug.tf, entry: sug.entry, sl: layers[0].sl, layers, alasan: sug.reasonText, signalType: sug.signalType, status: 'open', pl: 0, openedAt: new Date().toISOString(), closedAt: null });
    console.log(`✅ Entry baru dibuka: ${sug.arah} @ ${sug.entry.toFixed(2)} (layer 2 & 3 pending di ${layers[1].entry.toFixed(2)} / ${layers[2].entry.toFixed(2)}).`);
    return true;
}

// Begitu TP1 (layer pertama, 80 pips) kena, layer 2 & 3 langsung dikunci profit +10 pips — biar aman kalau harga balik arah.
let AI_LOCK_PIPS_AFTER_TP1 = AI_MASTER_DEFAULTS.lockPipsAfterTp1;
// Khusus layer terakhir (target 150 pips): begitu floating profit-nya sendiri tembus 100 pips, SL dikunci lebih dalam ke +80 pips dan mulai hitung mundur — kalau TP 150 belum kena dalam waktu segitu, tutup paksa di market (dijamin minimal +80 pips).
let AI_DEEP_LOCK_TRIGGER_PIPS = AI_MASTER_DEFAULTS.deepLockTriggerPips;
let AI_DEEP_LOCK_PIPS = AI_MASTER_DEFAULTS.deepLockPips;
let AI_DEEP_LOCK_TIMEOUT_MINUTES = AI_MASTER_DEFAULTS.deepLockTimeoutMinutes;

function applyAiSettings(master) {
    master = master || {};
    const tpLayers = Array.isArray(master.tpLayerPips) && master.tpLayerPips.length === 3 && master.tpLayerPips.every(x => typeof x === 'number')
        ? master.tpLayerPips : AI_MASTER_DEFAULTS.tpLayerPips;
    AI_LOT_SIZE = master.lotSize ?? AI_MASTER_DEFAULTS.lotSize;
    AI_SL_PIPS = master.slPips ?? AI_MASTER_DEFAULTS.slPips;
    AI_SL_MODE = master.slMode === 'atr' ? 'atr' : 'fixed';
    AI_ATR_MULTIPLIER = master.atrMultiplier ?? AI_MASTER_DEFAULTS.atrMultiplier;
    AI_TP_LAYERS_PIPS = tpLayers;
    AI_LAYER_STAGGER_PIPS = master.layerStaggerPips ?? AI_MASTER_DEFAULTS.layerStaggerPips;
    AI_LOCK_PIPS_AFTER_TP1 = master.lockPipsAfterTp1 ?? AI_MASTER_DEFAULTS.lockPipsAfterTp1;
    AI_DEEP_LOCK_TRIGGER_PIPS = master.deepLockTriggerPips ?? AI_MASTER_DEFAULTS.deepLockTriggerPips;
    AI_DEEP_LOCK_PIPS = master.deepLockPips ?? AI_MASTER_DEFAULTS.deepLockPips;
    AI_DEEP_LOCK_TIMEOUT_MINUTES = master.deepLockTimeoutMinutes ?? AI_MASTER_DEFAULTS.deepLockTimeoutMinutes;
    AI_MIN_SIGNAL_WINRATE = master.minSignalWinrate ?? AI_MASTER_DEFAULTS.minSignalWinrate;
    AI_WINRATE_LOOKBACK_DAYS = master.winrateLookbackDays ?? AI_MASTER_DEFAULTS.winrateLookbackDays;
    AI_WINRATE_MIN_SAMPLES = master.winrateMinSamples ?? AI_MASTER_DEFAULTS.winrateMinSamples;
    AI_NEWS_PRE_MINUTES = master.newsPreMinutes ?? AI_MASTER_DEFAULTS.newsPreMinutes;
    AI_NEWS_POST_MINUTES = master.newsPostMinutes ?? AI_MASTER_DEFAULTS.newsPostMinutes;
}

// Layer 1/2 (index 1 & 2) yang masih pending order (belum kefill) dibatalkan begitu layer 0 (market entry) selesai — udah gak relevan lagi.
function cancelPendingSiblings(trade) {
    for (let i = 1; i < trade.layers.length; i++) {
        const l = trade.layers[i];
        if (l.status === 'pending') { l.status = 'cancelled'; l.pl = 0; }
    }
}

// Paksa tutup semua layer yang masih open di harga market sekarang (dipakai buat news guard, pola sama kayak timeout).
function forceCloseAllLayersAtMarket(trade, candles, statusLabel, liveKursIDR) {
    if (!trade.layers) return false;
    const lastClose = candles[candles.length - 1].close;
    const dirSign = trade.arah === 'BUY' ? 1 : -1;
    let changed = false;
    trade.layers.forEach(ly => {
        if (ly.status === 'pending') { ly.status = 'cancelled'; ly.pl = 0; changed = true; return; }
        if (ly.status !== 'open') return;
        const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
        const pipsMoved = ((lastClose - layerEntry) * dirSign) / AI_PIP_SIZE;
        ly.status = statusLabel; ly.pl = uscToRupiah(calcLayerPlUsc(pipsMoved), liveKursIDR); changed = true;
    });
    if (!changed) return false;
    trade.pl = trade.layers.reduce((sum, ly) => sum + (ly.status !== 'open' ? ly.pl : 0), 0);
    const allResolved = trade.layers.every(ly => ly.status !== 'open');
    if (allResolved) { trade.status = 'closed'; trade.closedAt = new Date().toISOString(); }
    return true;
}

function checkAndCloseAiPosition(trade, candles, liveKursIDR) {
    if (!trade.openedAt) trade.openedAt = new Date().toISOString();
    if (!trade.layers) return false;
    const openedTime = new Date(trade.openedAt).getTime();
    const relevantCandles = candles.filter(c => new Date(c.time).getTime() >= openedTime);
    const dirSign = trade.arah === 'BUY' ? 1 : -1;
    const notResolved = ly => ly.status === 'open' || ly.status === 'pending';
    let changed = false;

    for (const c of relevantCandles) {
        trade.layers.forEach((ly, idx) => {
            if (ly.status === 'pending') {
                const filled = trade.arah === 'BUY' ? c.low <= ly.entry : c.high >= ly.entry;
                if (!filled) return;
                ly.status = 'open';
                changed = true;
                console.log(`🟢 Layer ${idx + 1} pending kefill di ${ly.entry.toFixed(2)}.`);
            }
            if (ly.status !== 'open') return;
            const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
            const slPrice = ly.sl !== undefined ? ly.sl : trade.sl;
            const slHit = trade.arah === 'BUY' ? c.low <= slPrice : c.high >= slPrice;
            if (slHit) {
                const pipsAtSl = ((ly.sl - layerEntry) * dirSign) / AI_PIP_SIZE;
                ly.status = pipsAtSl >= 0 ? 'be' : 'sl';
                ly.pl = uscToRupiah(calcLayerPlUsc(pipsAtSl), liveKursIDR);
                changed = true;
                if (idx === 0) cancelPendingSiblings(trade);
                return;
            }
            const tpHit = trade.arah === 'BUY' ? c.high >= ly.tp : c.low <= ly.tp;
            if (tpHit) {
                ly.status = 'tp'; ly.pl = uscToRupiah(calcLayerPlUsc(ly.tpPips), liveKursIDR); changed = true;
                if (idx === 0) {
                    const l2 = trade.layers[1], l3 = trade.layers[2];
                    if (l2 && l2.status === 'open' && !l2.slMoved) { l2.sl = l2.entry + dirSign * pipToPrice(AI_LOCK_PIPS_AFTER_TP1); l2.slMoved = true; }
                    if (l3 && l3.status === 'open' && !l3.slMoved) { l3.sl = l3.entry + dirSign * pipToPrice(AI_LOCK_PIPS_AFTER_TP1); l3.slMoved = true; }
                    cancelPendingSiblings(trade);
                    console.log(`🔵 TP1 kena, layer 2 & 3 yang udah kefill dikunci +${AI_LOCK_PIPS_AFTER_TP1} pips, yang masih pending dibatalkan.`);
                }
                return;
            }
            // Khusus layer terakhir: sekali floating tembus 100 pips, kunci SL lebih dalam ke +80 pips & mulai timer 15 menit.
            if (idx === trade.layers.length - 1) {
                const pipsNow = ((c.close - layerEntry) * dirSign) / AI_PIP_SIZE;
                if (pipsNow >= AI_DEEP_LOCK_TRIGGER_PIPS && !ly.deepLockAt) {
                    ly.sl = layerEntry + dirSign * pipToPrice(AI_DEEP_LOCK_PIPS);
                    ly.slMoved = true;
                    ly.deepLockAt = c.time;
                    changed = true;
                    console.log(`🔒 Layer terakhir tembus ${AI_DEEP_LOCK_TRIGGER_PIPS} pips, SL dikunci +${AI_DEEP_LOCK_PIPS} pips, timer ${AI_DEEP_LOCK_TIMEOUT_MINUTES} menit mulai.`);
                }
                if (ly.deepLockAt && (new Date(c.time).getTime() - new Date(ly.deepLockAt).getTime()) >= AI_DEEP_LOCK_TIMEOUT_MINUTES * 60000) {
                    const pipsAtClose = ((c.close - layerEntry) * dirSign) / AI_PIP_SIZE;
                    ly.status = 'timeout_lock'; ly.pl = uscToRupiah(calcLayerPlUsc(pipsAtClose), liveKursIDR); changed = true;
                    console.log(`⏱️ Layer terakhir timeout ${AI_DEEP_LOCK_TIMEOUT_MINUTES} menit setelah lock, ditutup di market (${pipsAtClose.toFixed(1)} pips).`);
                }
            }
        });
        if (!trade.layers.some(notResolved)) break;
    }

    const stillActive = trade.layers.some(notResolved);
    if (stillActive && (Date.now() - openedTime) / (1000 * 60 * 60 * 24) >= 3) {
        const lastClose = candles[candles.length - 1].close;
        trade.layers.forEach(ly => {
            if (ly.status === 'pending') { ly.status = 'cancelled'; ly.pl = 0; changed = true; return; }
            if (ly.status !== 'open') return;
            const layerEntry = ly.entry !== undefined ? ly.entry : trade.entry;
            const pipsMoved = ((lastClose - layerEntry) * dirSign) / AI_PIP_SIZE;
            ly.status = 'timeout'; ly.pl = uscToRupiah(calcLayerPlUsc(pipsMoved), liveKursIDR); changed = true;
        });
    }

    if (!changed) return { changed: false, allResolved: false };
    trade.pl = trade.layers.reduce((sum, ly) => sum + (notResolved(ly) ? 0 : ly.pl), 0);
    const allResolved = !trade.layers.some(notResolved);
    if (allResolved) { trade.status = 'closed'; trade.closedAt = new Date().toISOString(); console.log('🔒 Posisi closed penuh.'); }
    else console.log('📊 Sebagian layer closed, posisi masih jalan.');
    return { changed: true, allResolved };
}

function logAiTick(outcome, detail) {
    return db.collection('appData').doc(AI_TARGET_UID).collection('ai_tick_log').add({ time: new Date().toISOString(), outcome, detail: detail || '', source: 'server' })
        .catch(err => console.error('Gagal simpan log tick:', err.message));
}

async function main() {
    console.log(`[${new Date().toISOString()}] Mulai tick bot Trading AI...`);
    const docRef = db.collection('appData').doc(AI_TARGET_UID);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : {};
    let aiTradeData = data.aiTradeData || {};
    const aiModalAwal = data.aiModalAwal || 2500000;
    applyAiSettings(data.aiSettings?.master);

    let candles;
    try {
        candles = await fetchAiPriceData();
    } catch (err) {
        console.error('Gagal ambil data harga:', err.message);
        await logAiTick('error', `Gagal ambil data harga: ${err.message}`);
        throw err;
    }
    const liveKursIDR = await fetchLiveKursIDR();
    const newsInfo = await fetchActiveHighImpactNews();

    const openInfo = findOpenAiTrade(aiTradeData);
    let needsSave = false;

    if (openInfo && newsInfo) {
        needsSave = forceCloseAllLayersAtMarket(openInfo.trade, candles, 'news_close', liveKursIDR);
        if (needsSave) { console.log(`📰 Posisi ditutup paksa: berita high-impact "${newsInfo.title}".`); await logAiTick('news_close', `Posisi ditutup paksa: berita high-impact "${newsInfo.title}".`); }
    } else if (openInfo) {
        const result = checkAndCloseAiPosition(openInfo.trade, candles, liveKursIDR);
        needsSave = result.changed;
        if (!result.changed) { console.log('⏳ Posisi masih open, belum ada SL/TP kesentuh.'); await logAiTick('waiting', 'Posisi masih open, belum ada perubahan.'); }
        else await logAiTick(result.allResolved ? 'position_closed' : 'position_updated', result.allResolved ? 'Trade selesai (semua layer resolved).' : 'Ada layer yang resolve/ke-lock tick ini.');
    } else if (!isMarketOpen()) {
        console.log('💤 Market tutup (weekend), skip.');
        await logAiTick('market_closed', 'Weekend, market tutup.');
    } else if (newsInfo) {
        console.log(`📰 Berita high-impact "${newsInfo.title}" lagi berlangsung, skip entry baru.`);
        await logAiTick('news_block', `Jam rawan berita high-impact "${newsInfo.title}", entry baru ditahan.`);
    } else {
        needsSave = await autoOpenAiPosition(aiTradeData, candles);
        if (needsSave) await logAiTick('entry_opened', 'Entry baru berhasil dibuka.');
        else await logAiTick('no_signal', lastSignalSkipReason || 'Gak ada sinyal valid tick ini.');
    }

    if (needsSave) {
        await docRef.set({ aiTradeData, aiModalAwal }, { merge: true });
        console.log('💾 Tersimpan ke Firestore.');
    } else {
        console.log('Gak ada perubahan, skip save.');
    }
    console.log('Selesai.');
}

main().catch(err => { console.error('❌ Bot error:', err); process.exit(1); });
