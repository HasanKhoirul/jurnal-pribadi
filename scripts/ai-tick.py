# Bot Trading AI - versi VPS, jalan terus-menerus (bukan sekali-tick kayak ai-tick.mjs di GitHub Actions).
# Logic sinyal & manajemen posisi identik dengan ai-tick.mjs/script.js - bedanya sumber harga dari MT5
# lokal (bukan TwelveData), dan strateginya dipecah 2 loop:
#   - fast loop (tiap FAST_LOOP_SECONDS): cek SL/TP/pending-fill dari tick harga real-time, presisi tinggi
#   - slow loop (tiap SLOW_LOOP_SECONDS): hitung ulang indikator dari candle & cari sinyal entry baru
# Field & struktur data di Firestore (aiTradeData, layers, dst.) dijaga sama persis dengan versi JS,
# biar web app (script.js) tetap bisa baca/render tanpa perubahan.
#
# Logic yang symbol-agnostic (indikator, Metode 1, Metode 2 ICT, manajemen posisi) tinggal di
# ai_trading_core.py, dipakai bareng sama scripts/ai-tick-currency.py (Currency). File ini isinya
# cuma yang Gold-spesifik: kredensial, resolve simbol MT5, Firestore doc_ref, Telegram, orchestration loop.

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

FAST_LOOP_SECONDS = 10
SLOW_LOOP_SECONDS = 300  # 5 menit

# Field Master Setting yang gak dipakai ai_trading_core.py (khusus fitur summary Telegram, tetap di file host).
AI_SUMMARY_INTERVAL_HOURS = AI_MASTER_DEFAULTS['summaryIntervalHours']


def apply_ai_settings(master):
    global AI_SUMMARY_INTERVAL_HOURS
    apply_master_settings(master)
    AI_SUMMARY_INTERVAL_HOURS = (master or {}).get('summaryIntervalHours', AI_MASTER_DEFAULTS['summaryIntervalHours'])


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


# ---------- Wiring cfg buat ai_trading_core.py (harus sebelum fungsi core manapun dipanggil) ----------
cfg.SYMBOL = SYMBOL
cfg.SYMBOL_LABEL = 'XAUUSD'
cfg.PRICE_DECIMALS = 2  # eksplisit (sama kayak default Config) - Gold ditampilin 2 desimal
cfg.ATR_SL_MIN_PIPS = 30
cfg.ATR_SL_MAX_PIPS = 120
cfg.L3_TP_ATR_MIN_PIPS = 90
cfg.L3_TP_ATR_MAX_PIPS = 360
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
        if group_name == 'method2' and not cfg.AI_METHOD_TWO_ENABLED:
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
                pips = ((px - ly['entry']) * dir_sign) / cfg.AI_PIP_SIZE
                total_floating += usc_to_rupiah(calc_layer_pl_usc(pips), live_kurs)
            send_telegram(
                f"📍 <b>Posisi Terbuka{group_label}</b>\n\n"
                f"{trade['arah']} @ {fmt_price(trade['entry'])}\n"
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
        # Simpen ke appData/public biar 5 proses Currency baca dari sini doang, gak ikut nembak API luar
        # sendiri2 (6 proses x tiap ~5 menit ke API gratis kena throttle/blokir).
        try:
            public_doc_ref.set({'newsCalendarCache': {'result': _news_cache['result'], 'checkedAt': now.isoformat()}}, merge=True)
        except Exception as e:
            log(f"Gagal simpen cache berita bareng: {e}")
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
        trade = open_info['trade']
        label = signal_type_label(trade['signalType']) + ' '

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
        opened1 = auto_open_ai_position(ai_trade_data, sug1, ai_modal_awal)
        if opened1:
            doc_ref.set({'aiTradeData': ai_trade_data, 'aiModalAwal': ai_modal_awal}, merge=True)
            log_ai_tick('entry_opened', 'Entry Metode 1 berhasil dibuka.')
        else:
            log_ai_tick('no_signal', cfg.last_signal_skip_reason or 'Gak ada sinyal Metode 1 valid tick ini.')

    # ---------- Method 2 (ICT/SMC liquidity sweep) - slot terpisah, independen dari Method 1 ----------
    if not cfg.AI_METHOD_TWO_ENABLED:
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

    opened2 = auto_open_ai_position(ai_trade_data, ready_sug, ai_modal_awal)
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
