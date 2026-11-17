// BTC Race Bot — Round 2, variant v2.
//
// A dip-buy mean-reversion bot for make.fun's "Race a BTC trading bot live
// for 24 hours" (round 2, 17 Nov 2026). It trades Coinbase Wrapped BTC
// (cbBTC) on 1-minute on-chain bars with $1,000 of paper money, long only,
// one position at a time.
//
// The idea: buy a dip only when the tape has fallen over several hours, then
// let the bounce run. The signal is a mean-reversion tilt built from the log
// returns over the last 2 hours and the last 8 hours:
//
//   mu = -0.07 * ln(C_t / C_{t-120}) - 0.02 * ln(C_t / C_{t-480}), clamped to +-0.02
//
// A positive mu means the price has fallen recently, so the tape implies a
// bounce. The 8-hour leg is what keeps the bot out of trouble: on a falling
// day the short windows fire on every little dip and bleed, while the long
// window only fires on a real multi-hour washout. The bot goes all in when
// mu >= 0.0003, then exits on any of:
//
//   - take profit at +1.8% from the fill price,
//   - trailing stop 1% below the peak once the position is +0.3% up,
//   - hard stop -1.5% from the fill price,
//   - maximum hold of 360 bars (6 hours).
//
// Two guards keep one bad day from sinking the race:
//
//   - a circuit breaker stops all trading after the first losing trade;
//   - a 60-bar cooldown after every exit, so the bot never re-buys the same
//     dip it just sold.
//
// All prices the bot compares are raw units (the shim's close() returns the
// price at price_scale 5), and the entry price is rebuilt from the position's
// own cost and quantity, so the units always match. No clock, no randomness,
// no environment: two runs on the same data produce the same orders.

import { runBars, type BarsState, type Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Tilt windows, in bars (1 bar = 1 minute).
const SHORT_WINDOW = 120; // 2 hours
const LONG_WINDOW = 480; // 8 hours
const SHORT_WEIGHT = 0.07;
const LONG_WEIGHT = 0.02;
const TILT_CLAMP = 0.02;
const ENTRY_TILT = 0.0003;

// Exits, as fractions of the entry price.
const TAKE_PROFIT = 0.018;
const TRAIL_ARM = 0.003;
const TRAIL_DROP = 0.01;
const HARD_STOP = 0.015;
const MAX_HOLD_BARS = 360;

// Guards.
const LOSING_TRADES_TO_STOP = 1;
const COOLDOWN_BARS = 60;
const MAX_SLIPPAGE_BPS = 100;

interface Position {
  qty: bigint;
  cost: bigint;
  entryRaw: bigint;
  entrySeq: number;
  peakRaw: bigint;
  armed: boolean;
}

const closes: number[] = [];
let position: Position | null = null;
let prevQty = 0n;
let losses = 0;
let cooldownUntil = -1;
let buyNotional = 0n;

function tilt(): number | null {
  const n = closes.length;
  if (n <= LONG_WINDOW) return null;
  const now = closes[n - 1]!;
  const short = closes[n - 1 - SHORT_WINDOW]!;
  const long = closes[n - 1 - LONG_WINDOW]!;
  let mu =
    -SHORT_WEIGHT * Math.log(now / short) -
    LONG_WEIGHT * Math.log(now / long);
  if (mu > TILT_CLAMP) mu = TILT_CLAMP;
  if (mu < -TILT_CLAMP) mu = -TILT_CLAMP;
  return mu;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(Number(close));

    // Rebuild the position from the account the harness just sent.
    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;
    if (qty > 0n && held !== undefined) {
      if (position === null) {
        const cost = held.cost;
        position = {
          qty,
          cost,
          entryRaw: (cost * 10n ** 7n) / qty,
          entrySeq: state.seq,
          peakRaw: close,
          armed: false,
        };
      } else {
        position.qty = qty;
        position.cost = held.cost;
        if (close > position.peakRaw) position.peakRaw = close;
      }
    }
    // A position that just closed: score the leg and arm the cooldown.
    if (prevQty > 0n && qty === 0n) {
      const proceeds = batch.fills
        .filter((f) => f.side === 'sell' && f.status === 'filled')
        .reduce((sum, f) => sum + BigInt(f.notional_quote_units), 0n);
      if (proceeds > 0n && proceeds < buyNotional) losses += 1;
      position = null;
      cooldownUntil = state.seq + COOLDOWN_BARS;
    }
    prevQty = qty;

    if (position !== null) {
      const p = position;
      if (!p.armed && p.peakRaw >= (p.entryRaw * 1003n) / 1000n) p.armed = true;
      const takeProfit = (p.entryRaw * 1018n) / 1000n;
      const hardStop = (p.entryRaw * 985n) / 1000n;
      const trailLine = (p.peakRaw * 99n) / 100n;
      const heldTooLong = state.seq - p.entrySeq >= MAX_HOLD_BARS;
      if (
        close >= takeProfit ||
        (p.armed && close <= trailLine) ||
        close <= hardStop ||
        heldTooLong
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty: p.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: look for a dip worth buying.
    if (losses >= LOSING_TRADES_TO_STOP) return [];
    if (state.seq < cooldownUntil) return [];
    const mu = tilt();
    if (mu === null || mu < ENTRY_TILT) return [];
    if (state.cash <= 0n) return [];
    buyNotional = state.cash;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
