from datetime import datetime, timezone, timedelta

STALE_AFTER = timedelta(minutes=5)
COMMENT_MAX = 31


def make_intent_id(label, method, now):
    return f"{label}{method[-1]}{int(now.timestamp())}"[:COMMENT_MAX]


def record_intent(root_ref, intent_id, payload, now):
    data = dict(payload)
    data.update({'status': 'sending', 'createdAt': now.isoformat()})
    root_ref.collection('orderIntents').document(intent_id).set(data)


def finalize_intent(root_ref, intent_id, status, ticket=None):
    root_ref.collection('orderIntents').document(intent_id).set(
        {'status': status, 'ticket': ticket}, merge=True)


def find_stale_sending(root_ref, now):
    stale = []
    for snap in root_ref.collection('orderIntents').stream():
        data = snap.to_dict() or {}
        if data.get('status') != 'sending':
            continue
        created = datetime.fromisoformat(data['createdAt'])
        if now - created >= STALE_AFTER:
            stale.append({'id': snap.id, **data})
    return stale


def reconcile_stale(root_ref, stale, live_comments):
    # live_comments HARUS berisi comment dari posisi aktif, pending order aktif, DAN history deal/order
    # sejak intent dibuat (posisi yang udah ketutup cepat tetap punya jejak di history).
    # Intent tanpa jejak di MT5 = aman dianggap tidak terkirim. Yang ada jejaknya = dikonfirmasi.
    # Intent tanpa jejak TAPI sudah lama: TIDAK di-resend otomatis, cuma ditandai buat dicek manual.
    results = []
    for intent in stale:
        if intent['id'][:COMMENT_MAX] in live_comments:
            status = 'confirmed'
        else:
            status = 'not_placed'
        finalize_intent(root_ref, intent['id'], status)
        results.append((intent['id'], status))
    return results
