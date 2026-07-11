# Skema Firestore — Jurnal-XAUUSD

Referensi struktur data lengkap, disiapkan buat memudahkan pengembangan Flutter/Android nanti (atau porting logic ke bahasa lain) tanpa perlu re-derive dari baca `script.js` dari nol.

Project Firebase: `jurnal-pribadi`. Auth: Firebase Authentication (email/password, username pendek di-suffix jadi `username@jurnal.local`).

## Collection `appData`

### Dokumen `appData/public` — bisa dibaca siapa aja tanpa login (view-only kalau belum login)

```
{
  journalData: {
    "YYYY-MM-DD": [
      {
        arah: "BUY"|"SELL", tf: string, area: "Zone"|"Tengah", news: string, emosi: string,
        timeOpen: string, timeClose: string, duration: string,
        layers: [{ entry: string, sl: string, pips: string }],  // multi-layer manual entry
        alasan: string, pl: number
      }
    ]
  },
  modalAwal: number,      // modal awal Jurnal XAUUSD manual
  aiLiveCandlesMt5: [ { time: string(ISO), open: number, high: number, low: number, close: number } ],  // candle H1 terkini dari bot VPS/MT5 (Gold), dipush ulang tiap slow-loop (~5 menit)
  aiLivePriceMt5: number,  // harga tick (mid bid/ask) terkini dari bot VPS/MT5 (Gold), dipush tiap fast-loop (~10 detik), buat "Harga Sekarang" biar berasa live
  aiLivePriceMt5UpdatedAt: string (ISO),
  aiLiveCandlesMt5UpdatedAt: string (ISO),  // dipakai script.js buat cek data ini basi (>10 menit) atau enggak, fallback ke TwelveData kalau basi
  aiLiveCandlesMt5_<PAIR>: [...sama shape aiLiveCandlesMt5...],  // versi Currency, 1 set per pair (misal aiLiveCandlesMt5_USDJPY) - field name di-suffix biar gak collide sama punya Gold
  aiLivePriceMt5_<PAIR>: number,
  aiLivePriceMt5UpdatedAt_<PAIR>: string (ISO),
  aiLiveCandlesMt5UpdatedAt_<PAIR>: string (ISO),
  sportData: {
    "YYYY-MM-DD": [
      { time: string, type: string, target: string, achieved: string, totalDur: number,
        sets: [{ name: string, dur: string, rest: string }], lateReason: string, notes: string }
    ]
  }
}
```

### Dokumen `appData/{uid}` — privat, cuma bisa dibaca/ditulis user yang login sesuai UID

```
{
  expData: {
    "YYYY-MM-DD": [ { type: "Cash"|"Online", bank: string, category: string, notes: string, amount: number } ]
  },
  wealthData: {
    items: [ { id: string, date: string, type: string, note: string, amount: number } ],
    realMoney: number
  },
  aiSettings: {
    twelvedata: string,       // API key TwelveData (browser only, dipakai chart/manual tick)
    llmProvider: "none"|"gemini"|"claude",
    llmKey: string,
    master: {                  // diatur dari menu "🎛️ Master Setting" - dibaca ulang tiap tick oleh bot VPS (ai-tick.py) & ai-tick.mjs, gak perlu restart bot
      riskLimitPct: number,     // default 10 - CUMA dipakai kotak insight dashboard browser (script.js), TIDAK dipakai bot (gak nge-block entry)
      riskPeriod: "monthly"|"weekly",  // default "monthly" - "weekly" = minggu berjalan sekarang (Senin-Minggu real), bukan minggu dari bulan yang dibrowse
      slPips: number,                   // default 50 - dipakai kalau slMode "fixed"
      slMode: "fixed"|"atr",             // default "fixed" - "atr" = SL ikut ATR(14) H1 x atrMultiplier, di-clamp 30-120 pips (clamp hardcode, bukan field)
      atrMultiplier: number,             // default 1.5 - dipakai kalau slMode "atr"
      tpLayerPips: [number, number, number],  // default [80, 100, 150], index 0/1/2 = layer 1/2/3 - dipakai kalau tpMode "fixed"
      tpMode: "fixed"|"adaptive",        // default "fixed" - "adaptive" = TP & deep-lock Layer 3 proporsional ke slPipsUsed, pakai rasio dari tpLayerPips/slPips (independen dari slMode)
      pipValueUnit: "cent"|"usd",        // default "cent" - satuan pipValuePerLot. Kalibrasi sekarang khusus akun Cent user, GANTI MANUAL (bukan konversi otomatis) kalau pindah jenis akun, ambil angkanya dari spesifikasi kontrak simbol di broker
      pipValuePerLot: number,            // default 1 - nilai 1 pip pada lot referensi 0.1, dalam satuan pipValueUnit (default: 1 Cent per 0.1 lot, sesuai akun Cent)
      lotSize: number,                   // default 0.1
      layerStaggerPips: number,          // default 10
      lockPipsAfterTp1: number,          // default 10
      deepLockTriggerPips: number,       // default 100
      deepLockPips: number,              // default 80
      deepLockTimeoutMinutes: number,    // default 15
      minSignalWinrate: number,          // default 35
      winrateLookbackDays: number,       // default 14
      winrateMinSamples: number,         // default 5
      newsPreMinutes: number,            // default 10
      newsPostMinutes: number,           // default 40
      summaryIntervalHours: number,      // default 6 - interval otomatis kirim summary Telegram (posisi terbuka, P/L hari/minggu/all-time). Nempel ke jam bulat WIB (00/06/12/18 kalau 6) dari tengah malam, BUKAN "N jam sejak restart terakhir" - gak kegeser walau bot di-restart
      methodTwoEnabled: boolean          // default false - kill-switch Metode 2 (ICT/SMC Liquidity Sweep). Cuma dihitung & dieksekusi di bot VPS (ai-tick.py) - script.js/ai-tick.mjs cuma baca hasilnya, gak compute ulang. Kalau false, ictState gak pernah diproses & slot method2 selalu kosong
    }
  },
  botControl: {                // command channel ke bot VPS (BUKAN setting kayak aiSettings) - dipicu tombol "🔄 Restart Bot (VPS)" / "📊 Kirim Summary" di web
    restartRequested: boolean,  // true = ada permintaan restart yang belum diproses. Cuma efektif kalau proses ai-tick.py lagi HIDUP - kalau bot mati total, sinyal ini nunggu doang sampai dinyalain manual
    requestedAt: string (ISO),
    lastRestartAt: string (ISO) | null,   // diisi bot setelah selesai proses (git pull + restart diri sendiri via os.execv)
    lastRestartResult: string | null,     // "success" | "failed: <pesan git pull>"
    summaryRequested: boolean,   // true = ada permintaan kirim summary Telegram manual yang belum diproses
    summaryRequestedAt: string (ISO),
    lastSummaryAt: string (ISO) | null    // dipakai bot buat cek udah lewat jadwal terdekat (00/06/12/18 WIB, dst) apa belum (summary otomatis)
  },                            // PENTING: web nulis field ini pakai spread (...botControl) biar gak saling nge-wipe field restart/summary
  aiModalAwal: number,        // modal awal simulasi Trading AI
  // INVARIANT: maks 1 trade "open" PER GRUP signalType, bukan 1 trade open total lagi.
  // Grup "method1" = trend_following + rsi_reversal (berbagi 1 slot, kayak sebelumnya).
  // Grup "method2" = ict_liquidity_sweep (slot sendiri, independen dari method1) - biar 2 metode
  // bisa dibandingin performanya tanpa saling starve slot. Lihat find_open_ai_trade_for_group (ai-tick.py) / findOpenAiTrade(signalTypes) (script.js).
  aiTradeData: {
    "YYYY-MM-DD": [
      {
        arah: "BUY"|"SELL", tf: string,           // timeframe candle (mis. "5min", "1h", "M15" khusus method2)
        entry: number,                             // harga sinyal awal = entry layer 0
        sl: number,                                 // SL layer 0 (duplikat layers[0].sl, buat kompatibilitas lama)
        signalType: "trend_following"|"rsi_reversal"|"ict_liquidity_sweep",
        alasan: string,                             // teks reasoning (bisa dipoles LLM)
        status: "open"|"closed",                     // status TRADE keseluruhan
        pl: number,                                   // total P/L (Rp), terisi kalau closed
        openedAt: string (ISO), closedAt: string|null,
        layers: [                                     // selalu 3 layer, index 0/1/2
          {
            tpPips: number,                             // jarak TP layer ini - fixed (80/100/150) atau hasil hitungan adaptif, tergantung tpMode SAAT TRADE DIBUKA (dibekukan, gak berubah walau tpMode diganti belakangan)
            entry: number,                             // harga entry KHUSUS layer ini (layer0=sinyal, layer1=-10p, layer2=-20p dari sinyal, arah tergantung BUY/SELL)
            tp: number, sl: number,                     // harga TP/SL layer ini (SL bisa berubah karena trailing)
            lot: 0.1,
            status: "pending"|"open"|"tp"|"sl"|"be"|"timeout"|"timeout_lock"|"news_close"|"cancelled",
            pl: number,                                 // P/L (Rp) realized kalau status !== open/pending
            slMoved: boolean,                           // udah kena trailing lock atau belum
            deepLockAt: string (ISO) | undefined,       // cuma ada di layer terakhir (index 2), waktu SL dikunci
            deepLockTriggerPips: number | undefined,    // cuma ada di layer terakhir KALAU tpMode "adaptive" pas dibuka - dibekukan, dipakai gantiin AI_DEEP_LOCK_TRIGGER_PIPS global buat trade ini. Kalau gak ada (trade lama/mode fixed), pakai konstanta global
            deepLockPips: number | undefined            // sama kayak di atas, gantiin AI_DEEP_LOCK_PIPS
          }
        ]
      }
    ]
  },
  ictState: {                  // state-machine Metode 2 (ICT/SMC Liquidity Sweep), persisten antar-tick & antar-restart bot VPS. CUMA dibaca/ditulis ai-tick.py
    phase: "idle"|"awaiting_choch"|"ready",  // idle -> (sweep H4 kedeteksi) -> awaiting_choch -> (CHoCH M15 confirmed) -> ready -> (dibuka jadi trade) -> idle lagi
    direction: "BUY"|"SELL"|null,
    sweepAt: string (ISO)|null,               // waktu sweep H4 kedeteksi - dipakai buat timeout 24 jam nunggu CHoCH
    sweepLevel: number|null,                  // harga high/low yang di-sweep, jadi acuan SL (+ buffer 20 pips)
    sweptHtfCandleTime: string (ISO)|null,    // waktu candle H4 yang men-trigger sweep - dedupe, biar gak re-trigger tiap tick sebelum candle H4 baru
    readyEntry: number|null,                  // dibekukan pas phase "ready" (midpoint Order Block M15) - dipakai persis pas dibuka, gak dihitung ulang
    readySl: number|null,
    readyTpPipsUsed: [number, number, number]|null,
    readyAlasan: string|null
  },
  currencyInstruments: {       // modul Currency (multi-instrumen) - Gold TETAP di field root di atas, gak dipindah kesini
    "<PAIR>": {                  // key = nama pair, misal "USDJPY", "GBPUSD", "AUDUSD", "EURUSD", "USDCAD"
      aiTradeData: {...sama persis shape aiTradeData Gold di atas...},
      aiModalAwal: number,        // modal simulasi TERPISAH per pair, gak digabung sama Gold atau pair lain
      aiSettings: { master: {...sama shape aiSettings.master Gold, termasuk methodTwoEnabled...} },  // SL/TP/lot per pair independen
      botControl: {...sama shape botControl Gold...},   // proses OS terpisah per pair, butuh restart-signal sendiri
      ictState: {...sama shape ictState Gold...}
    }
  }
}
```

Ditulis/dibaca oleh `scripts/ai-tick-currency.py <PAIR>` (1 proses per pair, parameterized - lihat komentar di file itu), pakai helper `instrument_fields()`/`get_instrument_data()` biar nempel ke `currencyInstruments.<PAIR>.*` doang. Logic symbol-agnostic (indikator, Metode 1, Metode 2 ICT, manajemen posisi) di-share dari `scripts/ai_trading_core.py` — dipakai bareng sama `ai-tick.py` (Gold), bukan duplikat kode. `AI_PIP_SIZE` per pair beda dari Gold (0.01 buat JPY, 0.0001 buat non-JPY) — lihat `CURRENCY_INSTRUMENTS` dict di `ai-tick-currency.py`.

**Layer 0** = market entry (harga sinyal), TP default 80 pips. **Layer 1** = pending order -10 pips, TP default 100 pips. **Layer 2** = pending order -20 pips, TP default 150 pips (dan satu-satunya yang punya `deepLockAt`/`deepLockTriggerPips`/`deepLockPips`). Angka TP default itu berubah proporsional kalau `tpMode` "adaptive" pas trade dibuka.

### Subcollection `appData/{uid}/ai_tick_log/{autoId}` — log aktivitas bot, ditulis tiap tick

```
{
  time: string (ISO),
  outcome: "entry_opened"|"position_updated"|"position_closed"|"news_close"|"waiting"|"no_signal"|"market_closed"|"news_block"|"error"|"manual_reset",
  detail: string,           // penjelasan spesifik (alasan skip, judul berita, dst.)
  source: "browser"|"server"
}
```

## Konstanta kunci logic Trading AI (harus sama persis kalau diporting ke bahasa lain)

Nilai di tabel ini cuma **default** — semuanya (kecuali `AI_PIP_SIZE`) bisa di-override lewat `aiSettings.master` (lihat di atas), diatur dari menu "🎛️ Master Setting" di web app. `AI_LOT_SIZE`..`AI_NEWS_POST_MINUTES` di kode masing-masing (script.js/ai-tick.py/ai-tick.mjs) dibaca ulang tiap tick dari settings ini.

| Konstanta | Nilai default | Keterangan |
|---|---|---|
| `AI_PIP_SIZE` | 0.1 | 1 pip = 0.1 harga (XAUUSD) |
| `AI_LOT_SIZE` | 0.1 | Lot per layer (Cent account Exness) |
| `AI_SL_PIPS` | 50 | SL awal tiap layer (dipakai kalau `AI_SL_MODE` "fixed") |
| `AI_SL_MODE` | "fixed" | "fixed" \| "atr" - "atr" hitung SL dari ATR(14) H1 x `AI_ATR_MULTIPLIER`, di-clamp 30-120 pips (clamp hardcode di kode, bukan setting) |
| `AI_ATR_MULTIPLIER` | 1.5 | Pengali ATR(14) buat SL, dipakai kalau `AI_SL_MODE` "atr" |
| `AI_TP_LAYERS_PIPS` | [80, 100, 150] | TP per layer index 0/1/2 (dipakai kalau `AI_TP_MODE` "fixed") |
| `AI_TP_MODE` | "fixed" | "fixed" \| "adaptive" - "adaptive" hitung TP & deep-lock Layer 3 proporsional ke SL adaptif (rasio dari `AI_TP_LAYERS_PIPS`/`AI_SL_PIPS`), independen dari `AI_SL_MODE` |
| `AI_LAYER_STAGGER_PIPS` | 10 | Jarak pending order antar layer |
| `AI_LOCK_PIPS_AFTER_TP1` | 10 | Kunci profit layer 1&2 begitu layer 0 TP |
| `AI_DEEP_LOCK_TRIGGER_PIPS` | 100 | Floating profit layer terakhir buat trigger deep-lock |
| `AI_DEEP_LOCK_PIPS` | 80 | SL layer terakhir dikunci ke sini pas deep-lock |
| `AI_DEEP_LOCK_TIMEOUT_MINUTES` | 15 | Timeout paksa-tutup setelah deep-lock kalau TP belum kena |
| `AI_MIN_SIGNAL_WINRATE` | 35 (%) | Ambang skip sinyal kalau win rate rendah |
| `AI_WINRATE_LOOKBACK_DAYS` | 14 | Window hitung win rate adaptif |
| `AI_WINRATE_MIN_SAMPLES` | 5 | Minimal sample sebelum filter win rate aktif |
| `AI_NEWS_PRE_MINUTES` / `AI_NEWS_POST_MINUTES` | 10 / 40 | Window "rawan berita" sebelum/sesudah rilis data high-impact |
| `AI_SUMMARY_INTERVAL_HOURS` | 6 | Interval otomatis kirim summary Telegram (ai-tick.py only, gak ada di script.js/ai-tick.mjs) |
| `AI_METHOD_TWO_ENABLED` | false | Kill-switch Metode 2 (ICT). ai-tick.py only - script.js cuma pakainya buat show/hide section dashboard, ai-tick.mjs gak tau soal ini sama sekali |

**Konstanta Metode 2 (ICT) — hardcode di `ai-tick.py`, BUKAN Master Setting** (v1, boleh dipromosikan ke setting kalau kepake): `AI_ICT_HTF_MT5` = H4, `AI_ICT_LTF_MT5` = M15, `AI_ICT_SWING_LOOKBACK` = 2 (candle fractal tiap sisi), `AI_ICT_CHOCH_TIMEOUT_HOURS` = 24, `AI_ICT_DISPLACEMENT_MIN_BODY_RATIO` = 0.7, `AI_ICT_SL_BUFFER_PIPS` = 20.

**Catatan hemat kuota Firestore**: `ai-tick.py` push `aiLivePriceMt5` ke `appData/public` di-throttle (`AI_LIVE_PRICE_PUSH_EVERY_N_TICKS = 3`, hardcode bukan setting) — cuma ditulis tiap ~30 detik (3x `FAST_LOOP_SECONDS`), bukan tiap tick. Ini **cuma soal tampilan** — eksekusi (cek SL/TP/deep-lock/news) tetap jalan tiap tick (~10 detik) baca harga langsung dari MT5, gak kepengaruh throttle ini. `AI_LIVE_PRICE_MAX_AGE_SECONDS` di script.js dinaikin ke 45 (dari 30) buat kasih buffer terhadap siklus push yang lebih jarang ini.

## File terkait
- **[script.js](script.js)** — logic sisi browser (modul "MODUL TRADING AI"), plus semua modul lain (jurnal manual, pengeluaran, olahraga, wealth).
- **[scripts/ai-tick.mjs](scripts/ai-tick.mjs)** — logic sisi server (Node.js + firebase-admin), dijalankan `.github/workflows/ai-trading-tick.yml` tiap ~15 menit (realistanya bisa 1-2.5 jam karena keterbatasan jadwal GitHub Actions gratis).
- Ketiga file di atas **harus selalu identik logic-nya untuk Metode 1** (trend_following/rsi_reversal) — kalau ada perubahan, wajib di-mirror ke keduanya (script.js & ai-tick.mjs). **Pengecualian: Metode 2 (ICT/SMC liquidity sweep) & modul Currency CUMA ada di sisi Python (VPS)** — gak di-mirror ke `script.js`/`ai-tick.mjs` (keputusan scope sengaja, biar gak ada banyak implementasi state-machine stateful yang harus identik presisi di banyak bahasa/proses). Kalau VPS mati, Metode 2 & Currency otomatis berhenti sementara; Metode 1 Gold tetap jalan lewat fallback GitHub Actions.
- **[scripts/ai_trading_core.py](scripts/ai_trading_core.py)** — logic symbol-agnostic (indikator, Metode 1, Metode 2 ICT, manajemen posisi), di-import bareng oleh `ai-tick.py` (Gold) & `ai-tick-currency.py` (Currency) — SATU sumber kebenaran, bugfix cukup 1x edit + restart semua proses yang makai.
- **[scripts/ai-tick-currency.py](scripts/ai-tick-currency.py)** — runner parameterized modul Currency, 1 proses per pair (`py -3.10 ai-tick-currency.py <PAIR>`), baca/tulis ke `currencyInstruments.<PAIR>.*`.
