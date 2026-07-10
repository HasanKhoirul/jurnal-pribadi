# Bot Trading AI - versi VPS, jalan terus-menerus (bukan sekali-tick kayak ai-tick.mjs di GitHub Actions).
# Logic sinyal & manajemen posisi identik dengan ai-tick.mjs/script.js - bedanya sumber harga dari MT5
# lokal (bukan TwelveData), dan strateginya dipecah 2 loop:
#   - fast loop (tiap FAST_LOOP_SECONDS): cek SL/TP/pending-fill dari tick harga real-time, presisi tinggi
#   - slow loop (tiap SLOW_LOOP_SECONDS): hitung ulang indikator dari candle & cari sinyal entry baru
# Field & struktur data di Firestore (aiTradeData, layers, dst.) dijaga sama persis dengan versi JS,
# biar web app (script.js) tetap bisa baca/render tanpa perubahan.

import os
import sys
import time
import math
import subprocess
import threading
import copy
from datetime import datetime, timezone, timedelta

import requests
import MetaTrader5 as mt5
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()

FIREBASE_SERVICE_ACCOUNT_PATH = os.environ['FIREBASE_SERVICE_ACCOUNT_PATH']
AI_TARGET_UID = os.environ['AI_TARGET_UID']
TELEGRAM_BOT_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
TELEGRAM_CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')  # kosong dulu, layer confidence nyusul
MT5_LOGIN = int(os.environ['MT5_LOGIN'])
MT5_PASSWORD = os.environ['MT5_PASSWORD']
MT5_SERVER = os.environ['MT5_SERVER']
MT5_TERMINAL_PATH = os.environ.get('MT5_TERMINAL_PATH', '')  # opsional, path ke terminal64.exe kalau initialize() gagal nemu otomatis

SYMBOL_CANDIDATES = ['XAUUSD', 'XAUUSDm', 'XAUUSDc', 'XAUUSDz', 'XAUUSDr', 'XAUUSD.', 'GOLD', 'GOLDm']
AI_TIMEFRAME_MT5 = mt5.TIMEFRAME_H1
AI_TIMEFRAME_LABEL = '1h'

# Metode 2 (ICT/SMC Liquidity Sweep) - HTF buat validasi sweep, LTF buat CHoCH + entry. Cuma dipakai kalau AI_METHOD_TWO_ENABLED.
AI_ICT_HTF_MT5 = mt5.TIMEFRAME_H4
AI_ICT_LTF_MT5 = mt5.TIMEFRAME_M15

FAST_LOOP_SECONDS = 10
SLOW_LOOP_SECONDS = 300  # 5 menit

# ---------- Konstanta trading (harus identik ai-tick.mjs / FIRESTORE_SCHEMA.md) ----------
# Nilai di bawah ini cuma default awal - dibaca ulang & bisa di-override tiap tick lewat
# aiSettings.master di Firestore (diatur dari menu "Master Setting" web app), lewat apply_ai_settings().
AI_PIP_SIZE = 0.1
AI_MASTER_DEFAULTS = {
    'slPips': 50, 'slMode': 'fixed', 'atrMultiplier': 1.5, 'tpLayerPips': [80, 100, 150], 'lotSize': 0.1, 'layerStaggerPips': 10,
    'lockPipsAfterTp1': 10, 'deepLockTriggerPips': 100, 'deepLockPips': 80, 'deepLockTimeoutMinutes': 15,
    'minSignalWinrate': 35, 'winrateLookbackDays': 14, 'winrateMinSamples': 5,
    'newsPreMinutes': 10, 'newsPostMinutes': 40,
    'pipValueUnit': 'cent', 'pipValuePerLot': 1,
    'tpMode': 'fixed',
    'summaryIntervalHours': 6,
    'methodTwoEnabled': False,
}
AI_LOT_SIZE = AI_MASTER_DEFAULTS['lotSize']
AI_SL_PIPS = AI_MASTER_DEFAULTS['slPips']
AI_SL_MODE = AI_MASTER_DEFAULTS['slMode']  # 'fixed' | 'atr' - kalau 'atr', SL ikut ATR(14) x AI_ATR_MULTIPLIER (clamp 30-120 pips)
AI_ATR_MULTIPLIER = AI_MASTER_DEFAULTS['atrMultiplier']
AI_TP_LAYERS_PIPS = AI_MASTER_DEFAULTS['tpLayerPips']
AI_TP_MODE = AI_MASTER_DEFAULTS['tpMode']  # 'fixed' | 'adaptive' - kalau 'adaptive', TP & deep-lock Layer 3 proporsional ke slPipsUsed
AI_PIP_VALUE_UNIT = AI_MASTER_DEFAULTS['pipValueUnit']  # 'cent' | 'usd' - satuan AI_PIP_VALUE_PER_LOT
AI_PIP_VALUE_PER_LOT = AI_MASTER_DEFAULTS['pipValuePerLot']
AI_LAYER_STAGGER_PIPS = AI_MASTER_DEFAULTS['layerStaggerPips']
AI_LOCK_PIPS_AFTER_TP1 = AI_MASTER_DEFAULTS['lockPipsAfterTp1']
AI_DEEP_LOCK_TRIGGER_PIPS = AI_MASTER_DEFAULTS['deepLockTriggerPips']
AI_DEEP_LOCK_PIPS = AI_MASTER_DEFAULTS['deepLockPips']
AI_DEEP_LOCK_TIMEOUT_MINUTES = AI_MASTER_DEFAULTS['deepLockTimeoutMinutes']
AI_MIN_SIGNAL_WINRATE = AI_MASTER_DEFAULTS['minSignalWinrate']
AI_WINRATE_LOOKBACK_DAYS = AI_MASTER_DEFAULTS['winrateLookbackDays']
AI_WINRATE_MIN_SAMPLES = AI_MASTER_DEFAULTS['winrateMinSamples']
AI_NEWS_PRE_MINUTES = AI_MASTER_DEFAULTS['newsPreMinutes']
AI_NEWS_POST_MINUTES = AI_MASTER_DEFAULTS['newsPostMinutes']
AI_SUMMARY_INTERVAL_HOURS = AI_MASTER_DEFAULTS['summaryIntervalHours']
AI_METHOD_TWO_ENABLED = AI_MASTER_DEFAULTS['methodTwoEnabled']


def apply_ai_settings(master):
    global AI_LOT_SIZE, AI_SL_PIPS, AI_SL_MODE, AI_ATR_MULTIPLIER, AI_TP_LAYERS_PIPS, AI_TP_MODE, AI_LAYER_STAGGER_PIPS, AI_LOCK_PIPS_AFTER_TP1
    global AI_DEEP_LOCK_TRIGGER_PIPS, AI_DEEP_LOCK_PIPS, AI_DEEP_LOCK_TIMEOUT_MINUTES
    global AI_MIN_SIGNAL_WINRATE, AI_WINRATE_LOOKBACK_DAYS, AI_WINRATE_MIN_SAMPLES
    global AI_NEWS_PRE_MINUTES, AI_NEWS_POST_MINUTES
    global AI_PIP_VALUE_UNIT, AI_PIP_VALUE_PER_LOT
    global AI_SUMMARY_INTERVAL_HOURS
    global AI_METHOD_TWO_ENABLED
    master = master or {}
    tp_layers = master.get('tpLayerPips')
    if not (isinstance(tp_layers, list) and len(tp_layers) == 3 and all(isinstance(x, (int, float)) for x in tp_layers)):
        tp_layers = AI_MASTER_DEFAULTS['tpLayerPips']
    AI_LOT_SIZE = master.get('lotSize', AI_MASTER_DEFAULTS['lotSize'])
    AI_SL_PIPS = master.get('slPips', AI_MASTER_DEFAULTS['slPips'])
    AI_SL_MODE = 'atr' if master.get('slMode') == 'atr' else 'fixed'
    AI_ATR_MULTIPLIER = master.get('atrMultiplier', AI_MASTER_DEFAULTS['atrMultiplier'])
    AI_TP_LAYERS_PIPS = tp_layers
    AI_TP_MODE = 'adaptive' if master.get('tpMode') == 'adaptive' else 'fixed'
    AI_PIP_VALUE_UNIT = 'usd' if master.get('pipValueUnit') == 'usd' else 'cent'
    AI_PIP_VALUE_PER_LOT = master.get('pipValuePerLot', AI_MASTER_DEFAULTS['pipValuePerLot'])
    AI_LAYER_STAGGER_PIPS = master.get('layerStaggerPips', AI_MASTER_DEFAULTS['layerStaggerPips'])
    AI_LOCK_PIPS_AFTER_TP1 = master.get('lockPipsAfterTp1', AI_MASTER_DEFAULTS['lockPipsAfterTp1'])
    AI_DEEP_LOCK_TRIGGER_PIPS = master.get('deepLockTriggerPips', AI_MASTER_DEFAULTS['deepLockTriggerPips'])
    AI_DEEP_LOCK_PIPS = master.get('deepLockPips', AI_MASTER_DEFAULTS['deepLockPips'])
    AI_DEEP_LOCK_TIMEOUT_MINUTES = master.get('deepLockTimeoutMinutes', AI_MASTER_DEFAULTS['deepLockTimeoutMinutes'])
    AI_MIN_SIGNAL_WINRATE = master.get('minSignalWinrate', AI_MASTER_DEFAULTS['minSignalWinrate'])
    AI_WINRATE_LOOKBACK_DAYS = master.get('winrateLookbackDays', AI_MASTER_DEFAULTS['winrateLookbackDays'])
    AI_WINRATE_MIN_SAMPLES = master.get('winrateMinSamples', AI_MASTER_DEFAULTS['winrateMinSamples'])
    AI_NEWS_PRE_MINUTES = master.get('newsPreMinutes', AI_MASTER_DEFAULTS['newsPreMinutes'])
    AI_NEWS_POST_MINUTES = master.get('newsPostMinutes', AI_MASTER_DEFAULTS['newsPostMinutes'])
    AI_SUMMARY_INTERVAL_HOURS = master.get('summaryIntervalHours', AI_MASTER_DEFAULTS['summaryIntervalHours'])
    AI_METHOD_TWO_ENABLED = bool(master.get('methodTwoEnabled', AI_MASTER_DEFAULTS['methodTwoEnabled']))


def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)


# ---------- Setup MT5 ----------
def resolve_symbol():
    for name in SYMBOL_CANDIDATES:
        info = mt5.symbol_info(name)
        if info is not None:
            if not info.visible:
                mt5.symbol_select(name, True)
            return name
    raise RuntimeError(
        "Gak ketemu simbol XAUUSD di Market Watch. Cek nama persis simbolnya di MT5 "
        "(klik kanan Market Watch -> Symbols, cari 'XAU'), lalu tambahin ke SYMBOL_CANDIDATES."
    )


_init_kwargs = {'login': MT5_LOGIN, 'password': MT5_PASSWORD, 'server': MT5_SERVER, 'timeout': 120000}
if MT5_TERMINAL_PATH:
    _init_kwargs['path'] = MT5_TERMINAL_PATH
if not mt5.initialize(**_init_kwargs):
    raise RuntimeError(f"MT5 initialize() gagal: {mt5.last_error()}")
SYMBOL = resolve_symbol()
log(f"MT5 terhubung. Simbol dipakai: {SYMBOL}")

# ---------- Setup Firebase ----------
cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()
doc_ref = db.collection('appData').document(AI_TARGET_UID)
public_doc_ref = db.collection('appData').document('public')


# ---------- Telegram ----------
def send_telegram(text):
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            data={'chat_id': TELEGRAM_CHAT_ID, 'text': text, 'parse_mode': 'HTML'},
            timeout=10,
        )
    except Exception as e:
        log(f"Gagal kirim Telegram: {e}")


# ---------- Helper angka & indikator (identik ai-tick.mjs) ----------
def pip_to_price(pips):
    return pips * AI_PIP_SIZE


def calc_layer_pl_usc(pips):
    return pips * (AI_LOT_SIZE / 0.1) * AI_PIP_VALUE_PER_LOT


# Nama fungsi dipertahankan "usc" apa adanya (dipanggil di banyak tempat) - sekarang unit-aware lewat AI_PIP_VALUE_UNIT.
def usc_to_rupiah(usc, kurs):
    usd = usc if AI_PIP_VALUE_UNIT == 'usd' else usc / 100
    return usd * kurs


def calc_sma(closes, period):
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - period, len(closes)):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        return 100.0
    return 100 - (100 / (1 + (avg_gain / avg_loss)))


def calc_ema_series(values, period):
    k = 2 / (period + 1)
    series = [values[0]]
    for i in range(1, len(values)):
        series.append(values[i] * k + series[-1] * (1 - k))
    return series


def calc_macd(closes):
    if len(closes) < 35:
        return None
    ema12 = calc_ema_series(closes, 12)
    ema26 = calc_ema_series(closes, 26)
    macd_line = [a - b for a, b in zip(ema12, ema26)]
    signal_line = calc_ema_series(macd_line, 9)
    return {'macd': macd_line[-1], 'signal': signal_line[-1]}


def calc_bollinger(closes, period=20, mult=2):
    if len(closes) < period:
        return None
    sl = closes[-period:]
    mean = sum(sl) / period
    variance = sum((x - mean) ** 2 for x in sl) / period
    stdev = math.sqrt(variance)
    return {'upper': mean + mult * stdev, 'lower': mean - mult * stdev, 'mid': mean}


# Average True Range - jarak SL adaptif ikut volatilitas terkini (dipakai kalau AI_SL_MODE == 'atr')
def calc_atr(candles, period=14):
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(len(candles) - period, len(candles)):
        c, prev_close = candles[i], candles[i - 1]['close']
        trs.append(max(c['high'] - c['low'], abs(c['high'] - prev_close), abs(c['low'] - prev_close)))
    return sum(trs) / period


def is_market_open(now):
    day = now.weekday()  # Monday=0 ... Sunday=6
    hour = now.hour
    if day == 5:  # Saturday
        return False
    if day == 6 and hour < 22:  # Sunday sebelum 22:00 UTC
        return False
    if day == 4 and hour >= 21:  # Jumat setelah 21:00 UTC
        return False
    return True


def is_high_impact_news_window_fallback(now):
    day = now.weekday()
    if day in (5, 6):
        return False
    return 12 <= now.hour < 15


def fetch_active_high_impact_news():
    try:
        res = requests.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', timeout=10)
        events = res.json()
        now_ms = time.time() * 1000
        for e in events:
            if e.get('impact') != 'High' or e.get('country') != 'USD':
                continue
            t = datetime.fromisoformat(e['date'].replace('Z', '+00:00')).timestamp() * 1000
            if now_ms >= t - AI_NEWS_PRE_MINUTES * 60000 and now_ms <= t + AI_NEWS_POST_MINUTES * 60000:
                return {'title': e['title'], 'time': e['date']}
        return None
    except Exception as e:
        log(f"Gagal ambil kalender berita, fallback ke perkiraan jam kasar: {e}")
        now = datetime.now(timezone.utc)
        return {'title': '(perkiraan, kalender gagal diambil)', 'time': None} if is_high_impact_news_window_fallback(now) else None


def fetch_live_kurs_idr():
    try:
        res = requests.get('https://api.exchangerate-api.com/v4/latest/USD', timeout=10)
        return res.json().get('rates', {}).get('IDR', 16000)
    except Exception as e:
        log(f"Gagal ambil kurs, pakai fallback 16000: {e}")
        return 16000


def fetch_candles(count=100, timeframe=AI_TIMEFRAME_MT5):
    rates = mt5.copy_rates_from_pos(SYMBOL, timeframe, 0, count)
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"Gagal ambil candle MT5: {mt5.last_error()}")
    return [
        {
            'time': datetime.fromtimestamp(r['time'], tz=timezone.utc).isoformat(),
            'open': float(r['open']), 'high': float(r['high']),
            'low': float(r['low']), 'close': float(r['close']),
        }
        for r in rates
    ]


# ---------- Win-rate adaptif & sinyal ----------
def get_recent_signal_winrate(trade_data, signal_type):
    cutoff = datetime.now(timezone.utc) - timedelta(days=AI_WINRATE_LOOKBACK_DAYS)
    total = win = 0
    for d, trades in trade_data.items():
        try:
            if datetime.fromisoformat(d) < cutoff.replace(tzinfo=None):
                continue
        except ValueError:
            continue
        for t in trades:
            if t.get('status') != 'closed' or t.get('signalType') != signal_type:
                continue
            total += 1
            if float(t.get('pl', 0) or 0) >= 0:
                win += 1
    return (win / total) * 100 if total >= AI_WINRATE_MIN_SAMPLES else None


last_signal_skip_reason = None


def compute_ai_suggestion(candles, trade_data):
    global last_signal_skip_reason
    closes = [c['close'] for c in candles]
    last_close = closes[-1]
    ma20 = calc_sma(closes, 20)
    ma50 = calc_sma(closes, 50)
    rsi = calc_rsi(closes, 14)
    if ma20 is None or ma50 is None or rsi is None:
        last_signal_skip_reason = 'Data candle belum cukup buat hitung indikator.'
        return None

    trend = 'uptrend' if ma20 > ma50 else 'downtrend'
    reason_parts = [
        f"Harga saat ini {last_close:.2f}.",
        f"MA20 ({ma20:.2f}) {'di atas' if ma20 > ma50 else 'di bawah'} MA50 ({ma50:.2f}) -> {trend}.",
        f"RSI(14) = {rsi:.1f} ({'overbought' if rsi >= 70 else 'oversold' if rsi <= 30 else 'netral'}).",
    ]
    if rsi >= 70:
        arah, signal_type = 'SELL', 'rsi_reversal'
        reason_parts.append("RSI overbought -> potensi koreksi turun.")
    elif rsi <= 30:
        arah, signal_type = 'BUY', 'rsi_reversal'
        reason_parts.append("RSI oversold -> potensi rebound naik.")
    elif trend == 'uptrend':
        arah, signal_type = 'BUY', 'trend_following'
        reason_parts.append("Trend naik & RSI netral -> peluang BUY mengikuti trend.")
    else:
        arah, signal_type = 'SELL', 'trend_following'
        reason_parts.append("Trend turun & RSI netral -> peluang SELL mengikuti trend.")

    recent_wr = get_recent_signal_winrate(trade_data, signal_type)
    if recent_wr is not None and recent_wr < AI_MIN_SIGNAL_WINRATE:
        last_signal_skip_reason = (
            f"Win rate {signal_type} {recent_wr:.0f}% dalam {AI_WINRATE_LOOKBACK_DAYS} hari terakhir "
            f"(di bawah ambang {AI_MIN_SIGNAL_WINRATE}%)."
        )
        return None

    macd = calc_macd(closes)
    if macd:
        macd_bullish = macd['macd'] > macd['signal']
        reason_parts.append(f"MACD {'bullish' if macd_bullish else 'bearish'} ({macd['macd']:.2f} vs signal {macd['signal']:.2f}).")
        if (arah == 'BUY' and not macd_bullish) or (arah == 'SELL' and macd_bullish):
            last_signal_skip_reason = (
                f"MACD gak konfirmasi arah {arah} (trend/RSI nunjuk {arah}, tapi MACD {'bullish' if macd_bullish else 'bearish'})."
            )
            return None

    bb = calc_bollinger(closes, 20, 2)
    if bb:
        reason_parts.append(f"Bollinger Band: harga {last_close:.2f} (upper {bb['upper']:.2f}, lower {bb['lower']:.2f}).")

    dir_sign = 1 if arah == 'BUY' else -1
    entry = last_close
    sl_pips_used = AI_SL_PIPS
    if AI_SL_MODE == 'atr':
        atr = calc_atr(candles, 14)
        if atr is not None:
            sl_pips_used = min(120, max(30, round((atr / AI_PIP_SIZE) * AI_ATR_MULTIPLIER)))
    sl = entry - dir_sign * pip_to_price(sl_pips_used)

    tp_pips_used = list(AI_TP_LAYERS_PIPS)
    deep_lock_trigger_used = AI_DEEP_LOCK_TRIGGER_PIPS
    deep_lock_pips_used = AI_DEEP_LOCK_PIPS
    if AI_TP_MODE == 'adaptive' and AI_SL_PIPS > 0:
        tp_pips_used = [round(sl_pips_used * (tp / AI_SL_PIPS)) for tp in AI_TP_LAYERS_PIPS]
        deep_lock_trigger_used = round(sl_pips_used * (AI_DEEP_LOCK_TRIGGER_PIPS / AI_SL_PIPS))
        deep_lock_pips_used = round(sl_pips_used * (AI_DEEP_LOCK_PIPS / AI_SL_PIPS))

    reason_parts.append(
        f"Entry {entry:.2f}, SL {sl_pips_used} pips{' (adaptif ATR)' if AI_SL_MODE == 'atr' else ''} ({sl:.2f}), "
        f"TP berlapis {'/'.join(map(str, tp_pips_used))} pips{' (adaptif)' if AI_TP_MODE == 'adaptive' else ''}, lot {AI_LOT_SIZE} x3 layer."
    )

    return {
        'arah': arah, 'entry': entry, 'sl': sl, 'dirSign': dir_sign,
        'reasonText': ' '.join(reason_parts), 'tf': AI_TIMEFRAME_LABEL, 'signalType': signal_type,
        'slPipsUsed': sl_pips_used, 'tpPipsUsed': tp_pips_used,
        'deepLockTriggerPipsUsed': deep_lock_trigger_used, 'deepLockPipsUsed': deep_lock_pips_used,
    }


# Method 1 (trend_following/rsi_reversal) & Method 2 (ICT) masing2 punya slot posisi terbuka SENDIRI -
# supaya gak rebutan/starve satu sama lain saat mau dibandingin performanya (lihat memory bank-ide poin 7).
METHOD_GROUPS = {
    'method1': {'trend_following', 'rsi_reversal'},
    'method2': {'ict_liquidity_sweep'},
}


def find_open_ai_trade_for_group(ai_trade_data, signal_types):
    for date_key, trades in ai_trade_data.items():
        for i, t in enumerate(trades):
            if t.get('status') == 'open' and t.get('signalType') in signal_types:
                return {'dateKey': date_key, 'index': i, 'trade': t}
    return None


def today_wib_date_str():
    now_wib = datetime.now(timezone.utc) + timedelta(hours=7)
    return now_wib.strftime('%Y-%m-%d')


def format_rupiah(value):
    return f"Rp{value:,.0f}".replace(',', '.')


def _sum_closed_pl(trades):
    closed = [t for t in trades if t.get('status') == 'closed']
    return sum(float(t.get('pl', 0) or 0) for t in closed), len(closed)


def get_today_pl(ai_trade_data):
    return _sum_closed_pl(ai_trade_data.get(today_wib_date_str(), []))


def get_current_week_pl(ai_trade_data):
    now_wib = datetime.now(timezone.utc) + timedelta(hours=7)
    monday_str = (now_wib - timedelta(days=now_wib.weekday())).strftime('%Y-%m-%d')
    total, count = 0.0, 0
    for date_str, trades in ai_trade_data.items():
        if date_str < monday_str:
            continue
        t, c = _sum_closed_pl(trades)
        total += t
        count += c
    return total, count


def get_all_time_pl(ai_trade_data):
    total, count = 0.0, 0
    for trades in ai_trade_data.values():
        t, c = _sum_closed_pl(trades)
        total += t
        count += c
    return total, count


def auto_open_ai_position(ai_trade_data, sug):
    if not sug:
        return False
    date_str = today_wib_date_str()
    ai_trade_data.setdefault(date_str, [])
    layers = []
    tp_pips_used = sug['tpPipsUsed']
    for i, tp_pips in enumerate(tp_pips_used):
        layer_entry = sug['entry'] - sug['dirSign'] * pip_to_price(i * AI_LAYER_STAGGER_PIPS)
        layer = {
            'tpPips': tp_pips,
            'entry': layer_entry,
            'tp': layer_entry + sug['dirSign'] * pip_to_price(tp_pips),
            'sl': layer_entry - sug['dirSign'] * pip_to_price(sug['slPipsUsed']),
            'lot': AI_LOT_SIZE,
            'status': 'open' if i == 0 else 'pending',
            'pl': 0,
            'slMoved': False,
        }
        if i == len(tp_pips_used) - 1:
            layer['deepLockTriggerPips'] = sug['deepLockTriggerPipsUsed']
            layer['deepLockPips'] = sug['deepLockPipsUsed']
        layers.append(layer)
    ai_trade_data[date_str].append({
        'arah': sug['arah'], 'tf': sug['tf'], 'entry': sug['entry'], 'sl': layers[0]['sl'],
        'layers': layers, 'alasan': sug['reasonText'], 'signalType': sug['signalType'],
        'status': 'open', 'pl': 0,
        'openedAt': datetime.now(timezone.utc).isoformat(), 'closedAt': None,
    })
    log(f"Entry baru dibuka: {sug['arah']} @ {sug['entry']:.2f} "
        f"(layer2/3 pending di {layers[1]['entry']:.2f} / {layers[2]['entry']:.2f}).")
    send_telegram(
        f"🟢 <b>SINYAL {sug['arah']} XAUUSD</b>\n\n"
        f"<b>Entry:</b> <code>{sug['entry']:.2f}</code>\n"
        f"<b>SL:</b> <code>{layers[0]['sl']:.2f}</code> ({sug['slPipsUsed']} pips)\n\n"
        f"<b>TP1:</b> <code>{layers[0]['tp']:.2f}</code>\n"
        f"<b>TP2:</b> <code>{layers[1]['tp']:.2f}</code>\n"
        f"<b>TP3:</b> <code>{layers[2]['tp']:.2f}</code>\n\n"
        f"📝 <i>{sug['reasonText']}</i>"
    )
    return True


# ---------- Metode 2: ICT/SMC Liquidity Sweep ----------
# State-machine 3 langkah, persisten lewat Firestore field `ictState` (survive restart & antar-tick):
#   idle -> (sweep H4 kedeteksi) -> awaiting_choch -> (CHoCH M15 confirmed) -> ready -> (dibuka) -> idle
# Asumsi/default yang gak eksplisit disebut di materi sumber (didokumentasikan di plan, boleh di-tuning kalau kepake):
# swing fractal K=2 candle, timeout CHoCH 24 jam, entry = OB midpoint (bukan FVG), SL buffer 20 pips.
AI_ICT_SWING_LOOKBACK = 2
AI_ICT_CHOCH_TIMEOUT_HOURS = 24
AI_ICT_DISPLACEMENT_MIN_BODY_RATIO = 0.7
AI_ICT_SL_BUFFER_PIPS = 20

ICT_STATE_DEFAULT = {
    'phase': 'idle', 'direction': None, 'sweepAt': None, 'sweepLevel': None,
    'sweptHtfCandleTime': None, 'readyEntry': None, 'readySl': None,
    'readyTpPipsUsed': None, 'readyAlasan': None,
}


def _find_swings(candles, lookback=AI_ICT_SWING_LOOKBACK):
    # Fractal sederhana: candle dianggap swing high/low kalau high/low-nya paling ekstrem dibanding
    # `lookback` candle sebelum & sesudahnya. Return list terurut naik berdasar index (item terakhir = terbaru).
    highs, lows = [], []
    n = len(candles)
    for i in range(lookback, n - lookback):
        window = candles[i - lookback:i + lookback + 1]
        if candles[i]['high'] == max(c['high'] for c in window):
            highs.append((i, candles[i]['high']))
        if candles[i]['low'] == min(c['low'] for c in window):
            lows.append((i, candles[i]['low']))
    return highs, lows


def _body_to_wick_ratio(candle):
    total_range = candle['high'] - candle['low']
    if total_range <= 0:
        return 0.0
    return abs(candle['close'] - candle['open']) / total_range


def detect_htf_sweep(htf_candles):
    # Cek candle H4 terakhir yang closed: nembus swing high/low sebelumnya TAPI close balik masuk range
    # lagi (rejection wick) - signature standar "liquidity sweep".
    if len(htf_candles) < AI_ICT_SWING_LOOKBACK * 2 + 3:
        return None
    prior, last = htf_candles[:-1], htf_candles[-1]
    highs, lows = _find_swings(prior, AI_ICT_SWING_LOOKBACK)
    if highs:
        swing_high = highs[-1][1]
        if last['high'] > swing_high and last['close'] < swing_high:
            return {'direction': 'SELL', 'sweepLevel': last['high'], 'candleTime': last['time']}
    if lows:
        swing_low = lows[-1][1]
        if last['low'] < swing_low and last['close'] > swing_low:
            return {'direction': 'BUY', 'sweepLevel': last['low'], 'candleTime': last['time']}
    return None


def detect_ltf_choch(ltf_candles, ict_state):
    # Cari swing M15 yang terbentuk SETELAH sweep, lalu tunggu candle yang closenya nembus swing itu
    # (Change of Character) DAN memenuhi filter displacement (body-to-wick >=70%, divalidasi 2 sumber materi).
    sweep_at = ict_state.get('sweepAt')
    if not sweep_at:
        return None
    sweep_dt = datetime.fromisoformat(sweep_at)
    post_sweep = [c for c in ltf_candles if datetime.fromisoformat(c['time']) >= sweep_dt]
    if len(post_sweep) < AI_ICT_SWING_LOOKBACK * 2 + 3:
        return None

    direction = ict_state.get('direction')
    highs, lows = _find_swings(post_sweep, AI_ICT_SWING_LOOKBACK)

    if direction == 'SELL' and lows:
        idx, level = lows[-1]
        for c in post_sweep[idx + 1:]:
            if c['close'] < level:
                if _body_to_wick_ratio(c) >= AI_ICT_DISPLACEMENT_MIN_BODY_RATIO:
                    return {'chochCandle': c, 'chochLevel': level}
                return None  # structure break tanpa displacement cukup - bukan CHoCH valid, tunggu sweep baru
    elif direction == 'BUY' and highs:
        idx, level = highs[-1]
        for c in post_sweep[idx + 1:]:
            if c['close'] > level:
                if _body_to_wick_ratio(c) >= AI_ICT_DISPLACEMENT_MIN_BODY_RATIO:
                    return {'chochCandle': c, 'chochLevel': level}
                return None
    return None


def build_ict_ready_suggestion(ltf_candles, choch, ict_state):
    direction = ict_state['direction']
    dir_sign = 1 if direction == 'BUY' else -1
    choch_candle = choch['chochCandle']
    choch_idx = next((i for i, c in enumerate(ltf_candles) if c['time'] == choch_candle['time']), None)
    if not choch_idx:
        return None

    # Order Block = candle M15 terakhir berlawanan warna sebelum leg displacement yang bikin CHoCH.
    ob_candle = None
    for i in range(choch_idx - 1, -1, -1):
        c = ltf_candles[i]
        is_down_close = c['close'] < c['open']
        if direction == 'SELL' and not is_down_close:
            ob_candle = c
            break
        if direction == 'BUY' and is_down_close:
            ob_candle = c
            break
    if ob_candle is None:
        return None

    entry = (ob_candle['high'] + ob_candle['low']) / 2
    sl = ict_state['sweepLevel'] - dir_sign * pip_to_price(AI_ICT_SL_BUFFER_PIPS)
    sl_pips_used = abs((entry - sl) / AI_PIP_SIZE)
    if sl_pips_used <= 0:
        return None

    tp_pips_used = (
        [round(sl_pips_used * (tp / AI_SL_PIPS)) for tp in AI_TP_LAYERS_PIPS]
        if AI_SL_PIPS > 0 else list(AI_TP_LAYERS_PIPS)
    )
    reason = (
        f"[Metode 2 - ICT] Sweep {direction} @ {ict_state['sweepLevel']:.2f}, CHoCH M15 confirmed, "
        f"entry OB midpoint {entry:.2f}, SL {sl_pips_used:.0f} pips."
    )
    return {
        'arah': direction, 'entry': entry, 'sl': sl, 'dirSign': dir_sign,
        'reasonText': reason, 'tf': 'M15', 'signalType': 'ict_liquidity_sweep',
        'slPipsUsed': round(sl_pips_used), 'tpPipsUsed': tp_pips_used,
        'deepLockTriggerPipsUsed': AI_DEEP_LOCK_TRIGGER_PIPS, 'deepLockPipsUsed': AI_DEEP_LOCK_PIPS,
    }


def run_ict_state_machine(ict_state, ai_trade_data):
    # Return (new_ict_state, ready_sug_or_None). Dipanggil tiap slow tick kalau AI_METHOD_TWO_ENABLED &
    # slot method2 kosong. Progres state machine (deteksi sweep/CHoCH) tetap jalan lepas dari kondisi
    # market/news - itu cuma analisa struktur harga historis, bukan aksi eksekusi.
    state = dict(ICT_STATE_DEFAULT, **(ict_state or {}))
    try:
        if state['phase'] == 'idle':
            htf_candles = fetch_candles(60, AI_ICT_HTF_MT5)
            sweep = detect_htf_sweep(htf_candles)
            if sweep and sweep['candleTime'] != state.get('sweptHtfCandleTime'):
                state.update({
                    'phase': 'awaiting_choch', 'direction': sweep['direction'],
                    'sweepLevel': sweep['sweepLevel'], 'sweepAt': datetime.now(timezone.utc).isoformat(),
                    'sweptHtfCandleTime': sweep['candleTime'],
                })
                log_ai_tick('ict_sweep', f"Metode 2: sweep {sweep['direction']} @ {sweep['sweepLevel']:.2f} kedeteksi (H4), nunggu CHoCH M15.")
            return state, None

        if state['phase'] == 'awaiting_choch':
            sweep_at = datetime.fromisoformat(state['sweepAt'])
            if datetime.now(timezone.utc) - sweep_at > timedelta(hours=AI_ICT_CHOCH_TIMEOUT_HOURS):
                log_ai_tick('ict_timeout', f"Metode 2: sweep {state['direction']} @ {state['sweepLevel']:.2f} basi, gak ada CHoCH dlm {AI_ICT_CHOCH_TIMEOUT_HOURS} jam, reset.")
                return dict(ICT_STATE_DEFAULT), None

            ltf_candles = fetch_candles(120, AI_ICT_LTF_MT5)
            choch = detect_ltf_choch(ltf_candles, state)
            if not choch:
                return state, None
            sug = build_ict_ready_suggestion(ltf_candles, choch, state)
            if not sug:
                return dict(ICT_STATE_DEFAULT), None
            state.update({
                'phase': 'ready', 'readyEntry': sug['entry'], 'readySl': sug['sl'],
                'readyTpPipsUsed': sug['tpPipsUsed'], 'readyAlasan': sug['reasonText'],
            })
            log_ai_tick('ict_ready', sug['reasonText'])
            return state, None

        if state['phase'] == 'ready':
            wr = get_recent_signal_winrate(ai_trade_data, 'ict_liquidity_sweep')
            if wr is not None and wr < AI_MIN_SIGNAL_WINRATE:
                return state, None  # winrate lg rendah, tahan buka - state 'ready' tetap disimpan, dicoba lagi tick berikutnya
            direction = state['direction']
            sug = {
                'arah': direction, 'entry': state['readyEntry'], 'sl': state['readySl'],
                'dirSign': 1 if direction == 'BUY' else -1,
                'reasonText': state['readyAlasan'], 'tf': 'M15', 'signalType': 'ict_liquidity_sweep',
                'slPipsUsed': round(abs((state['readyEntry'] - state['readySl']) / AI_PIP_SIZE)),
                'tpPipsUsed': state['readyTpPipsUsed'],
                'deepLockTriggerPipsUsed': AI_DEEP_LOCK_TRIGGER_PIPS, 'deepLockPipsUsed': AI_DEEP_LOCK_PIPS,
            }
            return state, sug
    except Exception as e:
        log(f"Metode 2 (ICT) state machine error, reset ke idle: {e}")
        return dict(ICT_STATE_DEFAULT), None
    return state, None


def cancel_pending_siblings(trade):
    for ly in trade['layers'][1:]:
        if ly['status'] == 'pending':
            ly['status'] = 'cancelled'
            ly['pl'] = 0


def exit_price_for(arah, bid, ask):
    return bid if arah == 'BUY' else ask


def entry_price_for(arah, bid, ask):
    # Sisi harga yang relevan buat cek pending order kefill: BUY limit nunggu ask turun ke level,
    # SELL limit nunggu bid naik ke level - mirip cara broker matching order beneran.
    return ask if arah == 'BUY' else bid


def check_and_close_position_tick(trade, bid, ask, live_kurs, now):
    if not trade.get('openedAt'):
        trade['openedAt'] = now.isoformat()
    layers = trade.get('layers')
    if not layers:
        return {'changed': False, 'allResolved': False, 'notes': []}

    dir_sign = 1 if trade['arah'] == 'BUY' else -1
    changed = False
    notes = []

    def not_resolved(ly):
        return ly['status'] in ('open', 'pending')

    for idx, ly in enumerate(layers):
        if ly['status'] == 'pending':
            fill_price = entry_price_for(trade['arah'], bid, ask)
            filled = fill_price <= ly['entry'] if trade['arah'] == 'BUY' else fill_price >= ly['entry']
            if filled:
                ly['status'] = 'open'
                changed = True
                notes.append(f"Layer {idx + 1} pending kefill di {ly['entry']:.2f}.")

        if ly['status'] != 'open':
            continue
        layer_entry = ly.get('entry', trade['entry'])
        sl_price = ly.get('sl', trade['sl'])
        px = exit_price_for(trade['arah'], bid, ask)

        sl_hit = px <= sl_price if trade['arah'] == 'BUY' else px >= sl_price
        if sl_hit:
            pips_at_sl = ((sl_price - layer_entry) * dir_sign) / AI_PIP_SIZE
            ly['status'] = 'be' if pips_at_sl >= 0 else 'sl'
            ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(pips_at_sl), live_kurs)
            changed = True
            notes.append(f"Layer {idx + 1} kena {ly['status'].upper()} ({pips_at_sl:.1f} pips).")
            if idx == 0:
                cancel_pending_siblings(trade)
            continue

        tp_hit = px >= ly['tp'] if trade['arah'] == 'BUY' else px <= ly['tp']
        if tp_hit:
            ly['status'] = 'tp'
            ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(ly['tpPips']), live_kurs)
            changed = True
            notes.append(f"Layer {idx + 1} kena TP (+{ly['tpPips']} pips).")
            if idx == 0:
                for l in layers[1:]:
                    if l['status'] == 'open' and not l['slMoved']:
                        l['sl'] = l['entry'] + dir_sign * pip_to_price(AI_LOCK_PIPS_AFTER_TP1)
                        l['slMoved'] = True
                cancel_pending_siblings(trade)
                notes.append(f"Layer 2 & 3 dikunci +{AI_LOCK_PIPS_AFTER_TP1} pips, sisa pending dibatalkan.")
            continue

        if idx == len(layers) - 1:
            # Baca dari layer itu sendiri dulu (dibekukan pas entry, biar konsisten sama kondisi ATR waktu trade dibuka) - fallback ke konstanta global buat trade lama sebelum fitur TP Adaptif ada.
            trigger = ly.get('deepLockTriggerPips', AI_DEEP_LOCK_TRIGGER_PIPS)
            lock_pips = ly.get('deepLockPips', AI_DEEP_LOCK_PIPS)
            pips_now = ((px - layer_entry) * dir_sign) / AI_PIP_SIZE
            if pips_now >= trigger and not ly.get('deepLockAt'):
                ly['sl'] = layer_entry + dir_sign * pip_to_price(lock_pips)
                ly['slMoved'] = True
                ly['deepLockAt'] = now.isoformat()
                changed = True
                notes.append(f"Layer terakhir tembus {trigger} pips, SL dikunci +{lock_pips} pips.")
            if ly.get('deepLockAt'):
                elapsed_min = (now - datetime.fromisoformat(ly['deepLockAt'])).total_seconds() / 60
                if elapsed_min >= AI_DEEP_LOCK_TIMEOUT_MINUTES:
                    pips_at_close = ((px - layer_entry) * dir_sign) / AI_PIP_SIZE
                    ly['status'] = 'timeout_lock'
                    ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(pips_at_close), live_kurs)
                    changed = True
                    notes.append(f"Layer terakhir timeout {AI_DEEP_LOCK_TIMEOUT_MINUTES} menit setelah lock, ditutup ({pips_at_close:.1f} pips).")

    opened_time = datetime.fromisoformat(trade['openedAt'])
    still_active = any(not_resolved(ly) for ly in layers)
    if still_active and (now - opened_time) >= timedelta(days=3):
        for ly in layers:
            if ly['status'] == 'pending':
                ly['status'] = 'cancelled'
                ly['pl'] = 0
                changed = True
                continue
            if ly['status'] != 'open':
                continue
            layer_entry = ly.get('entry', trade['entry'])
            px = exit_price_for(trade['arah'], bid, ask)
            pips_moved = ((px - layer_entry) * dir_sign) / AI_PIP_SIZE
            ly['status'] = 'timeout'
            ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(pips_moved), live_kurs)
            changed = True
        notes.append("Posisi lewat 3 hari, ditutup paksa (timeout).")

    if not changed:
        return {'changed': False, 'allResolved': False, 'notes': []}

    trade['pl'] = sum(ly['pl'] for ly in layers if not not_resolved(ly))
    all_resolved = not any(not_resolved(ly) for ly in layers)
    if all_resolved:
        trade['status'] = 'closed'
        trade['closedAt'] = now.isoformat()
    return {'changed': True, 'allResolved': all_resolved, 'notes': notes}


def force_close_all_layers_at_market(trade, bid, ask, live_kurs, status_label, now):
    layers = trade.get('layers')
    if not layers:
        return False
    dir_sign = 1 if trade['arah'] == 'BUY' else -1
    px = exit_price_for(trade['arah'], bid, ask)
    changed = False
    for ly in layers:
        if ly['status'] == 'pending':
            ly['status'] = 'cancelled'
            ly['pl'] = 0
            changed = True
            continue
        if ly['status'] != 'open':
            continue
        layer_entry = ly.get('entry', trade['entry'])
        pips_moved = ((px - layer_entry) * dir_sign) / AI_PIP_SIZE
        ly['status'] = status_label
        ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(pips_moved), live_kurs)
        changed = True
    if not changed:
        return False
    trade['pl'] = sum(ly['pl'] for ly in layers if ly['status'] != 'open')
    if all(ly['status'] != 'open' for ly in layers):
        trade['status'] = 'closed'
        trade['closedAt'] = now.isoformat()
    return True


def push_live_candles_to_public(candles):
    try:
        public_doc_ref.set({
            'aiLiveCandlesMt5': candles,
            'aiLiveCandlesMt5UpdatedAt': datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception as e:
        log(f"Gagal push candle ke appData/public: {e}")


def push_live_price_to_public(tick):
    try:
        public_doc_ref.set({
            'aiLivePriceMt5': (tick.bid + tick.ask) / 2,
            'aiLivePriceMt5UpdatedAt': datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception as e:
        log(f"Gagal push live price ke appData/public: {e}")


def log_ai_tick(outcome, detail=''):
    try:
        doc_ref.collection('ai_tick_log').add({
            'time': datetime.now(timezone.utc).isoformat(),
            'outcome': outcome,
            'detail': detail,
            'source': 'server',
        })
    except Exception as e:
        log(f"Gagal simpan log tick: {e}")


# Dipicu tombol "Restart Bot (VPS)" di web (nulis botControl.restartRequested lewat Firestore).
# git pull + restart diri sendiri pakai kode baru - kalau pull gagal, bot TETAP jalan pakai kode lama (gak mati total).
def handle_restart_request():
    now = datetime.now(timezone.utc)
    log("Restart diminta dari web, ambil kode terbaru...")
    send_telegram("🔄 Restart diminta dari web, ambil kode terbaru...")

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        result = subprocess.run(['git', 'pull'], cwd=repo_root, capture_output=True, text=True, timeout=30)
        success = result.returncode == 0
        result_msg = 'success' if success else f'failed: {result.stderr[:200]}'
    except Exception as e:
        success = False
        result_msg = f'failed: {e}'

    try:
        doc_ref.set({'botControl': {
            'restartRequested': False,
            'lastRestartAt': now.isoformat(),
            'lastRestartResult': result_msg,
        }}, merge=True)
    except Exception as e:
        log(f"Gagal update status botControl: {e}")
    log_ai_tick('restart' if success else 'error', result_msg)

    if success:
        log("Update berhasil, restart proses...")
        send_telegram("✅ Update berhasil, bot restart pakai kode terbaru...")
        mt5.shutdown()
        os.execv(sys.executable, [sys.executable] + sys.argv)
    else:
        log(f"Restart gagal: {result_msg}. Bot lanjut jalan pakai kode lama.")
        send_telegram(f"⚠️ Restart gagal: {result_msg}. Bot lanjut jalan pakai kode lama.")


# Dipicu tombol "Kirim Summary Sekarang" di web ATAU otomatis tiap AI_SUMMARY_INTERVAL_HOURS jam.
# Datanya (ai_trade_data) udah kebaca doc_ref.get() tiap tick buat keperluan lain - ngirim summary ini
# gak nambah read Firestore sama sekali, cuma format teks + kirim ke Telegram (gratis).
def send_periodic_summary(ai_trade_data, tick):
    for group_name, group_label in (('method1', ''), ('method2', ' — Metode 2 (ICT)')):
        if group_name == 'method2' and not AI_METHOD_TWO_ENABLED:
            continue  # metode 2 lg off - gak usah kirim pesan "gak ada posisi" yg gak relevan
        open_info = find_open_ai_trade_for_group(ai_trade_data, METHOD_GROUPS[group_name])
        if open_info:
            trade = open_info['trade']
            dir_sign = 1 if trade['arah'] == 'BUY' else -1
            px = exit_price_for(trade['arah'], tick.bid, tick.ask)
            live_kurs = get_cached_kurs(datetime.now(timezone.utc))
            total_floating = 0.0
            for ly in trade.get('layers', []):
                if ly['status'] != 'open':
                    continue
                pips = ((px - ly['entry']) * dir_sign) / AI_PIP_SIZE
                total_floating += usc_to_rupiah(calc_layer_pl_usc(pips), live_kurs)
            send_telegram(
                f"📍 <b>Posisi Terbuka{group_label}</b>\n\n"
                f"{trade['arah']} @ {trade['entry']:.2f}\n"
                f"Floating P/L: <b>{format_rupiah(total_floating)}</b>"
            )
        else:
            send_telegram(f"📍 <b>Posisi Terbuka{group_label}</b>\n\nGak ada posisi open saat ini.")

    today_pl, today_n = get_today_pl(ai_trade_data)
    send_telegram(f"📅 <b>P/L Hari Ini</b>\n\n{format_rupiah(today_pl)} dari {today_n} entry closed.")

    week_pl, week_n = get_current_week_pl(ai_trade_data)
    send_telegram(f"🗓️ <b>P/L Minggu Ini</b>\n\n{format_rupiah(week_pl)} dari {week_n} entry closed.")

    all_pl, all_n = get_all_time_pl(ai_trade_data)
    send_telegram(f"📊 <b>P/L Keseluruhan</b>\n\n{format_rupiah(all_pl)} dari {all_n} entry closed.")


# Kirim summary di thread terpisah - 4x send_telegram() berurutan (masing2 bisa timeout 10 detik)
# gak boleh nge-block fast loop yang harus tetap tiap-tick cek SL/TP/deep-lock.
_summary_in_flight = False


# Jadwal nempel ke jam bulat WIB (00/06/12/18 kalau interval=6), BUKAN "N jam sejak restart/kiriman
# terakhir" - biar gak geser2 tiap kali bot di-restart.
def _latest_scheduled_summary_utc(now_utc, interval_hours):
    interval_hours = int(interval_hours) if interval_hours and interval_hours > 0 else 6
    now_wib = now_utc + timedelta(hours=7)
    slot_hour = now_wib.hour - (now_wib.hour % interval_hours)
    slot_wib = now_wib.replace(hour=slot_hour, minute=0, second=0, microsecond=0)
    return slot_wib - timedelta(hours=7)


def maybe_send_summary(ai_trade_data, bot_control, tick, now):
    global _summary_in_flight
    if _summary_in_flight:
        return  # masih ada kiriman summary sebelumnya yang belum kelar, jangan numpuk

    manual = bool(bot_control.get('summaryRequested'))
    last_at_str = bot_control.get('lastSummaryAt')
    due = True
    if last_at_str and not manual:
        try:
            last_at = datetime.fromisoformat(last_at_str)
            if last_at.tzinfo is None:
                last_at = last_at.replace(tzinfo=timezone.utc)
            due = last_at < _latest_scheduled_summary_utc(now, AI_SUMMARY_INTERVAL_HOURS)
        except Exception:
            due = True
    if not (manual or due):
        return

    _summary_in_flight = True
    trade_data_snapshot = copy.deepcopy(ai_trade_data)  # putus dari ai_trade_data asli - fast loop terus mutasi itu setelah ini return

    def _worker():
        global _summary_in_flight
        try:
            send_periodic_summary(trade_data_snapshot, tick)
            doc_ref.set({'botControl': {'summaryRequested': False, 'lastSummaryAt': datetime.now(timezone.utc).isoformat()}}, merge=True)
            log_ai_tick('summary', 'Summary terkirim' + (' (manual)' if manual else ' (terjadwal)'))
        except Exception as e:
            log(f"Gagal kirim/update status summary: {e}")
        finally:
            _summary_in_flight = False

    threading.Thread(target=_worker, daemon=True).start()


# ---------- State di memori, direfresh tiap loop dari Firestore ----------
_news_cache = {'checked_at': None, 'result': None}


def get_cached_news(now):
    if _news_cache['checked_at'] is None or (now - _news_cache['checked_at']) >= timedelta(seconds=SLOW_LOOP_SECONDS):
        _news_cache['result'] = fetch_active_high_impact_news()
        _news_cache['checked_at'] = now
    return _news_cache['result']


_kurs_cache = {'checked_at': None, 'result': 16000}


def get_cached_kurs(now):
    if _kurs_cache['checked_at'] is None or (now - _kurs_cache['checked_at']) >= timedelta(seconds=SLOW_LOOP_SECONDS):
        _kurs_cache['result'] = fetch_live_kurs_idr()
        _kurs_cache['checked_at'] = now
    return _kurs_cache['result']


AI_LIVE_PRICE_PUSH_EVERY_N_TICKS = 3  # push tampilan tiap ~30 detik (3 x FAST_LOOP_SECONDS) - eksekusi (SL/TP/dst) TETAP tiap tick, baca harga langsung dari MT5, gak kepengaruh throttle ini
_fast_tick_count = 0


def run_fast_tick():
    global _fast_tick_count
    now = datetime.now(timezone.utc)
    tick = mt5.symbol_info_tick(SYMBOL)
    if tick is None:
        log(f"Gagal ambil tick MT5: {mt5.last_error()}")
        return

    _fast_tick_count += 1
    if _fast_tick_count % AI_LIVE_PRICE_PUSH_EVERY_N_TICKS == 0:
        push_live_price_to_public(tick)

    snap = doc_ref.get()
    data = snap.to_dict() if snap.exists else {}
    ai_trade_data = data.get('aiTradeData', {})
    ai_modal_awal = data.get('aiModalAwal', 2500000)
    apply_ai_settings((data.get('aiSettings') or {}).get('master'))

    bot_control = data.get('botControl') or {}
    if bot_control.get('restartRequested'):
        handle_restart_request()
        return

    maybe_send_summary(ai_trade_data, bot_control, tick, now)

    live_kurs = get_cached_kurs(now)
    news_info = get_cached_news(now)

    # Method 1 & Method 2 masing2 punya slot sendiri (lihat METHOD_GROUPS) - diproses independen
    # supaya 1 metode gak nge-block cek SL/TP/deep-lock metode satunya.
    any_changed = False
    for group_name, signal_types in METHOD_GROUPS.items():
        open_info = find_open_ai_trade_for_group(ai_trade_data, signal_types)
        if not open_info:
            continue
        label = 'Metode 2 (ICT) ' if group_name == 'method2' else ''
        trade = open_info['trade']

        if news_info:
            changed = force_close_all_layers_at_market(trade, tick.bid, tick.ask, live_kurs, 'news_close', now)
            if changed:
                any_changed = True
                msg = f"Posisi {label}ditutup paksa: berita high-impact \"{news_info['title']}\"."
                log(msg)
                log_ai_tick('news_close', msg)
                send_telegram(f"📰 <b>Posisi Ditutup (Berita)</b>\n\n{msg}")
            continue

        result = check_and_close_position_tick(trade, tick.bid, tick.ask, live_kurs, now)
        if result['changed']:
            any_changed = True
            outcome = 'position_closed' if result['allResolved'] else 'position_updated'
            detail = ' '.join(result['notes']) or ('Trade selesai.' if result['allResolved'] else 'Ada layer yang resolve/lock.')
            log(label + detail)
            log_ai_tick(outcome, detail)
            header = '🔒 <b>Trade Selesai</b>' if result['allResolved'] else '📊 <b>Update Posisi</b>'
            notes_html = label + ('\n'.join(result['notes']) or detail)
            send_telegram(f"{header}\n\n{notes_html}")

    if any_changed:
        doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)


def run_slow_tick():
    now = datetime.now(timezone.utc)

    try:
        candles = fetch_candles(100)
        push_live_candles_to_public(candles)
    except Exception as e:
        log(f"Gagal ambil data candle: {e}")
        log_ai_tick('error', f"Gagal ambil data candle: {e}")
        send_telegram(f"⚠️ <b>Bot Error</b>\n\nGagal ambil data candle: {e}")
        return

    snap = doc_ref.get()
    data = snap.to_dict() if snap.exists else {}
    ai_trade_data = data.get('aiTradeData', {})
    ai_modal_awal = data.get('aiModalAwal', 2500000)
    news_info = get_cached_news(now)

    if not is_market_open(now):
        log("Market tutup (weekend), skip.")
        log_ai_tick('market_closed', 'Weekend, market tutup.')
        return

    # ---------- Method 1 (trend_following / rsi_reversal) - slot & logic sama seperti sebelumnya ----------
    open_m1 = find_open_ai_trade_for_group(ai_trade_data, METHOD_GROUPS['method1'])
    if open_m1:
        log("Metode 1: posisi masih open, belum ada perubahan (dicek ulang tiap fast loop).")
        log_ai_tick('waiting', 'Metode 1: posisi masih open, belum ada perubahan.')
    elif news_info:
        msg = f"Jam rawan berita high-impact \"{news_info['title']}\", entry Metode 1 ditahan."
        log(msg)
        log_ai_tick('news_block', msg)
    else:
        sug1 = compute_ai_suggestion(candles, ai_trade_data)
        opened1 = auto_open_ai_position(ai_trade_data, sug1)
        if opened1:
            doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)
            log_ai_tick('entry_opened', 'Entry Metode 1 berhasil dibuka.')
        else:
            log_ai_tick('no_signal', last_signal_skip_reason or 'Gak ada sinyal Metode 1 valid tick ini.')

    # ---------- Method 2 (ICT/SMC liquidity sweep) - slot terpisah, independen dari Method 1 ----------
    if not AI_METHOD_TWO_ENABLED:
        return
    open_m2 = find_open_ai_trade_for_group(ai_trade_data, METHOD_GROUPS['method2'])
    if open_m2:
        log_ai_tick('waiting_m2', 'Metode 2: posisi masih open, belum ada perubahan.')
        return

    ict_state = data.get('ictState') or dict(ICT_STATE_DEFAULT)
    new_state, ready_sug = run_ict_state_machine(ict_state, ai_trade_data)
    if new_state != ict_state:
        doc_ref.set({'ictState': new_state}, merge=True)

    if not ready_sug:
        return
    if news_info:
        log_ai_tick('news_block_m2', f"Sinyal Metode 2 ready tapi jam rawan berita, entry ditahan.")
        return

    opened2 = auto_open_ai_position(ai_trade_data, ready_sug)
    if opened2:
        doc_ref.set(
            {'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal, 'ictState': dict(ICT_STATE_DEFAULT)},
            merge=True,
        )
        log_ai_tick('entry_opened_m2', 'Entry Metode 2 (ICT) berhasil dibuka.')


def main():
    log("Bot Trading AI (VPS/MT5) mulai jalan...")
    last_slow_run = None
    while True:
        try:
            run_fast_tick()
        except Exception as e:
            log(f"Error di fast tick: {e}")

        now = datetime.now(timezone.utc)
        if last_slow_run is None or (now - last_slow_run) >= timedelta(seconds=SLOW_LOOP_SECONDS):
            try:
                run_slow_tick()
            except Exception as e:
                log(f"Error di slow tick: {e}")
            last_slow_run = now

        time.sleep(FAST_LOOP_SECONDS)


if __name__ == '__main__':
    try:
        main()
    finally:
        mt5.shutdown()
