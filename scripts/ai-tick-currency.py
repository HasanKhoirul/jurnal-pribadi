# Bot Trading AI Currency - versi VPS, parameterized per pair, dijalankan 1x per pair sbg proses OS terpisah:
#   py -3.10 ai-tick-currency.py USDJPY
#   py -3.10 ai-tick-currency.py GBPUSD
#   ...dst, 1 terminal per pair.
#
# Struktur & logic identik ai-tick.py (Gold) - reuse penuh dari ai_trading_core.py, cuma beda:
#   - symbol/pip size di-resolve dari CURRENCY_INSTRUMENTS sesuai argumen command line
#   - baca/tulis Firestore nempel di currencyInstruments.<PAIR>.* (BUKAN root aiTradeData/aiSettings/dst
#     yang dipakai Gold), biar data 2 instrumen gak ketimpa satu sama lain
#   - live price/candle dipush ke appData/public pakai field name ber-suffix _<PAIR>, biar gak collide
#     sama punya Gold (aiLiveCandlesMt5/aiLivePriceMt5)

import os
import sys
import time
import subprocess
import threading
import copy
from datetime import datetime, timezone, timedelta

import requests
import MetaTrader5 as mt5
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

from ai_trading_core import (
    cfg, AI_MASTER_DEFAULTS, apply_master_settings, fmt_price,
    fetch_candles, get_today_pl, get_current_week_pl, get_all_time_pl, format_rupiah,
    find_open_ai_trade_for_group, METHOD_GROUPS, signal_type_label, compute_ai_suggestion, auto_open_ai_position,
    check_and_close_position_tick, force_close_all_layers_at_market, run_ict_state_machine,
    ICT_STATE_DEFAULT, exit_price_for, calc_layer_pl_usc, usc_to_rupiah,
    fetch_active_high_impact_news, fetch_live_kurs_idr, is_market_open,
)

load_dotenv()

# Daftar pair currency yang didukung + config-nya. Symbol candidates ini TENTATIF - cek nama PERSIS
# di MT5 Market Watch VPS (klik kanan -> Symbols) sebelum jalanin, update di sini kalau beda.
# priceDecimals: konvensi forex standar (3 desimal buat JPY pair, 5 buat non-JPY).
# atrSlMin/MaxPips: batas clamp SL adaptif ATR - asumsi awal buat forex major (beda skala dari Gold
# yang ATR-nya jauh lebih gede), tuning-in lagi kalau observed ATR ternyata sering mentok clamp ini.
CURRENCY_INSTRUMENTS = {
    'USDJPY': {'pipSize': 0.01, 'priceDecimals': 3, 'atrSlMinPips': 10, 'atrSlMaxPips': 60, 'symbolCandidates': ['USDJPY', 'USDJPYm', 'USDJPYc']},
    'GBPUSD': {'pipSize': 0.0001, 'priceDecimals': 5, 'atrSlMinPips': 10, 'atrSlMaxPips': 60, 'symbolCandidates': ['GBPUSD', 'GBPUSDm', 'GBPUSDc']},
    'AUDUSD': {'pipSize': 0.0001, 'priceDecimals': 5, 'atrSlMinPips': 10, 'atrSlMaxPips': 60, 'symbolCandidates': ['AUDUSD', 'AUDUSDm', 'AUDUSDc']},
    'EURUSD': {'pipSize': 0.0001, 'priceDecimals': 5, 'atrSlMinPips': 10, 'atrSlMaxPips': 60, 'symbolCandidates': ['EURUSD', 'EURUSDm', 'EURUSDc']},
    'USDCAD': {'pipSize': 0.0001, 'priceDecimals': 5, 'atrSlMinPips': 10, 'atrSlMaxPips': 60, 'symbolCandidates': ['USDCAD', 'USDCADm', 'USDCADc']},
}

if len(sys.argv) < 2 or sys.argv[1] not in CURRENCY_INSTRUMENTS:
    print(f"Pakai: py -3.10 ai-tick-currency.py <PAIR>. Pair tersedia: {', '.join(CURRENCY_INSTRUMENTS)}")
    sys.exit(1)

PAIR = sys.argv[1]
PAIR_CFG = CURRENCY_INSTRUMENTS[PAIR]
FIELD_PREFIX = 'currencyInstruments'  # doc_ref.set({FIELD_PREFIX: {PAIR: {...}}}, merge=True) buat semua tulis
# Urutan sesuai dropdown web (USDJPY/GBPUSD/AUDUSD/EURUSD/USDCAD) - dipakai buat nge-stagger jadwal
# kirim summary Telegram tiap pair (lihat maybe_send_summary), biar 5 proses independen ini gak ngirim
# bareng & kecampur urutannya di 1 chat.
PAIR_INDEX = list(CURRENCY_INSTRUMENTS.keys()).index(PAIR)
SUMMARY_STAGGER_SECONDS = 30

FIREBASE_SERVICE_ACCOUNT_PATH = os.environ['FIREBASE_SERVICE_ACCOUNT_PATH']
AI_TARGET_UID = os.environ['AI_TARGET_UID']
# Bot/chat Telegram TERPISAH dari Gold (biar notifikasi 5 pair gak numpuk campur di 1 chat) - fallback ke
# punya Gold kalau TELEGRAM_BOT_TOKEN_CURRENCY/TELEGRAM_CHAT_ID_CURRENCY belum diisi di .env, biar proses
# gak crash duluan sebelum sempat diisi.
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN_CURRENCY') or os.environ['TELEGRAM_BOT_TOKEN']
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID_CURRENCY') or os.environ['TELEGRAM_CHAT_ID']
MT5_LOGIN = int(os.environ['MT5_LOGIN'])
MT5_PASSWORD = os.environ['MT5_PASSWORD']
MT5_SERVER = os.environ['MT5_SERVER']
MT5_TERMINAL_PATH = os.environ.get('MT5_TERMINAL_PATH', '')

FAST_LOOP_SECONDS = 10
SLOW_LOOP_SECONDS = 300  # 5 menit

AI_SUMMARY_INTERVAL_HOURS = AI_MASTER_DEFAULTS['summaryIntervalHours']


def apply_ai_settings(master):
    global AI_SUMMARY_INTERVAL_HOURS
    apply_master_settings(master)
    AI_SUMMARY_INTERVAL_HOURS = (master or {}).get('summaryIntervalHours', AI_MASTER_DEFAULTS['summaryIntervalHours'])


def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] [{PAIR}] {msg}", flush=True)


# ---------- Setup MT5 ----------
def resolve_symbol():
    for name in PAIR_CFG['symbolCandidates']:
        info = mt5.symbol_info(name)
        if info is not None:
            if not info.visible:
                mt5.symbol_select(name, True)
            return name
    raise RuntimeError(
        f"Gak ketemu simbol {PAIR} di Market Watch. Cek nama persis simbolnya di MT5 "
        f"(klik kanan Market Watch -> Symbols, cari '{PAIR}'), lalu tambahin ke "
        f"CURRENCY_INSTRUMENTS['{PAIR}']['symbolCandidates'] di file ini."
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


def instrument_fields(fields):
    # Bungkus field yg mau ditulis biar nempel ke currencyInstruments.<PAIR>.* doang, gak nyentuh
    # data Gold atau pair currency lain. merge=True Firestore ngelakuin deep-merge nested dict,
    # jadi sibling field (pair lain, atau field lain di dalam PAIR ini) aman gak ke-wipe.
    return {FIELD_PREFIX: {PAIR: fields}}


def get_instrument_data(doc_data):
    return ((doc_data.get(FIELD_PREFIX) or {}).get(PAIR)) or {}


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


def log_ai_tick(outcome, detail=''):
    try:
        doc_ref.collection('ai_tick_log').add({
            'time': datetime.now(timezone.utc).isoformat(),
            'outcome': outcome,
            'detail': detail,
            'source': f'server_{PAIR}',
        })
    except Exception as e:
        log(f"Gagal simpan log tick: {e}")


# ---------- Wiring cfg buat ai_trading_core.py (harus sebelum fungsi core manapun dipanggil) ----------
cfg.SYMBOL = SYMBOL
cfg.SYMBOL_LABEL = PAIR
cfg.AI_PIP_SIZE = PAIR_CFG['pipSize']  # beda dari Gold (0.1) - apply_master_settings() gak pernah nyentuh field ini
cfg.PRICE_DECIMALS = PAIR_CFG['priceDecimals']
cfg.ATR_SL_MIN_PIPS = PAIR_CFG['atrSlMinPips']
cfg.ATR_SL_MAX_PIPS = PAIR_CFG['atrSlMaxPips']
cfg.TIMEFRAME_MT5 = mt5.TIMEFRAME_H1
cfg.TIMEFRAME_LABEL = '1h'
cfg.ICT_HTF_MT5 = mt5.TIMEFRAME_H4
cfg.ICT_LTF_MT5 = mt5.TIMEFRAME_M15
cfg.log_fn = log
cfg.send_telegram_fn = send_telegram
cfg.log_ai_tick_fn = log_ai_tick


def push_live_candles_to_public(candles):
    try:
        public_doc_ref.set({
            f'aiLiveCandlesMt5_{PAIR}': candles,
            f'aiLiveCandlesMt5UpdatedAt_{PAIR}': datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception as e:
        log(f"Gagal push candle ke appData/public: {e}")


def push_live_price_to_public(tick):
    try:
        public_doc_ref.set({
            f'aiLivePriceMt5_{PAIR}': (tick.bid + tick.ask) / 2,
            f'aiLivePriceMt5UpdatedAt_{PAIR}': datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception as e:
        log(f"Gagal push live price ke appData/public: {e}")


# Dipicu tombol restart per-pair di web (nulis currencyInstruments.<PAIR>.botControl.restartRequested).
def handle_restart_request():
    now = datetime.now(timezone.utc)
    log("Restart diminta dari web, ambil kode terbaru...")
    send_telegram(f"🔄 [{PAIR}] Restart diminta dari web, ambil kode terbaru...")

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        result = subprocess.run(['git', 'pull'], cwd=repo_root, capture_output=True, text=True, timeout=30)
        success = result.returncode == 0
        result_msg = 'success' if success else f'failed: {result.stderr[:200]}'
    except Exception as e:
        success = False
        result_msg = f'failed: {e}'

    try:
        doc_ref.set(instrument_fields({'botControl': {
            'restartRequested': False,
            'lastRestartAt': now.isoformat(),
            'lastRestartResult': result_msg,
        }}), merge=True)
    except Exception as e:
        log(f"Gagal update status botControl: {e}")
    log_ai_tick('restart' if success else 'error', result_msg)

    if success:
        log("Update berhasil, restart proses...")
        send_telegram(f"✅ [{PAIR}] Update berhasil, bot restart pakai kode terbaru...")
        mt5.shutdown()
        os.execv(sys.executable, [sys.executable] + sys.argv)
    else:
        log(f"Restart gagal: {result_msg}. Bot lanjut jalan pakai kode lama.")
        send_telegram(f"⚠️ [{PAIR}] Restart gagal: {result_msg}. Bot lanjut jalan pakai kode lama.")


def send_periodic_summary(ai_trade_data, tick):
    for group_name, group_label in (('method1', ''), ('method2', ' — Metode 2 (ICT)')):
        if group_name == 'method2' and not cfg.AI_METHOD_TWO_ENABLED:
            continue
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
                pips = ((px - ly['entry']) * dir_sign) / cfg.AI_PIP_SIZE
                total_floating += usc_to_rupiah(calc_layer_pl_usc(pips), live_kurs)
            send_telegram(
                f"📍 <b>Posisi Terbuka {PAIR}{group_label}</b>\n\n"
                f"{trade['arah']} @ {fmt_price(trade['entry'])}\n"
                f"Floating P/L: <b>{format_rupiah(total_floating)}</b>"
            )
        else:
            send_telegram(f"📍 <b>Posisi Terbuka {PAIR}{group_label}</b>\n\nGak ada posisi open saat ini.")

    today_pl, today_n = get_today_pl(ai_trade_data)
    send_telegram(f"📅 <b>P/L Hari Ini ({PAIR})</b>\n\n{format_rupiah(today_pl)} dari {today_n} entry closed.")

    week_pl, week_n = get_current_week_pl(ai_trade_data)
    send_telegram(f"🗓️ <b>P/L Minggu Ini ({PAIR})</b>\n\n{format_rupiah(week_pl)} dari {week_n} entry closed.")

    all_pl, all_n = get_all_time_pl(ai_trade_data)
    send_telegram(f"📊 <b>P/L Keseluruhan ({PAIR})</b>\n\n{format_rupiah(all_pl)} dari {all_n} entry closed.")

    send_telegram(f"➖➖➖➖➖ Selesai {PAIR} ➖➖➖➖➖")


_summary_in_flight = False


def _latest_scheduled_summary_utc(now_utc, interval_hours):
    interval_hours = int(interval_hours) if interval_hours and interval_hours > 0 else 6
    now_wib = now_utc + timedelta(hours=7)
    slot_hour = now_wib.hour - (now_wib.hour % interval_hours)
    slot_wib = now_wib.replace(hour=slot_hour, minute=0, second=0, microsecond=0)
    return slot_wib - timedelta(hours=7)


def maybe_send_summary(ai_trade_data, bot_control, tick, now):
    global _summary_in_flight
    if _summary_in_flight:
        return

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
    trade_data_snapshot = copy.deepcopy(ai_trade_data)

    def _worker():
        global _summary_in_flight
        try:
            # Terjadwal (bukan manual) - tunggu jatah PAIR_INDEX * 30 detik dulu, biar 5 pair ngirim
            # berurutan (USDJPY dulu, baru GBPUSD, dst - sesuai urutan dropdown), gak numpuk bareng
            # kecampur di 1 chat. Manual trigger (tombol "Kirim Summary" per pair) tetap instan.
            if not manual and PAIR_INDEX > 0:
                time.sleep(PAIR_INDEX * SUMMARY_STAGGER_SECONDS)
            send_periodic_summary(trade_data_snapshot, tick)
            doc_ref.set(instrument_fields({'botControl': {'summaryRequested': False, 'lastSummaryAt': datetime.now(timezone.utc).isoformat()}}), merge=True)
            log_ai_tick('summary', 'Summary terkirim' + (' (manual)' if manual else ' (terjadwal)'))
        except Exception as e:
            log(f"Gagal kirim/update status summary: {e}")
        finally:
            _summary_in_flight = False

    threading.Thread(target=_worker, daemon=True).start()


_news_cache = {'checked_at': None, 'result': None}


def get_cached_news(now):
    if _news_cache['checked_at'] is not None and (now - _news_cache['checked_at']) < timedelta(seconds=SLOW_LOOP_SECONDS):
        return _news_cache['result']
    # Baca cache bareng yang ditulis Gold (ai-tick.py) dulu - hemat request ke API luar, 5 proses currency
    # gak perlu nembak sendiri2 (itu yang bikin sering ke-throttle/blokir pas semua jalan bareng).
    try:
        pub_snap = public_doc_ref.get()
        pub_data = pub_snap.to_dict() if pub_snap.exists else {}
        shared = pub_data.get('newsCalendarCache')
        if shared and shared.get('checkedAt'):
            shared_checked_at = datetime.fromisoformat(shared['checkedAt'])
            if (now - shared_checked_at) < timedelta(seconds=SLOW_LOOP_SECONDS * 2):
                _news_cache['result'] = shared.get('result')
                _news_cache['checked_at'] = now
                return _news_cache['result']
    except Exception as e:
        log(f"Gagal baca cache berita bareng, fallback fetch langsung: {e}")
    # Cache bareng gak ada/basi (misal proses Gold lagi mati) - fallback fetch langsung kayak biasa.
    _news_cache['result'] = fetch_active_high_impact_news()
    _news_cache['checked_at'] = now
    return _news_cache['result']


_kurs_cache = {'checked_at': None, 'result': 16000}


def get_cached_kurs(now):
    if _kurs_cache['checked_at'] is None or (now - _kurs_cache['checked_at']) >= timedelta(seconds=SLOW_LOOP_SECONDS):
        _kurs_cache['result'] = fetch_live_kurs_idr()
        _kurs_cache['checked_at'] = now
    return _kurs_cache['result']


AI_LIVE_PRICE_PUSH_EVERY_N_TICKS = 3
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
    doc_data = snap.to_dict() if snap.exists else {}
    inst = get_instrument_data(doc_data)
    ai_trade_data = inst.get('aiTradeData', {})
    ai_modal_awal = inst.get('aiModalAwal', 2500000)
    apply_ai_settings((inst.get('aiSettings') or {}).get('master'))

    bot_control = inst.get('botControl') or {}
    if bot_control.get('restartRequested'):
        handle_restart_request()
        return

    maybe_send_summary(ai_trade_data, bot_control, tick, now)

    live_kurs = get_cached_kurs(now)
    news_info = get_cached_news(now)

    any_changed = False
    for group_name, signal_types in METHOD_GROUPS.items():
        open_info = find_open_ai_trade_for_group(ai_trade_data, signal_types)
        if not open_info:
            continue
        trade = open_info['trade']
        label = signal_type_label(trade['signalType']) + ' '

        if news_info:
            changed = force_close_all_layers_at_market(trade, tick.bid, tick.ask, live_kurs, 'news_close', now)
            if changed:
                any_changed = True
                msg = f"Posisi {PAIR} {label}ditutup paksa: berita high-impact \"{news_info['title']}\"."
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
            notes_html = f"[{PAIR}] " + label + ('\n'.join(result['notes']) or detail)
            send_telegram(f"{header}\n\n{notes_html}")

    if any_changed:
        doc_ref.set(instrument_fields({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}), merge=True)


def run_slow_tick():
    now = datetime.now(timezone.utc)

    try:
        candles = fetch_candles(100)
        push_live_candles_to_public(candles)
    except Exception as e:
        log(f"Gagal ambil data candle: {e}")
        log_ai_tick('error', f"Gagal ambil data candle: {e}")
        send_telegram(f"⚠️ <b>Bot Error ({PAIR})</b>\n\nGagal ambil data candle: {e}")
        return

    snap = doc_ref.get()
    doc_data = snap.to_dict() if snap.exists else {}
    inst = get_instrument_data(doc_data)
    ai_trade_data = inst.get('aiTradeData', {})
    ai_modal_awal = inst.get('aiModalAwal', 2500000)
    news_info = get_cached_news(now)

    if not is_market_open(now):
        log("Market tutup (weekend), skip.")
        log_ai_tick('market_closed', 'Weekend, market tutup.')
        return

    # ---------- Method 1 (trend_following / rsi_reversal) ----------
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
            doc_ref.set(instrument_fields({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}), merge=True)
            log_ai_tick('entry_opened', 'Entry Metode 1 berhasil dibuka.')
        else:
            log_ai_tick('no_signal', cfg.last_signal_skip_reason or 'Gak ada sinyal Metode 1 valid tick ini.')

    # ---------- Method 2 (ICT/SMC liquidity sweep) ----------
    if not cfg.AI_METHOD_TWO_ENABLED:
        return
    open_m2 = find_open_ai_trade_for_group(ai_trade_data, METHOD_GROUPS['method2'])
    if open_m2:
        log_ai_tick('waiting_m2', 'Metode 2: posisi masih open, belum ada perubahan.')
        return

    ict_state = inst.get('ictState') or dict(ICT_STATE_DEFAULT)
    new_state, ready_sug = run_ict_state_machine(ict_state, ai_trade_data)
    if new_state != ict_state:
        doc_ref.set(instrument_fields({'ictState': new_state}), merge=True)

    if not ready_sug:
        return
    if news_info:
        log_ai_tick('news_block_m2', "Sinyal Metode 2 ready tapi jam rawan berita, entry ditahan.")
        return

    opened2 = auto_open_ai_position(ai_trade_data, ready_sug)
    if opened2:
        doc_ref.set(
            instrument_fields({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal, 'ictState': dict(ICT_STATE_DEFAULT)}),
            merge=True,
        )
        log_ai_tick('entry_opened_m2', 'Entry Metode 2 (ICT) berhasil dibuka.')


def main():
    log(f"Bot Trading AI Currency ({PAIR}, VPS/MT5) mulai jalan...")
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
