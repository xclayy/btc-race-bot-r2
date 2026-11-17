// BTC Race Bot — round 2 (btc-race-24h-20261117-0603)
//
// Dip-buy mean reversion on the forecast tilt, all-in, one position at a
// time. The tilt is the expected 4-hour log-return of cbBTC implied by the
// recent tape:
//
//   mu = -0.05 * ln(C_t / C_{t-60}) - 0.03 * ln(C_t / C_{t-240}), clamped to +-0.02
//
// A positive mu means the price has fallen over the last hour and four
// hours, so the tape implies a bounce: buy the dip. The thresholds were
// tuned on this round's frozen 24-hour dev window (1,440 bars, range-bound
// $63,874-$65,467, net +0.49%):
//
//   - Enter when mu >= 0.0003. The previous round's gated-wait entry
//     (mu >= 0.0018) never fired once on this window — its mu tops out at
//     +0.0013 — so the entry bar has to sit where dips actually happen.
//   - Take profit at +1% from the fill, trailing stop 2% once the position
//     is +0.5% up, hard stop -3%, and a 240-bar (4h) maximum hold.
//   - Circuit breaker: after the first losing trade, stop trading for the
//     rest of the window. On the dev window the bot's four trades are three
//     wins and one small loss, so the breaker never fires there; on a
//     falling tape it caps the damage instead of catching every knife.
//
// Backtest (local replay of the dev window, harness fill model: fill at the
// next bar's open, 4 bps fee, 2 bps slippage, constant-product impact
// against the bar's open depth): net PnL +$24.39, 4 trades, max drawdown
// 1.1% — comfortably above the dev gate (PnL > $0) and inside the race
// guardrails (>= 1 trade, drawdown <= 25%). The same rules on the previous
// round's dev window (a -4% downtrend day) lose only -$28.42 with the
// breaker, versus -$77 without it.
//
// Deterministic: every decision comes from the bars and the constants
// below. No clock, no environment, no randomness.

import { runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy constants (tuned on this round's dev window) ---
const ENTRY_TILT = 0.0003;
const TILT_CLAMP = 0.02;
const TAKE_PROFIT = 0.01; // +1% from the fill price
const TRAIL_ARM = 0.005; // trailing stop arms once +0.5% up
const TRAIL = 0.02; // trailing stop trails 2% below the peak
const STOP = 0.03; // hard stop -3% from the fill price
const MAX_HOLD = 240; // bars (4 hours)
const MAX_LOSSES = 1; // circuit breaker: stop after the first losing trade
const MAX_SLIPPAGE_BPS = 100;
const HISTORY_BARS = 240; // closes needed before the tilt exists

// --- state ---
const closes: number[] = [];
let entryPrice = 0; // fill price, in the raw units state.close() returns
let entrySeq = -1; // seq of the batch where the position first appeared
let peak = 0; // highest close seen while holding
let entryCash = 0n; // cash held just before the buy (to judge win / loss)
let pendingSell = false; // a sell was decided; its fill is due next batch
let losses = 0;
let stopped = false;

/** The tilt at the latest close, or null before 240 closes exist. */
function tilt(): number | null {
  const k = closes.length - 1;
  if (k < HISTORY_BARS) return null;
  const r60 = Math.log(closes[k] / closes[k - 60]);
  const r240 = Math.log(closes[k] / closes[k - HISTORY_BARS]);
  const mu = -0.05 * r60 - 0.03 * r240;
  if (mu > TILT_CLAMP) return TILT_CLAMP;
  if (mu < -TILT_CLAMP) return -TILT_CLAMP;
  return mu;
}

await runBars({
  onBatch(state: BarsState): OrderInput[] {
    if (state.warmingUp) return [];
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const close = Number(closeRaw);
    closes.push(close);

    const pos = state.positions.get(SYMBOL);

    if (pos !== undefined) {
      // Holding. If a sell was decided last batch and the position is
      // still here, that sell was rejected: clear the flag and re-decide.
      if (pendingSell) pendingSell = false;
      // First sight of the position: the buy filled on this bar.
      if (entrySeq < 0) {
        // Entry price in the same raw units state.close() returns
        // (price_scale 5): cost is quote units (1e-6 USDC), qty is 1e-8
        // BTC, so price_raw = cost * 1e7 / qty. (cost includes the 4 bps
        // fee, so this sits ~4 bps above the true fill — immaterial
        // against the 1% / 3% exits.)
        entryPrice = (Number(pos.cost) * 10_000_000) / Number(pos.qty);
        entrySeq = state.seq;
        peak = close;
      }
      if (close > peak) peak = close;

      const takeProfit = close >= entryPrice * (1 + TAKE_PROFIT);
      const trailing =
        peak >= entryPrice * (1 + TRAIL_ARM) && close <= peak * (1 - TRAIL);
      const stopOut = close <= entryPrice * (1 - STOP);
      const heldTooLong = state.seq - entrySeq >= MAX_HOLD;
      if (takeProfit || trailing || stopOut || heldTooLong) {
        pendingSell = true;
        return [
          {
            side: 'sell',
            symbol: SYMBOL,
            qty: pos.qty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    // Flat. If a sell was decided last batch and the position is gone, it
    // filled: judge it against the cash held before the buy.
    if (pendingSell) {
      pendingSell = false;
      if (state.cash < entryCash) {
        losses += 1;
        if (losses >= MAX_LOSSES) stopped = true;
      }
    }

    if (stopped) return [];
    const mu = tilt();
    if (mu === null || mu < ENTRY_TILT) return [];

    // All in: spend the cash, capped by the weight room (100% of equity).
    const room = state.weightRoom(SYMBOL);
    const notional = state.cash < room ? state.cash : room;
    if (notional <= 0n) return [];
    entryCash = state.cash;
    entrySeq = -1;
    entryPrice = 0;
    peak = 0;
    const order: BuyInput = {
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: notional,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
    return [order];
  },
});
