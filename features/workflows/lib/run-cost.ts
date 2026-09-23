// What a run cost, from the quantities the executions table records. Pure: it
// takes rows and rates and returns money, so both the arithmetic and the rules
// about missing readings are testable without a database or a price list.
//
// Rates are a parameter, never a constant in here. Prices move, and a rate
// baked into the formula would make every past number unrecomputable. The
// current table lives in cost-rates.ts, with its source and the date it was
// checked.

// Only the fields the money needs. Each is null until something records it,
// and null means "not known", which is not the same as zero — a run that
// called no model and a run whose counts never arrived cost different amounts,
// and only one of them cost nothing.
export type PricedExecution = {
  sessionSeconds: number | null
  promptTokens: number | null
  completionTokens: number | null
  reasoningTokens: number | null
  cachedInputTokens: number | null
}

export type Rates = {
  // What Browserbase charges to keep a browser open, per hour.
  browserHourUsd: number
  inputPerMillionUsd: number
  outputPerMillionUsd: number
  // Input served from the provider's cache, billed at its own cheaper rate.
  cachedInputPerMillionUsd: number
}

export type CostSummary = {
  // Runs that could be priced at all, and runs where nothing was recorded.
  priced: number
  unpriced: number
  // How many contributed to each half. Reported because they differ: a run can
  // have its session measured and its tokens missing, and a total built from
  // the first without the second is an understatement, not an error.
  withSession: number
  withTokens: number
  totalUsd: number | null
  meanUsd: number | null
  browserUsd: number
  modelUsd: number
}

const SECONDS_PER_HOUR = 3600
const PER_MILLION = 1_000_000

// What Browserbase charged to hold the browser open.
function browserCostOf(execution: PricedExecution, rates: Rates): number {
  if (execution.sessionSeconds === null) return 0

  return (execution.sessionSeconds / SECONDS_PER_HOUR) * rates.browserHourUsd
}

// What the models charged.
//
// Reasoning tokens are deliberately not added. Stagehand copies the four
// counters straight from whatever the provider reported, and a provider that
// bills thinking as output has already counted those tokens inside completion
// — adding them here would bill the same tokens twice. They are recorded so
// the share of thinking is visible, not so it is charged again.
function modelCostOf(execution: PricedExecution, rates: Rates): number {
  const prompt = execution.promptTokens ?? 0
  const completion = execution.completionTokens ?? 0
  const cached = execution.cachedInputTokens ?? 0

  return (
    (prompt * rates.inputPerMillionUsd +
      completion * rates.outputPerMillionUsd +
      cached * rates.cachedInputPerMillionUsd) /
    PER_MILLION
  )
}

// Whether the row says anything at all. A row with every field null was never
// measured, and pricing it as zero would report a run that cost money as free.
function hasAnyReading(execution: PricedExecution): boolean {
  return (
    execution.sessionSeconds !== null ||
    execution.promptTokens !== null ||
    execution.completionTokens !== null ||
    execution.cachedInputTokens !== null
  )
}

// What this run cost, or nothing when the row cannot say. A row that knows one
// half is priced on that half: an incomplete number that is right about what it
// covers beats no number, as long as the summary says how many rows each half
// came from.
export function costOf(
  execution: PricedExecution,
  rates: Rates
): number | null {
  if (!hasAnyReading(execution)) return null

  return browserCostOf(execution, rates) + modelCostOf(execution, rates)
}

export function summariseCost(
  executions: PricedExecution[],
  rates: Rates
): CostSummary {
  const readable = executions.filter(hasAnyReading)

  const browserUsd = readable.reduce(
    (total, execution) => total + browserCostOf(execution, rates),
    0
  )
  const modelUsd = readable.reduce(
    (total, execution) => total + modelCostOf(execution, rates),
    0
  )

  const totalUsd = browserUsd + modelUsd

  return {
    priced: readable.length,
    unpriced: executions.length - readable.length,
    withSession: readable.filter((e) => e.sessionSeconds !== null).length,
    withTokens: readable.filter((e) => e.promptTokens !== null).length,
    // null rather than 0 when nothing could be priced: no runs and free runs
    // are different facts, and zero says the second.
    totalUsd: readable.length === 0 ? null : totalUsd,
    meanUsd: readable.length === 0 ? null : totalUsd / readable.length,
    browserUsd,
    modelUsd,
  }
}
