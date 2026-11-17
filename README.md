# BTC Race Bot — Round 2

[![Make.fun bounty](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Rank](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Reward](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

A dip-buy mean-reversion bot for make.fun's "Race a BTC trading bot live for
24 hours" (round 2, 17 Nov 2026). It trades Coinbase Wrapped BTC (cbBTC) on
1-minute on-chain bars with $1,000 paper money, long-only, one position at a
time.

## Strategy

The signal is a mean-reversion tilt from the log returns over the last hour
and the last four hours:

```
mu = -0.05 * ln(C_t / C_{t-60}) - 0.03 * ln(C_t / C_{t-240}), clamped to ±0.02
```

A positive mu means the price has fallen recently, so the tape implies a
bounce: buy the dip. The bot goes all in when `mu >= 0.0003`, then exits on
any of:

- take profit at **+1%** from the fill price,
- trailing stop **2%** below the peak once the position is **+0.5%** up,
- hard stop **-3%** from the fill price,
- maximum hold of **240 bars** (4 hours).

A circuit breaker stops all trading after the first losing trade. On this
round's frozen 24-hour dev window (range-bound, $63,874–$65,467) the bot's
four trades are three wins and one small loss, so the breaker never fires
there; on a falling tape it caps the damage instead of catching every knife.

## Why this threshold

The previous round's gated-wait entry (buy only when `mu >= 0.0018`) never
fired once on this window — the tilt tops out at +0.0013 here — and finished
the live race unranked with 0 trades. This round's entry bar sits where dips
actually happen: `mu >= 0.0003` triggers several times a day.

## Results (local grade on the dev window)

```
net PnL        +$25.05 (+2.50%)
trades         4 (win rate 0.75)
max drawdown   1.1%
dev gate       PASS (PnL > $0)
guardrails     PASS (>= 1 trade, drawdown <= 25%)
determinism    PASS (two runs, byte-identical action logs)
```

The same rules on the previous round's dev window (a -4% downtrend day) lose
only -$28.42 with the circuit breaker, versus -$77 without it.

## Files

- `main.ts` — the bot (TypeScript, Node 22, stdlib only)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte-for-byte
- `research/` — the Python backtester and sweep logs used to tune the
  thresholds on the dev window

## Run it

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot main.ts --driver process
```
