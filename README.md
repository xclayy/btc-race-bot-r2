# BTC Race Bot — Round 2, v2

[![Make.fun bounty](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Rank](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Reward](https://make.fun/badge/btc-race-24h-20261117-0603/xclayy/btc-race-bot-r2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

A dip-buy mean-reversion bot for make.fun's "Race a BTC trading bot live for
24 hours" (round 2, 17 Nov 2026). It trades Coinbase Wrapped BTC (cbBTC) on
1-minute on-chain bars with $1,000 paper money, long-only, one position at a
time. This is the v2 variant: a stronger, more patient version of the v1 bot
that also raced this round.

## Strategy

The signal is a mean-reversion tilt from the log returns over the last 2 hours
and the last 8 hours:

```
mu = -0.07 * ln(C_t / C_{t-120}) - 0.02 * ln(C_t / C_{t-480}), clamped to ±0.02
```

A positive mu means the price has fallen recently, so the tape implies a
bounce: buy the dip. The 8-hour leg is what keeps the bot out of trouble: on
a falling day the short windows fire on every little dip and bleed, while the
long window only fires on a real multi-hour washout. The bot goes all in when
`mu >= 0.0003`, then exits on any of:

- take profit at **+1.8%** from the fill price,
- trailing stop **1%** below the peak once the position is **+0.3%** up,
- hard stop **-1.5%** from the fill price,
- maximum hold of **360 bars** (6 hours).

Two guards keep one bad day from sinking the race:

- a circuit breaker stops all trading after the first losing trade;
- a 60-bar cooldown after every exit, so the bot never re-buys the same dip
  it just sold.

## Why v2 beats v1

The v1 bot (same tilt family, 1h/4h windows, take-profit +1%, hard stop -3%,
max hold 240 bars) made **+$25.05** on this round's frozen dev window but lost
**-$28.42** on the previous round's dev window (a -4% downtrend day). v2
catches the same dips with a longer, quieter signal and lets the bounce run
further, while the tighter stop and the breaker cap the damage on a falling
tape.

## Results (local grade on the dev window)

```
net PnL        +$28.39 (+2.84%)
trades         3 (win rate 0.67)
max drawdown   1.02%
dev gate       PASS (PnL > $0)
guardrails     PASS (>= 1 trade, drawdown <= 25%)
determinism    PASS (two runs, byte-identical action logs)
```

Robustness (same rules, other windows):

```
round-1 dev window (-4% day)   -$2.81  (v1: -$28.42)
first half of this window      +$21.97
second half of this window     +$2.65
this window reversed           +$11.35
```

## Files

- `main.ts` — the bot (TypeScript, Node 22, stdlib only)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte-for-byte
- `research/` — the Python backtester and sweep logs used to tune the
  thresholds on the dev window

## Run it

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot main.ts --driver process
```
