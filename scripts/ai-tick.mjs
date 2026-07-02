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
const AI_LOT_SIZE = 0.1;
const AI_SL_PIPS = 50;
const AI_TP_LAYERS_PIPS = [80, 100, 150];
const AI_BREAKEVEN_TRIGGER_PIPS = 30;

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

function isMarketOpen() {
    const now = new Date(); const day = now.getUTCDay(); const hour = now.getUTCHours();
    if (day === 6) return false;
    if (day === 0 && hour < 22) return false;
    if (day === 5 && hour >= 21) return false;
    return true;
}
function isHighImpactNewsWindow() {
    const now = new Date(); const day = now.getUTCDay(); const hour = now.getUTCHours();
    if (day === 0 || day === 6) return false;
    return hour >= 12 && hour < 15;
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

async function computeAiSuggestion(candles) {
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
    const polished = await polishReasonWithLLM(reasonText);
    if (polished) reasonText = polished;

    return { arah, entry, sl, dirSign, reasonText, tf: AI_TIMEFRAME, signalType };
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

async function autoOpenAiPosition(aiTradeData, candles) {
    const sug = await computeAiSuggestion(candles);
    if (!sug) { console.log('Gak ada sinyal valid tick ini (confluence gak terpenuhi).'); return false; }
    const dateStr = todayWibDateStr();
    if (!aiTradeData[dateStr]) aiTradeData[dateStr] = [];
    const layers = AI_TP_LAYERS_PIPS.map(tpPips => ({ tpPips, tp: sug.entry + sug.dirSign * pipToPrice(tpPips), lot: AI_LOT_SIZE, status: 'open', pl: 0, sl: sug.sl, slMoved: false }));
    aiTradeData[dateStr].push({ arah: sug.arah, tf: sug.tf, entry: sug.entry, sl: sug.sl, layers, alasan: sug.reasonText, signalType: sug.signalType, status: 'open', pl: 0, openedAt: new Date().toISOString(), closedAt: null });
    console.log(`✅ Entry baru dibuka: ${sug.arah} @ ${sug.entry.toFixed(2)}`);
    return true;
}

function updateTrailingStops(trade, candles) {
    if (!trade.layers) return false;
    const lastClose = candles[candles.length - 1].close;
    const dirSign = trade.arah === 'BUY' ? 1 : -1;
    const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
    if (pipsMoved < AI_BREAKEVEN_TRIGGER_PIPS) return false;
    let changed = false;
    trade.layers.forEach(ly => { if (ly.status === 'open' && !ly.slMoved) { ly.sl = trade.entry; ly.slMoved = true; changed = true; } });
    if (changed) console.log('🔵 SL beberapa layer digeser ke breakeven.');
    return changed;
}

function checkAndCloseAiPosition(trade, candles, liveKursIDR) {
    if (!trade.openedAt) trade.openedAt = new Date().toISOString();
    if (!trade.layers) return false;
    const openedTime = new Date(trade.openedAt).getTime();
    const relevantCandles = candles.filter(c => new Date(c.time).getTime() >= openedTime);
    let changed = false;

    for (const c of relevantCandles) {
        trade.layers.forEach(ly => {
            if (ly.status !== 'open') return;
            const slPrice = ly.sl !== undefined ? ly.sl : trade.sl;
            const slHit = trade.arah === 'BUY' ? c.low <= slPrice : c.high >= slPrice;
            if (slHit) { ly.status = ly.slMoved ? 'be' : 'sl'; ly.pl = ly.slMoved ? 0 : uscToRupiah(-calcLayerPlUsc(AI_SL_PIPS), liveKursIDR); changed = true; return; }
            const tpHit = trade.arah === 'BUY' ? c.high >= ly.tp : c.low <= ly.tp;
            if (tpHit) { ly.status = 'tp'; ly.pl = uscToRupiah(calcLayerPlUsc(ly.tpPips), liveKursIDR); changed = true; }
        });
        if (trade.layers.every(ly => ly.status !== 'open')) break;
    }

    const stillHasOpenLayer = trade.layers.some(ly => ly.status === 'open');
    if (stillHasOpenLayer && (Date.now() - openedTime) / (1000 * 60 * 60 * 24) >= 3) {
        const lastClose = candles[candles.length - 1].close;
        const dirSign = trade.arah === 'BUY' ? 1 : -1;
        trade.layers.forEach(ly => {
            if (ly.status !== 'open') return;
            const pipsMoved = ((lastClose - trade.entry) * dirSign) / AI_PIP_SIZE;
            ly.status = 'timeout'; ly.pl = uscToRupiah(calcLayerPlUsc(pipsMoved), liveKursIDR); changed = true;
        });
    }

    if (!changed) return false;
    trade.pl = trade.layers.reduce((sum, ly) => sum + (ly.status !== 'open' ? ly.pl : 0), 0);
    const allResolved = trade.layers.every(ly => ly.status !== 'open');
    if (allResolved) { trade.status = 'closed'; trade.closedAt = new Date().toISOString(); console.log('🔒 Posisi closed penuh.'); }
    else console.log('📊 Sebagian layer closed, posisi masih jalan.');
    return true;
}

async function main() {
    console.log(`[${new Date().toISOString()}] Mulai tick bot Trading AI...`);
    const docRef = db.collection('appData').doc(AI_TARGET_UID);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : {};
    let aiTradeData = data.aiTradeData || {};
    const aiModalAwal = data.aiModalAwal || 2500000;

    const candles = await fetchAiPriceData();
    const liveKursIDR = await fetchLiveKursIDR();

    const openInfo = findOpenAiTrade(aiTradeData);
    let needsSave = false;

    if (openInfo) {
        const trailingChanged = updateTrailingStops(openInfo.trade, candles);
        const closeChanged = checkAndCloseAiPosition(openInfo.trade, candles, liveKursIDR);
        needsSave = trailingChanged || closeChanged;
        if (!closeChanged) console.log('⏳ Posisi masih open, belum ada SL/TP kesentuh.');
    } else if (!isMarketOpen()) {
        console.log('💤 Market tutup (weekend), skip.');
    } else if (isHighImpactNewsWindow()) {
        console.log('📰 Jam rawan berita, skip entry baru.');
    } else {
        needsSave = await autoOpenAiPosition(aiTradeData, candles);
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
