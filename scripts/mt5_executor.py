import math
from datetime import timedelta

import MetaTrader5 as mt5

ACCEPTED_RETCODES = {mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED}
RETRY_RETCODES = {mt5.TRADE_RETCODE_REQUOTE, mt5.TRADE_RETCODE_PRICE_CHANGED, mt5.TRADE_RETCODE_PRICE_OFF}
ABORT_RETCODES = {
    mt5.TRADE_RETCODE_NO_MONEY, mt5.TRADE_RETCODE_MARKET_CLOSED, mt5.TRADE_RETCODE_TRADE_DISABLED,
    mt5.TRADE_RETCODE_INVALID_STOPS, mt5.TRADE_RETCODE_INVALID_VOLUME, mt5.TRADE_RETCODE_INVALID,
}
PENDING_EXPIRY = timedelta(days=3)
MAGIC_BASE = 20260000
INSTRUMENT_ORDER = ['XAUUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'EURUSD', 'USDCAD']
METHOD_ORDER = {'method1': 1, 'method2': 2}


def magic_for(symbol, method):
    return MAGIC_BASE + INSTRUMENT_ORDER.index(symbol) * 10 + METHOD_ORDER[method]


def normalize_lot(lot, vol_min, vol_step, vol_max):
    steps = math.floor(lot / vol_step + 1e-9)
    value = round(min(steps * vol_step, vol_max), 8)
    if value < vol_min:
        return None
    return value


def classify_retcode(retcode):
    if retcode in ACCEPTED_RETCODES:
        return 'ok'
    if retcode in RETRY_RETCODES:
        return 'retry'
    if retcode in ABORT_RETCODES:
        return 'abort'
    return 'abort'


def build_market_order(symbol, side, lot, sl_price, tp_price, magic, comment, deviation=20):
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"tick {symbol} tidak tersedia")
    is_buy = side == 'BUY'
    return {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': symbol,
        'volume': float(lot),
        'type': mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        'price': tick.ask if is_buy else tick.bid,
        'sl': float(sl_price),
        'tp': float(tp_price),
        'deviation': deviation,
        'magic': magic,
        'comment': comment,
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }


def build_limit_order(symbol, side, lot, price, sl_price, tp_price, magic, comment, expires_at):
    is_buy = side == 'BUY'
    return {
        'action': mt5.TRADE_ACTION_PENDING,
        'symbol': symbol,
        'volume': float(lot),
        'type': mt5.ORDER_TYPE_BUY_LIMIT if is_buy else mt5.ORDER_TYPE_SELL_LIMIT,
        'price': float(price),
        'sl': float(sl_price),
        'tp': float(tp_price),
        'magic': magic,
        'comment': comment,
        'type_time': mt5.ORDER_TIME_SPECIFIED,
        'expiration': int(expires_at.timestamp()),
        'type_filling': mt5.ORDER_FILLING_IOC,
    }


def send_order(request, dry_run=True):
    if dry_run:
        return {'sent': False, 'dry_run': True, 'request': request}
    result = mt5.order_send(request)
    ok = result is not None and result.retcode in ACCEPTED_RETCODES
    return {
        'sent': True,
        'dry_run': False,
        'ok': ok,
        'retcode': result.retcode if result is not None else None,
        'comment': result.comment if result is not None else 'order_send returned None',
        'ticket': result.order if result is not None else None,
        'request': request,
    }


def send_with_retry(make_request, dry_run=True, max_retries=2):
    attempts = []
    for _ in range(max_retries + 1):
        request = make_request()
        result = send_order(request, dry_run=dry_run)
        attempts.append(result)
        if dry_run:
            return {'final': result, 'attempts': attempts, 'action': 'dry_run'}
        action = 'ok' if result['ok'] else classify_retcode(result['retcode'])
        if action != 'retry':
            return {'final': result, 'attempts': attempts, 'action': action}
    return {'final': attempts[-1], 'attempts': attempts, 'action': 'retry_exhausted'}


def open_positions_by_magic(symbol, magic):
    positions = mt5.positions_get(symbol=symbol) or []
    return [p for p in positions if p.magic == magic]


def build_modify_sl(symbol, position_ticket, new_sl, new_tp):
    return {
        'action': mt5.TRADE_ACTION_SLTP,
        'symbol': symbol,
        'position': int(position_ticket),
        'sl': float(new_sl),
        'tp': float(new_tp),
    }


def verify_sl(symbol, position_ticket, expected_sl, tolerance):
    positions = mt5.positions_get(ticket=int(position_ticket)) or []
    if not positions:
        return False
    return abs(positions[0].sl - float(expected_sl)) <= tolerance


def modify_sl_verified(make_request, symbol, position_ticket, expected_sl, tolerance, dry_run=True, max_retries=2):
    if dry_run:
        return {'action': 'dry_run', 'verified': None, 'request': make_request()}
    result = send_with_retry(make_request, dry_run=False, max_retries=max_retries)
    if result['action'] != 'ok':
        return {'action': result['action'], 'verified': False, 'request': result['final']['request']}
    verified = verify_sl(symbol, position_ticket, expected_sl, tolerance)
    return {'action': 'ok' if verified else 'mismatch', 'verified': verified, 'request': result['final']['request']}


def fetch_deals_for_magic(magic, since, until):
    deals = mt5.history_deals_get(since, until) or []
    return [d for d in deals if d.magic == magic]


def net_pl_by_position(deals):
    totals = {}
    for d in deals:
        net = float(d.profit) + float(getattr(d, 'commission', 0) or 0) + float(getattr(d, 'swap', 0) or 0) + float(getattr(d, 'fee', 0) or 0)
        totals[d.position_id] = totals.get(d.position_id, 0.0) + net
    return totals


def pl_drift(sim_pl, real_pl):
    return real_pl - sim_pl
