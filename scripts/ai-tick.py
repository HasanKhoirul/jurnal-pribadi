# Bot Trading AI - versi VPS, jalan terus-menerus (bukan sekali-tick kayak ai-tick.mjs di GitHub Actions).
# Logic sinyal & manajemen posisi identik dengan ai-tick.mjs/script.js - bedanya sumber harga dari MT5
# lokal (bukan TwelveData), dan strateginya dipecah 2 loop:
#   - fast loop (tiap FAST_LOOP_SECONDS): cek SL/TP/pending-fill dari tick harga real-time, presisi tinggi
#   - slow loop (tiap SLOW_LOOP_SECONDS): hitung ulang indikator dari candle & cari sinyal entry baru
# Field & struktur data di Firestore (aiTradeData, layers, dst.) dijaga sama persis dengan versi JS,
# biar web app (script.js) tetap bisa baca/render tanpa perubahan.

import os
import time
import math
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

FAST_LOOP_SECONDS = 10
SLOW_LOOP_SECONDS = 300  # 5 menit

# ---------- Konstanta trading (harus identik ai-tick.mjs / FIRESTORE_SCHEMA.md) ----------
# Nilai di bawah ini cuma default awal - dibaca ulang & bisa di-override tiap tick lewat
# aiSettings.master di Firestore (diatur dari menu "Master Setting" web app), lewat apply_ai_settings().
AI_PIP_SIZE = 0.1
AI_MASTER_DEFAULTS = {
    'slPips': 50, 'tpLayerPips': [80, 100, 150], 'lotSize': 0.1, 'layerStaggerPips': 10,
    'lockPipsAfterTp1': 10, 'deepLockTriggerPips': 100, 'deepLockPips': 80, 'deepLockTimeoutMinutes': 15,
    'minSignalWinrate': 35, 'winrateLookbackDays': 14, 'winrateMinSamples': 5,
    'newsPreMinutes': 10, 'newsPostMinutes': 40,
}
AI_LOT_SIZE = AI_MASTER_DEFAULTS['lotSize']
AI_SL_PIPS = AI_MASTER_DEFAULTS['slPips']
AI_TP_LAYERS_PIPS = AI_MASTER_DEFAULTS['tpLayerPips']
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


def apply_ai_settings(master):
    global AI_LOT_SIZE, AI_SL_PIPS, AI_TP_LAYERS_PIPS, AI_LAYER_STAGGER_PIPS, AI_LOCK_PIPS_AFTER_TP1
    global AI_DEEP_LOCK_TRIGGER_PIPS, AI_DEEP_LOCK_PIPS, AI_DEEP_LOCK_TIMEOUT_MINUTES
    global AI_MIN_SIGNAL_WINRATE, AI_WINRATE_LOOKBACK_DAYS, AI_WINRATE_MIN_SAMPLES
    global AI_NEWS_PRE_MINUTES, AI_NEWS_POST_MINUTES
    master = master or {}
    tp_layers = master.get('tpLayerPips')
    if not (isinstance(tp_layers, list) and len(tp_layers) == 3 and all(isinstance(x, (int, float)) for x in tp_layers)):
        tp_layers = AI_MASTER_DEFAULTS['tpLayerPips']
    AI_LOT_SIZE = master.get('lotSize', AI_MASTER_DEFAULTS['lotSize'])
    AI_SL_PIPS = master.get('slPips', AI_MASTER_DEFAULTS['slPips'])
    AI_TP_LAYERS_PIPS = tp_layers
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
    return pips * (AI_LOT_SIZE / 0.1) * 1


def usc_to_rupiah(usc, kurs):
    return (usc / 100) * kurs


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


def fetch_candles(count=100):
    rates = mt5.copy_rates_from_pos(SYMBOL, AI_TIMEFRAME_MT5, 0, count)
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
    sl = entry - dir_sign * pip_to_price(AI_SL_PIPS)
    reason_parts.append(
        f"Entry {entry:.2f}, SL {AI_SL_PIPS} pips ({sl:.2f}), TP berlapis {'/'.join(map(str, AI_TP_LAYERS_PIPS))} pips, lot {AI_LOT_SIZE} x3 layer."
    )

    return {
        'arah': arah, 'entry': entry, 'sl': sl, 'dirSign': dir_sign,
        'reasonText': ' '.join(reason_parts), 'tf': AI_TIMEFRAME_LABEL, 'signalType': signal_type,
    }


def find_open_ai_trade(ai_trade_data):
    for date_key, trades in ai_trade_data.items():
        for i, t in enumerate(trades):
            if t.get('status') == 'open':
                return {'dateKey': date_key, 'index': i, 'trade': t}
    return None


def today_wib_date_str():
    now_wib = datetime.now(timezone.utc) + timedelta(hours=7)
    return now_wib.strftime('%Y-%m-%d')


def auto_open_ai_position(ai_trade_data, candles):
    sug = compute_ai_suggestion(candles, ai_trade_data)
    if not sug:
        return False
    date_str = today_wib_date_str()
    ai_trade_data.setdefault(date_str, [])
    layers = []
    for i, tp_pips in enumerate(AI_TP_LAYERS_PIPS):
        layer_entry = sug['entry'] - sug['dirSign'] * pip_to_price(i * AI_LAYER_STAGGER_PIPS)
        layers.append({
            'tpPips': tp_pips,
            'entry': layer_entry,
            'tp': layer_entry + sug['dirSign'] * pip_to_price(tp_pips),
            'sl': layer_entry - sug['dirSign'] * pip_to_price(AI_SL_PIPS),
            'lot': AI_LOT_SIZE,
            'status': 'open' if i == 0 else 'pending',
            'pl': 0,
            'slMoved': False,
        })
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
        f"<b>SL:</b> <code>{layers[0]['sl']:.2f}</code> ({AI_SL_PIPS} pips)\n\n"
        f"<b>TP1:</b> <code>{layers[0]['tp']:.2f}</code>\n"
        f"<b>TP2:</b> <code>{layers[1]['tp']:.2f}</code>\n"
        f"<b>TP3:</b> <code>{layers[2]['tp']:.2f}</code>\n\n"
        f"📝 <i>{sug['reasonText']}</i>"
    )
    return True


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
            pips_now = ((px - layer_entry) * dir_sign) / AI_PIP_SIZE
            if pips_now >= AI_DEEP_LOCK_TRIGGER_PIPS and not ly.get('deepLockAt'):
                ly['sl'] = layer_entry + dir_sign * pip_to_price(AI_DEEP_LOCK_PIPS)
                ly['slMoved'] = True
                ly['deepLockAt'] = now.isoformat()
                changed = True
                notes.append(f"Layer terakhir tembus {AI_DEEP_LOCK_TRIGGER_PIPS} pips, SL dikunci +{AI_DEEP_LOCK_PIPS} pips.")
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


def run_fast_tick():
    now = datetime.now(timezone.utc)
    tick = mt5.symbol_info_tick(SYMBOL)
    if tick is None:
        log(f"Gagal ambil tick MT5: {mt5.last_error()}")
        return

    push_live_price_to_public(tick)

    snap = doc_ref.get()
    data = snap.to_dict() if snap.exists else {}
    ai_trade_data = data.get('aiTradeData', {})
    ai_modal_awal = data.get('aiModalAwal', 2500000)
    apply_ai_settings((data.get('aiSettings') or {}).get('master'))

    open_info = find_open_ai_trade(ai_trade_data)
    if not open_info:
        return

    live_kurs = get_cached_kurs(now)
    news_info = get_cached_news(now)

    if news_info:
        changed = force_close_all_layers_at_market(open_info['trade'], tick.bid, tick.ask, live_kurs, 'news_close', now)
        if changed:
            doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)
            msg = f"Posisi ditutup paksa: berita high-impact \"{news_info['title']}\"."
            log(msg)
            log_ai_tick('news_close', msg)
            send_telegram(f"📰 <b>Posisi Ditutup (Berita)</b>\n\n{msg}")
        return

    result = check_and_close_position_tick(open_info['trade'], tick.bid, tick.ask, live_kurs, now)
    if result['changed']:
        doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)
        outcome = 'position_closed' if result['allResolved'] else 'position_updated'
        detail = ' '.join(result['notes']) or ('Trade selesai.' if result['allResolved'] else 'Ada layer yang resolve/lock.')
        log(detail)
        log_ai_tick(outcome, detail)
        header = '🔒 <b>Trade Selesai</b>' if result['allResolved'] else '📊 <b>Update Posisi</b>'
        notes_html = '\n'.join(result['notes']) or detail
        send_telegram(f"{header}\n\n{notes_html}")


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

    open_info = find_open_ai_trade(ai_trade_data)
    news_info = get_cached_news(now)

    if open_info:
        log("Posisi masih open, belum ada perubahan (dicek ulang tiap fast loop).")
        log_ai_tick('waiting', 'Posisi masih open, belum ada perubahan.')
        return

    if not is_market_open(now):
        log("Market tutup (weekend), skip.")
        log_ai_tick('market_closed', 'Weekend, market tutup.')
        return

    if news_info:
        msg = f"Jam rawan berita high-impact \"{news_info['title']}\", entry baru ditahan."
        log(msg)
        log_ai_tick('news_block', msg)
        return

    opened = auto_open_ai_position(ai_trade_data, candles)
    if opened:
        doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)
        log_ai_tick('entry_opened', 'Entry baru berhasil dibuka.')
    else:
        log_ai_tick('no_signal', last_signal_skip_reason or 'Gak ada sinyal valid tick ini.')


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
