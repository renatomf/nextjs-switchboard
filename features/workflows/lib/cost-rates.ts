import type { Rates } from "./run-cost"

// What the platform is charged, per unit, as of the date below. Data, not
// logic: run-cost.ts takes these as a parameter so a price change is an edit
// here and nothing else, and so the arithmetic can be tested against round
// numbers instead of against whatever the market does this quarter.
//
// Every number carries where it came from. A rate without a source is a guess
// that looks like a fact six months later.

// Browserbase, Developer plan: 100 browser hours included, then this per hour.
// https://www.browserbase.com/pricing — checked 2026-09-22.
//
// This is the overage rate, so it prices the marginal run, not the included
// ones. Good enough for "what did this week cost to run" and wrong for "what
// is the invoice" — the invoice is the plan fee until the included hours run
// out. Worth revisiting if usage ever approaches 100 hours a month; at the
// current rate of a few minutes a week it is nowhere near.
const BROWSER_HOUR_USD = 0.12

// The models this project runs are all on free tiers, so their tokens cost
// nothing. Recorded as an explicit zero rather than skipped, because zero is a
// price — and because the day one of these moves to a paid tier, the change is
// one number here and no change anywhere else.
//
// Gemini free tier: input and output free of charge.
// https://ai.google.dev/gemini-api/docs/pricing — checked 2026-09-22.
// For reference, were it paid: gemini-3.8-flash is $0.75/M in, $3.75/M out.
//
// Ollama runs on the machine the worker is on, so there is no per-token
// charge at all — only electricity, which nothing here measures.
const FREE_TOKENS = {
  inputPerMillionUsd: 0,
  outputPerMillionUsd: 0,
  cachedInputPerMillionUsd: 0,
}

// What the weekly report prices with.
//
// One table, not one per model, because every model in use is free: there is
// nothing for a model-aware table to tell apart. The executions table does not
// record which model ran, and while the token rate is zero that costs nothing.
// It stops being free the moment a paid model is configured — and that is the
// moment to record the model per row, before the counts it would price start
// arriving.
export const CURRENT_RATES: Rates = {
  browserHourUsd: BROWSER_HOUR_USD,
  ...FREE_TOKENS,
}
