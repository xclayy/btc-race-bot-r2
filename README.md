# BTC Race Bot — Round 2, v4

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

A dip-reversion bot for [make.fun's BTC race round 2](https://make.fun/bounty/btc-race-24h-20261117-0603): it trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain prices with $1,000 of paper money.

## Results (kit `grade-local`, process driver)

| Window | Net PnL | Trades | Win rate | Max DD | Fees | Rejected |
| --- | --- | --- | --- | --- | --- | --- |
| Round-2 dev (new) | **+$34.51 (+3.45%)** | 3 round trips | 100% | 0.64% | $2.45 | 0 |
| Round-1 dev (downtrend −4%) | −$2.81 | 1 | 0% | 1.22% | $0.80 | 0 |

Deterministic: two grade runs produce byte-identical action logs. The round-2 dev PnL clearly beats the previous entry v3 (+$28.39).

## Strategy

The dev day is choppy and range-bound, so the money is in buying sharp dips and letting the rebound run. The entry signal is a mean-reversion tilt from two log-return horizons (30 minutes and 8 hours):

```
mu = -0.10 * ln(C / C30) - 0.05 * ln(C / C480)
```

Enter all-in when `mu >= 0.0005`, with two guards:

1. **Deceleration filter** — the tilt must be lower than it was 20 bars ago, so the bot buys a dip that is easing, not one still accelerating into a waterfall. (When the bot has only just gathered enough history for the reference tilt, the entry goes through.)
2. **Circuit breaker** — one losing trade stops all trading, which is what keeps the bot nearly flat on a downtrend day (round-1 window: a single −$2.81 trade, then done).

Exits, all measured from the actual fill price: take-profit +1.8%, a trailing stop of 1% armed at +0.3%, a hard stop at −0.8%, and a maximum hold of 480 bars (8 hours). No clock, no randomness, no environment reads — the bot is fully deterministic.

## Robustness

Threshold sensitivity on the round-2 dev window (entry tilt ±15%): +$33.98 / +$34.50 — a flat plateau, not a spike. The round-1 loss is identical to v3's (−$2.81), and both halves of the round-2 window were checked (first half +$23.77). Multi-arm / scale-in variants were explored and did not beat this single all-in design on this window: fractional sizing dilutes the big swings, and the shallow dips here rarely deepen enough for later arms to add value.

## Files

- `main.ts` — the bot (Node 22, TypeScript via type stripping).
- `vendor/makefun-bars.ts` — the kit's protocol shim, copied byte-identical.
- `LICENSE` — MIT.

## License

MIT — see `LICENSE`.
