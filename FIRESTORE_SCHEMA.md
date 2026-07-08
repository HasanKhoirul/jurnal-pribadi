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
  aiLiveCandlesMt5: [ { time: string(ISO), open: number, high: number, low: number, close: number } ],  // candle H1 terkini dari bot VPS/MT5, dipush ulang tiap slow-loop (~5 menit)
  aiLivePriceMt5: number,  // harga tick (mid bid/ask) terkini dari bot VPS/MT5, dipush tiap fast-loop (~10 detik), buat "Harga Sekarang" biar berasa live
  aiLivePriceMt5UpdatedAt: string (ISO),
  aiLiveCandlesMt5UpdatedAt: string (ISO),  // dipakai script.js buat cek data ini basi (>10 menit) atau enggak, fallback ke TwelveData kalau basi
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
      tpLayerPips: [number, number, number],  // default [80, 100, 150], index 0/1/2 = layer 1/2/3
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
      newsPostMinutes: number            // default 40
    }
  },
  aiModalAwal: number,        // modal awal simulasi Trading AI
  aiTradeData: {
    "YYYY-MM-DD": [
      {
        arah: "BUY"|"SELL", tf: string,           // timeframe candle (mis. "5min", "1h")
        entry: number,                             // harga sinyal awal = entry layer 0
        sl: number,                                 // SL layer 0 (duplikat layers[0].sl, buat kompatibilitas lama)
        signalType: "trend_following"|"rsi_reversal",
        alasan: string,                             // teks reasoning (bisa dipoles LLM)
        status: "open"|"closed",                     // status TRADE keseluruhan
        pl: number,                                   // total P/L (Rp), terisi kalau closed
        openedAt: string (ISO), closedAt: string|null,
        layers: [                                     // selalu 3 layer, index 0/1/2
          {
            tpPips: 80|100|150,                        // jarak TP tetap per index
            entry: number,                             // harga entry KHUSUS layer ini (layer0=sinyal, layer1=-10p, layer2=-20p dari sinyal, arah tergantung BUY/SELL)
            tp: number, sl: number,                     // harga TP/SL layer ini (SL bisa berubah karena trailing)
            lot: 0.1,
            status: "pending"|"open"|"tp"|"sl"|"be"|"timeout"|"timeout_lock"|"news_close"|"cancelled",
            pl: number,                                 // P/L (Rp) realized kalau status !== open/pending
            slMoved: boolean,                           // udah kena trailing lock atau belum
            deepLockAt: string (ISO) | undefined        // cuma ada di layer terakhir (index 2), waktu SL dikunci +80p
          }
        ]
      }
    ]
  }
}
```

**Layer 0** = market entry (harga sinyal), TP 80 pips. **Layer 1** = pending order -10 pips, TP 100 pips. **Layer 2** = pending order -20 pips, TP 150 pips (dan satu-satunya yang punya `deepLockAt`).

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
| `AI_TP_LAYERS_PIPS` | [80, 100, 150] | TP per layer index 0/1/2 (selalu fixed, gak ikut ATR) |
| `AI_LAYER_STAGGER_PIPS` | 10 | Jarak pending order antar layer |
| `AI_LOCK_PIPS_AFTER_TP1` | 10 | Kunci profit layer 1&2 begitu layer 0 TP |
| `AI_DEEP_LOCK_TRIGGER_PIPS` | 100 | Floating profit layer terakhir buat trigger deep-lock |
| `AI_DEEP_LOCK_PIPS` | 80 | SL layer terakhir dikunci ke sini pas deep-lock |
| `AI_DEEP_LOCK_TIMEOUT_MINUTES` | 15 | Timeout paksa-tutup setelah deep-lock kalau TP belum kena |
| `AI_MIN_SIGNAL_WINRATE` | 35 (%) | Ambang skip sinyal kalau win rate rendah |
| `AI_WINRATE_LOOKBACK_DAYS` | 14 | Window hitung win rate adaptif |
| `AI_WINRATE_MIN_SAMPLES` | 5 | Minimal sample sebelum filter win rate aktif |
| `AI_NEWS_PRE_MINUTES` / `AI_NEWS_POST_MINUTES` | 10 / 40 | Window "rawan berita" sebelum/sesudah rilis data high-impact |

## File terkait
- **[script.js](script.js)** — logic sisi browser (modul "MODUL TRADING AI"), plus semua modul lain (jurnal manual, pengeluaran, olahraga, wealth).
- **[scripts/ai-tick.mjs](scripts/ai-tick.mjs)** — logic sisi server (Node.js + firebase-admin), dijalankan `.github/workflows/ai-trading-tick.yml` tiap ~15 menit (realistanya bisa 1-2.5 jam karena keterbatasan jadwal GitHub Actions gratis).
- Kedua file di atas **harus selalu identik logic-nya** — kalau ada perubahan, wajib di-mirror ke keduanya.
