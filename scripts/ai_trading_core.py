# Logic trading yang symbol-agnostic, dipakai bareng oleh ai-tick.py (Gold) & ai-tick-currency.py (pair lain).
# Setiap proses (1 Gold + N currency) adalah proses OS terpisah dengan interpreter Python sendiri-sendiri,
# jadi objek `cfg` di bawah ini AMAN dipakai sebagai state module-level - gak ada campur data antar-instrumen
# walau semuanya import modul yang sama, karena tiap proses punya copy memori sendiri.
#
# Host (ai-tick.py / ai-tick-currency.py) wajib:
#   1. Import `cfg` dari modul ini, isi field-nya (AI_PIP_SIZE, SYMBOL, dst) sebelum manggil fungsi apapun.
#   2. Isi cfg.log_fn / cfg.send_telegram_fn / cfg.log_ai_tick_fn dengan fungsi milik host sendiri (butuh
#      TELEGRAM_BOT_TOKEN/doc_ref yang beda tiap instrumen) - modul ini gak nyimpen kredensial apapun.
#   3. Import MetaTrader5 duluan & mt5.initialize() di host SEBELUM manggil fetch_candles() dari sini.

import math
from datetime import datetime, timezone, timedelta

import MetaTrader5 as mt5
import requests


class Config:
    def __init__(self):
        self.SYMBOL = None          # nama simbol MT5 yang udah di-resolve host, wajib diisi sebelum fetch_candles()
        self.SYMBOL_LABEL = 'XAUUSD'  # buat teks pesan Telegram
        self.PRICE_DECIMALS = 2     # jumlah desimal buat nampilin harga di teks/Telegram - beda per instrumen (Gold=2, JPY pair=3, forex non-JPY=5)
        self.TIMEFRAME_MT5 = mt5.TIMEFRAME_H1
        self.TIMEFRAME_LABEL = '1h'
        self.ICT_HTF_MT5 = mt5.TIMEFRAME_H4
        self.ICT_LTF_MT5 = mt5.TIMEFRAME_M15

        # ---------- Di-override tiap tick lewat apply_master_settings() ----------
        self.AI_PIP_SIZE = 0.1
        self.AI_LOT_SIZE = 0.1
        self.AI_SL_PIPS = 50
        self.AI_SL_MODE = 'fixed'
        self.AI_ATR_MULTIPLIER = 1.5
        # Batas clamp SL adaptif ATR (pips) - BUKAN dari Master Setting, di-set host per-instrumen sekali di
        # awal (beda skala Gold vs currency, ATR pip-count Gold jauh lebih gede dari forex major biasa).
        self.ATR_SL_MIN_PIPS = 30
        self.ATR_SL_MAX_PIPS = 120
        self.AI_TP_LAYERS_PIPS = [80, 100, 150]
        self.AI_TP_MODE = 'fixed'
        self.AI_PIP_VALUE_UNIT = 'cent'
        self.AI_PIP_VALUE_PER_LOT = 1
        self.AI_LAYER_STAGGER_PIPS = 10
        self.AI_LOCK_PIPS_AFTER_TP1 = 10
        self.AI_DEEP_LOCK_TRIGGER_PIPS = 100
        self.AI_DEEP_LOCK_PIPS = 80
        self.AI_DEEP_LOCK_TIMEOUT_MINUTES = 15
        self.AI_MIN_SIGNAL_WINRATE = 35
        self.AI_WINRATE_LOOKBACK_DAYS = 14
        self.AI_WINRATE_MIN_SAMPLES = 5
        self.AI_NEWS_PRE_MINUTES = 10
        self.AI_NEWS_POST_MINUTES = 40
        self.AI_METHOD_TWO_ENABLED = False

        # Metode 2 (ICT) - asumsi v1, sama utk semua instrumen (lihat plan Metode 2 buat rasionalnya)
        self.AI_ICT_SWING_LOOKBACK = 2
        self.AI_ICT_CHOCH_TIMEOUT_HOURS = 24
        self.AI_ICT_DISPLACEMENT_MIN_BODY_RATIO = 0.7
        self.AI_ICT_SL_BUFFER_PIPS = 20

        self.last_signal_skip_reason = None

        # ---------- Hooks yang WAJIB disuntik host (beda kredensial/doc_ref tiap instrumen) ----------
        self.log_fn = print
        self.send_telegram_fn = lambda text: None
        self.log_ai_tick_fn = lambda outcome, detail='': None


cfg = Config()

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


def apply_master_settings(master):
    # Sama isinya kayak apply_ai_settings() versi lama - bedanya nulis ke cfg (shared module-level state
    # per-proses), bukan `global` di file host. Dipanggil host tiap fast tick, sama persis pola sebelumnya.
    master = master or {}
    tp_layers = master.get('tpLayerPips')
    if not (isinstance(tp_layers, list) and len(tp_layers) == 3 and all(isinstance(x, (int, float)) for x in tp_layers)):
        tp_layers = AI_MASTER_DEFAULTS['tpLayerPips']
    cfg.AI_LOT_SIZE = master.get('lotSize', AI_MASTER_DEFAULTS['lotSize'])
    cfg.AI_SL_PIPS = master.get('slPips', AI_MASTER_DEFAULTS['slPips'])
    cfg.AI_SL_MODE = 'atr' if master.get('slMode') == 'atr' else 'fixed'
    cfg.AI_ATR_MULTIPLIER = master.get('atrMultiplier', AI_MASTER_DEFAULTS['atrMultiplier'])
    cfg.AI_TP_LAYERS_PIPS = tp_layers
    cfg.AI_TP_MODE = 'adaptive' if master.get('tpMode') == 'adaptive' else 'fixed'
    cfg.AI_PIP_VALUE_UNIT = 'usd' if master.get('pipValueUnit') == 'usd' else 'cent'
    cfg.AI_PIP_VALUE_PER_LOT = master.get('pipValuePerLot', AI_MASTER_DEFAULTS['pipValuePerLot'])
    cfg.AI_LAYER_STAGGER_PIPS = master.get('layerStaggerPips', AI_MASTER_DEFAULTS['layerStaggerPips'])
    cfg.AI_LOCK_PIPS_AFTER_TP1 = master.get('lockPipsAfterTp1', AI_MASTER_DEFAULTS['lockPipsAfterTp1'])
    cfg.AI_DEEP_LOCK_TRIGGER_PIPS = master.get('deepLockTriggerPips', AI_MASTER_DEFAULTS['deepLockTriggerPips'])
    cfg.AI_DEEP_LOCK_PIPS = master.get('deepLockPips', AI_MASTER_DEFAULTS['deepLockPips'])
    cfg.AI_DEEP_LOCK_TIMEOUT_MINUTES = master.get('deepLockTimeoutMinutes', AI_MASTER_DEFAULTS['deepLockTimeoutMinutes'])
    cfg.AI_MIN_SIGNAL_WINRATE = master.get('minSignalWinrate', AI_MASTER_DEFAULTS['minSignalWinrate'])
    cfg.AI_WINRATE_LOOKBACK_DAYS = master.get('winrateLookbackDays', AI_MASTER_DEFAULTS['winrateLookbackDays'])
    cfg.AI_WINRATE_MIN_SAMPLES = master.get('winrateMinSamples', AI_MASTER_DEFAULTS['winrateMinSamples'])
    cfg.AI_NEWS_PRE_MINUTES = master.get('newsPreMinutes', AI_MASTER_DEFAULTS['newsPreMinutes'])
    cfg.AI_NEWS_POST_MINUTES = master.get('newsPostMinutes', AI_MASTER_DEFAULTS['newsPostMinutes'])
    cfg.AI_METHOD_TWO_ENABLED = bool(master.get('methodTwoEnabled', AI_MASTER_DEFAULTS['methodTwoEnabled']))


# ---------- Helper angka & indikator (pure, gak butuh cfg) ----------
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
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        for e in events:
            if e.get('impact') != 'High' or e.get('country') != 'USD':
                continue
            t = datetime.fromisoformat(e['date'].replace('Z', '+00:00')).timestamp() * 1000
            if now_ms >= t - cfg.AI_NEWS_PRE_MINUTES * 60000 and now_ms <= t + cfg.AI_NEWS_POST_MINUTES * 60000:
                return {'title': e['title'], 'time': e['date']}
        return None
    except Exception as e:
        cfg.log_fn(f"Gagal ambil kalender berita, fallback ke perkiraan jam kasar: {e}")
        now = datetime.now(timezone.utc)
        return {'title': '(perkiraan, kalender gagal diambil)', 'time': None} if is_high_impact_news_window_fallback(now) else None


def fetch_live_kurs_idr():
    try:
        res = requests.get('https://api.exchangerate-api.com/v4/latest/USD', timeout=10)
        return res.json().get('rates', {}).get('IDR', 16000)
    except Exception as e:
        cfg.log_fn(f"Gagal ambil kurs, pakai fallback 16000: {e}")
        return 16000


def fetch_candles(count=100, timeframe=None):
    tf = timeframe if timeframe is not None else cfg.TIMEFRAME_MT5
    rates = mt5.copy_rates_from_pos(cfg.SYMBOL, tf, 0, count)
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


def pip_to_price(pips):
    return pips * cfg.AI_PIP_SIZE


def calc_layer_pl_usc(pips):
    return pips * (cfg.AI_LOT_SIZE / 0.1) * cfg.AI_PIP_VALUE_PER_LOT


# Nama fungsi dipertahankan "usc" apa adanya (dipanggil di banyak tempat) - unit-aware lewat AI_PIP_VALUE_UNIT.
def usc_to_rupiah(usc, kurs):
    usd = usc if cfg.AI_PIP_VALUE_UNIT == 'usd' else usc / 100
    return usd * kurs


# Ganti semua `f"{harga:.2f}"` hardcode (yang cuma pas buat Gold) - jumlah desimal ikut cfg.PRICE_DECIMALS,
# beda per instrumen (Gold=2, JPY pair=3, forex non-JPY=5) biar entry/SL/TP di teks & Telegram gak kepotong.
def fmt_price(value):
    return f"{value:.{cfg.PRICE_DECIMALS}f}"


# ---------- Win-rate adaptif & sinyal Metode 1 ----------
def get_recent_signal_winrate(trade_data, signal_type):
    cutoff = datetime.now(timezone.utc) - timedelta(days=cfg.AI_WINRATE_LOOKBACK_DAYS)
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
    return (win / total) * 100 if total >= cfg.AI_WINRATE_MIN_SAMPLES else None


def compute_ai_suggestion(candles, trade_data):
    closes = [c['close'] for c in candles]
    last_close = closes[-1]
    ma20 = calc_sma(closes, 20)
    ma50 = calc_sma(closes, 50)
    rsi = calc_rsi(closes, 14)
    if ma20 is None or ma50 is None or rsi is None:
        cfg.last_signal_skip_reason = 'Data candle belum cukup buat hitung indikator.'
        return None

    trend = 'uptrend' if ma20 > ma50 else 'downtrend'
    reason_parts = [
        f"Harga saat ini {fmt_price(last_close)}.",
        f"MA20 ({fmt_price(ma20)}) {'di atas' if ma20 > ma50 else 'di bawah'} MA50 ({fmt_price(ma50)}) -> {trend}.",
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
    if recent_wr is not None and recent_wr < cfg.AI_MIN_SIGNAL_WINRATE:
        cfg.last_signal_skip_reason = (
            f"Win rate {signal_type} {recent_wr:.0f}% dalam {cfg.AI_WINRATE_LOOKBACK_DAYS} hari terakhir "
            f"(di bawah ambang {cfg.AI_MIN_SIGNAL_WINRATE}%)."
        )
        return None

    macd = calc_macd(closes)
    if macd:
        macd_bullish = macd['macd'] > macd['signal']
        reason_parts.append(f"MACD {'bullish' if macd_bullish else 'bearish'} ({fmt_price(macd['macd'])} vs signal {fmt_price(macd['signal'])}).")
        if (arah == 'BUY' and not macd_bullish) or (arah == 'SELL' and macd_bullish):
            cfg.last_signal_skip_reason = (
                f"MACD gak konfirmasi arah {arah} (trend/RSI nunjuk {arah}, tapi MACD {'bullish' if macd_bullish else 'bearish'})."
            )
            return None

    bb = calc_bollinger(closes, 20, 2)
    if bb:
        reason_parts.append(f"Bollinger Band: harga {fmt_price(last_close)} (upper {fmt_price(bb['upper'])}, lower {fmt_price(bb['lower'])}).")

    dir_sign = 1 if arah == 'BUY' else -1
    entry = last_close
    sl_pips_used = cfg.AI_SL_PIPS
    if cfg.AI_SL_MODE == 'atr':
        atr = calc_atr(candles, 14)
        if atr is not None:
            sl_pips_used = min(cfg.ATR_SL_MAX_PIPS, max(cfg.ATR_SL_MIN_PIPS, round((atr / cfg.AI_PIP_SIZE) * cfg.AI_ATR_MULTIPLIER)))
    sl = entry - dir_sign * pip_to_price(sl_pips_used)

    tp_pips_used = list(cfg.AI_TP_LAYERS_PIPS)
    deep_lock_trigger_used = cfg.AI_DEEP_LOCK_TRIGGER_PIPS
    deep_lock_pips_used = cfg.AI_DEEP_LOCK_PIPS
    if cfg.AI_TP_MODE == 'adaptive' and cfg.AI_SL_PIPS > 0:
        tp_pips_used = [round(sl_pips_used * (tp / cfg.AI_SL_PIPS)) for tp in cfg.AI_TP_LAYERS_PIPS]
        deep_lock_trigger_used = round(sl_pips_used * (cfg.AI_DEEP_LOCK_TRIGGER_PIPS / cfg.AI_SL_PIPS))
        deep_lock_pips_used = round(sl_pips_used * (cfg.AI_DEEP_LOCK_PIPS / cfg.AI_SL_PIPS))

    reason_parts.append(
        f"Entry {fmt_price(entry)}, SL {sl_pips_used} pips{' (adaptif ATR)' if cfg.AI_SL_MODE == 'atr' else ''} ({fmt_price(sl)}), "
        f"TP berlapis {'/'.join(map(str, tp_pips_used))} pips{' (adaptif)' if cfg.AI_TP_MODE == 'adaptive' else ''}, lot {cfg.AI_LOT_SIZE} x3 layer."
    )

    return {
        'arah': arah, 'entry': entry, 'sl': sl, 'dirSign': dir_sign,
        'reasonText': ' '.join(reason_parts), 'tf': cfg.TIMEFRAME_LABEL, 'signalType': signal_type,
        'slPipsUsed': sl_pips_used, 'tpPipsUsed': tp_pips_used,
        'deepLockTriggerPipsUsed': deep_lock_trigger_used, 'deepLockPipsUsed': deep_lock_pips_used,
    }


# Method 1 (trend_following/rsi_reversal) & Method 2 (ICT) masing2 punya slot posisi terbuka SENDIRI -
# supaya gak rebutan/starve satu sama lain saat mau dibandingin performanya.
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
        layer_entry = sug['entry'] - sug['dirSign'] * pip_to_price(i * cfg.AI_LAYER_STAGGER_PIPS)
        layer = {
            'tpPips': tp_pips,
            'entry': layer_entry,
            'tp': layer_entry + sug['dirSign'] * pip_to_price(tp_pips),
            'sl': layer_entry - sug['dirSign'] * pip_to_price(sug['slPipsUsed']),
            'lot': cfg.AI_LOT_SIZE,
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
    cfg.log_fn(f"Entry baru dibuka: {sug['arah']} @ {fmt_price(sug['entry'])} "
               f"(layer2/3 pending di {fmt_price(layers[1]['entry'])} / {fmt_price(layers[2]['entry'])}).")
    method_tag = ' (Metode 2/ICT)' if sug['signalType'] == 'ict_liquidity_sweep' else ''
    cfg.send_telegram_fn(
        f"🟢 <b>SINYAL {sug['arah']} {cfg.SYMBOL_LABEL}{method_tag}</b>\n\n"
        f"<b>Entry:</b> <code>{fmt_price(sug['entry'])}</code>\n"
        f"<b>SL:</b> <code>{fmt_price(layers[0]['sl'])}</code> ({sug['slPipsUsed']} pips)\n\n"
        f"<b>TP1:</b> <code>{fmt_price(layers[0]['tp'])}</code>\n"
        f"<b>TP2:</b> <code>{fmt_price(layers[1]['tp'])}</code>\n"
        f"<b>TP3:</b> <code>{fmt_price(layers[2]['tp'])}</code>\n\n"
        f"📝 <i>{sug['reasonText']}</i>"
    )
    return True


# ---------- Metode 2: ICT/SMC Liquidity Sweep ----------
# State-machine 3 langkah, persisten lewat Firestore field `ictState` (survive restart & antar-tick):
#   idle -> (sweep H4 kedeteksi) -> awaiting_choch -> (CHoCH M15 confirmed) -> ready -> (dibuka) -> idle
ICT_STATE_DEFAULT = {
    'phase': 'idle', 'direction': None, 'sweepAt': None, 'sweepLevel': None,
    'sweptHtfCandleTime': None, 'readyEntry': None, 'readySl': None,
    'readyTpPipsUsed': None, 'readyAlasan': None,
}


def _find_swings(candles, lookback):
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
    if len(htf_candles) < cfg.AI_ICT_SWING_LOOKBACK * 2 + 3:
        return None
    prior, last = htf_candles[:-1], htf_candles[-1]
    highs, lows = _find_swings(prior, cfg.AI_ICT_SWING_LOOKBACK)
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
    if len(post_sweep) < cfg.AI_ICT_SWING_LOOKBACK * 2 + 3:
        return None

    direction = ict_state.get('direction')
    highs, lows = _find_swings(post_sweep, cfg.AI_ICT_SWING_LOOKBACK)

    if direction == 'SELL' and lows:
        idx, level = lows[-1]
        for c in post_sweep[idx + 1:]:
            if c['close'] < level:
                if _body_to_wick_ratio(c) >= cfg.AI_ICT_DISPLACEMENT_MIN_BODY_RATIO:
                    return {'chochCandle': c, 'chochLevel': level}
                return None  # structure break tanpa displacement cukup - bukan CHoCH valid, tunggu sweep baru
    elif direction == 'BUY' and highs:
        idx, level = highs[-1]
        for c in post_sweep[idx + 1:]:
            if c['close'] > level:
                if _body_to_wick_ratio(c) >= cfg.AI_ICT_DISPLACEMENT_MIN_BODY_RATIO:
                    return {'chochCandle': c, 'chochLevel': level}
                return None
    return None


def build_ict_ready_suggestion(ltf_candles, choch, ict_state):
    direction = ict_state['direction']
    dir_sign = 1 if direction == 'BUY' else -1
    choch_candle = choch['chochCandle']
    choch_idx = next((i for i, c in enumerate(ltf_candles) if c['time'] == choch_candle['time']), None)
    if choch_idx is None:
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
    sl = ict_state['sweepLevel'] - dir_sign * pip_to_price(cfg.AI_ICT_SL_BUFFER_PIPS)
    sl_pips_used = abs((entry - sl) / cfg.AI_PIP_SIZE)
    if sl_pips_used <= 0:
        return None

    tp_pips_used = (
        [round(sl_pips_used * (tp / cfg.AI_SL_PIPS)) for tp in cfg.AI_TP_LAYERS_PIPS]
        if cfg.AI_SL_PIPS > 0 else list(cfg.AI_TP_LAYERS_PIPS)
    )
    reason = (
        f"[Metode 2 - ICT] Sweep {direction} @ {fmt_price(ict_state['sweepLevel'])}, CHoCH M15 confirmed, "
        f"entry OB midpoint {fmt_price(entry)}, SL {sl_pips_used:.0f} pips."
    )
    return {
        'arah': direction, 'entry': entry, 'sl': sl, 'dirSign': dir_sign,
        'reasonText': reason, 'tf': 'M15', 'signalType': 'ict_liquidity_sweep',
        'slPipsUsed': round(sl_pips_used), 'tpPipsUsed': tp_pips_used,
        'deepLockTriggerPipsUsed': cfg.AI_DEEP_LOCK_TRIGGER_PIPS, 'deepLockPipsUsed': cfg.AI_DEEP_LOCK_PIPS,
    }


def run_ict_state_machine(ict_state, ai_trade_data):
    # Return (new_ict_state, ready_sug_or_None). Dipanggil tiap slow tick kalau AI_METHOD_TWO_ENABLED &
    # slot method2 kosong. Progres state machine (deteksi sweep/CHoCH) tetap jalan lepas dari kondisi
    # market/news - itu cuma analisa struktur harga historis, bukan aksi eksekusi.
    state = dict(ICT_STATE_DEFAULT, **(ict_state or {}))
    try:
        if state['phase'] == 'idle':
            htf_candles = fetch_candles(60, cfg.ICT_HTF_MT5)
            sweep = detect_htf_sweep(htf_candles)
            if sweep and sweep['candleTime'] != state.get('sweptHtfCandleTime'):
                state.update({
                    'phase': 'awaiting_choch', 'direction': sweep['direction'],
                    'sweepLevel': sweep['sweepLevel'], 'sweepAt': datetime.now(timezone.utc).isoformat(),
                    'sweptHtfCandleTime': sweep['candleTime'],
                })
                cfg.log_ai_tick_fn('ict_sweep', f"Metode 2: sweep {sweep['direction']} @ {fmt_price(sweep['sweepLevel'])} kedeteksi (H4), nunggu CHoCH M15.")
            return state, None

        if state['phase'] == 'awaiting_choch':
            sweep_at = datetime.fromisoformat(state['sweepAt'])
            if datetime.now(timezone.utc) - sweep_at > timedelta(hours=cfg.AI_ICT_CHOCH_TIMEOUT_HOURS):
                cfg.log_ai_tick_fn('ict_timeout', f"Metode 2: sweep {state['direction']} @ {fmt_price(state['sweepLevel'])} basi, gak ada CHoCH dlm {cfg.AI_ICT_CHOCH_TIMEOUT_HOURS} jam, reset.")
                return dict(ICT_STATE_DEFAULT), None

            ltf_candles = fetch_candles(120, cfg.ICT_LTF_MT5)
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
            cfg.log_ai_tick_fn('ict_ready', sug['reasonText'])
            return state, None

        if state['phase'] == 'ready':
            wr = get_recent_signal_winrate(ai_trade_data, 'ict_liquidity_sweep')
            if wr is not None and wr < cfg.AI_MIN_SIGNAL_WINRATE:
                return state, None  # winrate lg rendah, tahan buka - state 'ready' tetap disimpan, dicoba lagi tick berikutnya
            direction = state['direction']
            sug = {
                'arah': direction, 'entry': state['readyEntry'], 'sl': state['readySl'],
                'dirSign': 1 if direction == 'BUY' else -1,
                'reasonText': state['readyAlasan'], 'tf': 'M15', 'signalType': 'ict_liquidity_sweep',
                'slPipsUsed': round(abs((state['readyEntry'] - state['readySl']) / cfg.AI_PIP_SIZE)),
                'tpPipsUsed': state['readyTpPipsUsed'],
                'deepLockTriggerPipsUsed': cfg.AI_DEEP_LOCK_TRIGGER_PIPS, 'deepLockPipsUsed': cfg.AI_DEEP_LOCK_PIPS,
            }
            return state, sug
    except RuntimeError as e:
        # fetch_candles() lempar RuntimeError spesifik buat kegagalan MT5 (misal disconnect sesaat) -
        # itu transient, JANGAN reset progres sweep/CHoCH yang udah kesimpan - skip tick ini, coba lagi
        # tick berikutnya dengan state yang sama persis.
        cfg.log_fn(f"Metode 2 (ICT) gagal ambil candle MT5 (transient), state dipertahankan: {e}")
        return state, None
    except Exception as e:
        # Error lain di luar dugaan (bukan soal koneksi MT5) - state-nya sendiri berpotensi udah gak
        # konsisten, lebih aman reset ke idle daripada lanjutin dengan data yang gak jelas benar/enggak.
        cfg.log_fn(f"Metode 2 (ICT) state machine error, reset ke idle: {e}")
        return dict(ICT_STATE_DEFAULT), None
    return state, None


# ---------- Manajemen posisi (generic per-trade, gak peduli signalType/instrumen) ----------
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
                notes.append(f"Layer {idx + 1} pending kefill di {fmt_price(ly['entry'])}.")

        if ly['status'] != 'open':
            continue
        layer_entry = ly.get('entry', trade['entry'])
        sl_price = ly.get('sl', trade['sl'])
        px = exit_price_for(trade['arah'], bid, ask)

        sl_hit = px <= sl_price if trade['arah'] == 'BUY' else px >= sl_price
        if sl_hit:
            pips_at_sl = ((sl_price - layer_entry) * dir_sign) / cfg.AI_PIP_SIZE
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
                        l['sl'] = l['entry'] + dir_sign * pip_to_price(cfg.AI_LOCK_PIPS_AFTER_TP1)
                        l['slMoved'] = True
                cancel_pending_siblings(trade)
                notes.append(f"Layer 2 & 3 dikunci +{cfg.AI_LOCK_PIPS_AFTER_TP1} pips, sisa pending dibatalkan.")
            continue

        if idx == len(layers) - 1:
            # Baca dari layer itu sendiri dulu (dibekukan pas entry, biar konsisten sama kondisi ATR waktu trade dibuka) - fallback ke konstanta global buat trade lama sebelum fitur TP Adaptif ada.
            trigger = ly.get('deepLockTriggerPips', cfg.AI_DEEP_LOCK_TRIGGER_PIPS)
            lock_pips = ly.get('deepLockPips', cfg.AI_DEEP_LOCK_PIPS)
            pips_now = ((px - layer_entry) * dir_sign) / cfg.AI_PIP_SIZE
            if pips_now >= trigger and not ly.get('deepLockAt'):
                ly['sl'] = layer_entry + dir_sign * pip_to_price(lock_pips)
                ly['slMoved'] = True
                ly['deepLockAt'] = now.isoformat()
                changed = True
                notes.append(f"Layer terakhir tembus {trigger} pips, SL dikunci +{lock_pips} pips.")
            if ly.get('deepLockAt'):
                elapsed_min = (now - datetime.fromisoformat(ly['deepLockAt'])).total_seconds() / 60
                if elapsed_min >= cfg.AI_DEEP_LOCK_TIMEOUT_MINUTES:
                    pips_at_close = ((px - layer_entry) * dir_sign) / cfg.AI_PIP_SIZE
                    ly['status'] = 'timeout_lock'
                    ly['pl'] = usc_to_rupiah(calc_layer_pl_usc(pips_at_close), live_kurs)
                    changed = True
                    notes.append(f"Layer terakhir timeout {cfg.AI_DEEP_LOCK_TIMEOUT_MINUTES} menit setelah lock, ditutup ({pips_at_close:.1f} pips).")

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
            pips_moved = ((px - layer_entry) * dir_sign) / cfg.AI_PIP_SIZE
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
        pips_moved = ((px - layer_entry) * dir_sign) / cfg.AI_PIP_SIZE
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
