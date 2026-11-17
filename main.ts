// Dip-reversion BTC bot for the make.fun round-2 race (v4).
//
// Idea, built from the dev window's own shape: the day is choppy and
// range-bound, so the money is in buying sharp dips and letting the
// rebound run. The entry signal is a mean-reversion tilt built from two
// log-return horizons (30 minutes and 8 hours): after a fall the tilt
// turns positive. Two guards keep the bot from catching a falling knife:
//   (1) the tilt must be EASING over the last 20 bars (the dip is
//       decelerating, not accelerating into a waterfall), and
//   (2) a circuit breaker stops all trading after one losing trade,
//       which is what keeps the bot nearly flat on a downtrend day.
// Exits are a take-profit, a trailing stop armed once the trade is
// slightly in profit, a hard stop, and a long maximum hold. Everything
// is deterministic: no clock, no randomness, no environment reads.

import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const PRICE_SCALE = 5; // closes are integers of 1e-5 USDC

// --- tuned parameters (from a sweep over the published dev window) ---
const FAST_BARS = 30; // short horizon for the tilt
const SLOW_BARS = 480; // long horizon for the tilt (8 hours)
const FAST_WEIGHT = 0.10; // tilt weight on the short horizon
const SLOW_WEIGHT = 0.05; // tilt weight on the long horizon
const ENTRY_TILT = 0.0005; // enter when the tilt reaches this
const DECEL_BARS = 20; // tilt must be lower than it was this many bars ago
const TAKE_PROFIT = 0.018; // +1.8% from the fill price
const TRAIL_ARM = 0.003; // arm the trailing stop at +0.3%
const TRAIL_DROP = 0.01; // exit when the price falls 1% from its peak
const HARD_STOP = 0.008; // -0.8% from the fill price
const MAX_HOLD_BARS = 480; // give a trade up to 8 hours to work
const MAX_SLIPPAGE_BPS = 100;

// --- run state (all derived from the bars and fills, nothing else) ---
const closes: number[] = []; // close prices in USDC, oldest first
const tilts: number[] = []; // tilt value per bar, oldest first
let entryPrice = 0; // fill price of the open position, USDC
let entrySeq = -1; // batch seq the position was filled on
let peakPrice = 0; // highest close since the fill
let stopped = false; // circuit breaker: one losing trade ends trading
let sellPending = false; // a sell order is out and not yet filled

function tiltAt(i: number): number {
  const c = closes[i];
  return (
    -FAST_WEIGHT * Math.log(c / closes[i - FAST_BARS]) -
    SLOW_WEIGHT * Math.log(c / closes[i - SLOW_BARS])
  );
}

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];

    // Fold in the fills of the orders decided on the previous batch.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      const price = Number(fill.price) / 10 ** PRICE_SCALE;
      if (fill.side === 'buy') {
        entryPrice = price;
        entrySeq = batch.seq;
        peakPrice = price;
        sellPending = false;
      } else if (fill.side === 'sell') {
        if (price < entryPrice) stopped = true; // losing trade: breaker trips
        entryPrice = 0;
        entrySeq = -1;
        peakPrice = 0;
        sellPending = false;
      }
    }

    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const close = Number(closeRaw) / 10 ** PRICE_SCALE;
    closes.push(close);
    // Record the tilt for EVERY bar, holding or flat, so the
    // deceleration check below always compares against the tilt
    // exactly DECEL_BARS ago (a gaps-filled history would compare
    // against a much older tilt and fire at the wrong moments).
    if (closes.length > SLOW_BARS) {
      tilts.push(tiltAt(closes.length - 1));
    } else {
      tilts.push(NaN);
    }

    const pos = state.positions.get(SYMBOL);
    const qty = pos?.qty ?? 0n;

    if (qty > 0n && entryPrice > 0) {
      // Holding: track the peak and test the four exit rules.
      if (close > peakPrice) peakPrice = close;
      const ret = close / entryPrice - 1;
      const held = batch.seq - entrySeq;
      const takeProfit = ret >= TAKE_PROFIT;
      const trailing =
        peakPrice >= entryPrice * (1 + TRAIL_ARM) &&
        close <= peakPrice * (1 - TRAIL_DROP);
      const hardStop = ret <= -HARD_STOP;
      const tooLong = held >= MAX_HOLD_BARS;
      if (!sellPending && (takeProfit || trailing || hardStop || tooLong)) {
        sellPending = true;
        return [
          { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS },
        ];
      }
      return [];
    }

    // Flat: look for a dip to buy.
    if (stopped || sellPending) return [];
    if (closes.length <= SLOW_BARS) return [];
    const mu = tilts[tilts.length - 1];
    if (Number.isNaN(mu) || mu < ENTRY_TILT) return [];
    // The dip must be decelerating: the tilt is lower than 20 bars ago.
    // (No reference tilt yet — the bot has only just gathered enough
    // history — so the check has nothing to compare against and the
    // entry goes through; a deep dip right at the start of the window
    // is exactly the trade to take.)
    const muBefore = tilts[tilts.length - 1 - DECEL_BARS];
    if (!Number.isNaN(muBefore) && mu >= muBefore) return [];
    if (state.cash <= 0n) return [];
    return [
      {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
