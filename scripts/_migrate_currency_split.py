# One-off migration script - Firestore Fase 2 (2026-09).
# Pindahin currencyInstruments.<PAIR> (nested field di appData/{uid}) ke dokumen sendiri-sendiri
# appData/{uid}/currencyPairs/{PAIR}, lalu hapus field lama dari root.
#
# JALANIN SEKALI AJA, pas market tutup (weekend), SEBELUM restart 5 proses ai-tick-currency.py yang
# udah dideploy kode barunya. Setelah dipakai, script ini boleh dihapus (bukan bagian permanen repo).
#
# Cara pakai: py -3.10 scripts/_migrate_currency_split.py

import os
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()

FIREBASE_SERVICE_ACCOUNT_PATH = os.environ['FIREBASE_SERVICE_ACCOUNT_PATH']
AI_TARGET_UID = os.environ['AI_TARGET_UID']

PAIRS = ['USDJPY', 'GBPUSD', 'AUDUSD', 'EURUSD', 'USDCAD']

cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

doc_ref = db.collection('appData').document(AI_TARGET_UID)

print(f"Baca appData/{AI_TARGET_UID}...")
snap = doc_ref.get()
if not snap.exists:
    raise SystemExit("Dokumen appData/{uid} gak ketemu, batalin migrasi.")

data = snap.to_dict() or {}
old_currency = data.get('currencyInstruments') or {}

if not old_currency:
    raise SystemExit("Field 'currencyInstruments' kosong/gak ada di root doc - kemungkinan udah pernah dimigrasi, atau belum ada data sama sekali. Cek manual dulu sebelum lanjut, script berhenti biar aman.")

missing = [p for p in PAIRS if p not in old_currency]
if missing:
    print(f"PERINGATAN: pair {missing} gak ada datanya di currencyInstruments lama. Bakal di-skip (gak dibuatin dokumen baru buat pair ini).")

copied = []
for pair in PAIRS:
    pair_data = old_currency.get(pair)
    if not pair_data:
        continue
    target_ref = doc_ref.collection('currencyPairs').document(pair)
    target_ref.set(pair_data)
    copied.append(pair)
    print(f"  {pair}: copied ke appData/{AI_TARGET_UID}/currencyPairs/{pair}")

if len(copied) != len(PAIRS):
    print(f"\nCUMA {len(copied)}/{len(PAIRS)} pair ke-copy ({copied}). Field lama 'currencyInstruments' DIBIARKAN di root (gak dihapus) biar bisa dicek manual dulu / retry.")
    raise SystemExit(0)

print("\nSemua 5 pair sukses ke-copy. Hapus field 'currencyInstruments' lama dari root doc...")
doc_ref.update({'currencyInstruments': firestore.DELETE_FIELD})
print("Selesai. Field lama udah kehapus dari root appData/{uid}.")
print("\nLANGKAH SELANJUTNYA: restart 5 proses ai-tick-currency.py MANUAL lewat terminal VPS (bukan tombol web),")
print("baru web app di-hard-refresh.")
