import { describe, expect, it } from "vitest"

import { costOf, summariseCost, type Rates } from "./run-cost"

// Round numbers, so a wrong formula shows as a wrong number and not as
// rounding noise. The real rates live in cost-rates.ts.
const rates: Rates = {
  browserHourUsd: 0.12,
  inputPerMillionUsd: 5,
  outputPerMillionUsd: 25,
  cachedInputPerMillionUsd: 0.5,
}

const priced = {
  sessionSeconds: 3600,
  promptTokens: 1_000_000,
  completionTokens: 1_000_000,
  reasoningTokens: 0,
  cachedInputTokens: 0,
}

describe("costOf", () => {
  it("prices an hour of browser at the browser-hour rate", () => {
    expect(
      costOf({ ...priced, promptTokens: 0, completionTokens: 0 }, rates)
    ).toBeCloseTo(0.12, 6)
  })

  it("prices a million tokens each way", () => {
    expect(costOf({ ...priced, sessionSeconds: 0 }, rates)).toBeCloseTo(30, 6)
  })

  it("adds the two halves", () => {
    expect(costOf(priced, rates)).toBeCloseTo(30.12, 6)
  })

  it("prices cached input at its own, cheaper rate", () => {
    const cached = {
      ...priced,
      sessionSeconds: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedInputTokens: 1_000_000,
    }

    expect(costOf(cached, rates)).toBeCloseTo(0.5, 6)
  })

  // The trap this test exists for. Stagehand copies the four counters
  // straight from the provider, and a provider that reports thinking tokens
  // reports them inside output as well as separately. Adding them would bill
  // the same tokens twice.
  it("does not bill reasoning tokens on top of completion tokens", () => {
    const reasoned = {
      ...priced,
      sessionSeconds: 0,
      promptTokens: 0,
      completionTokens: 1_000_000,
      reasoningTokens: 400_000,
    }

    expect(costOf(reasoned, rates)).toBeCloseTo(25, 6)
  })

  it("charges nothing for a run that consumed nothing", () => {
    const empty = {
      sessionSeconds: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    }

    expect(costOf(empty, rates)).toBe(0)
  })

  // A null is "not recorded", which is not the same as zero. Treating it as
  // zero would quietly report a run as cheaper than it was.
  it("says nothing about a run with nothing recorded", () => {
    const unrecorded = {
      sessionSeconds: null,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
    }

    expect(costOf(unrecorded, rates)).toBeNull()
  })

  // Half a reading is still a reading: the session is known even when the
  // tokens are not, and that half is worth pricing.
  it("prices the half it has", () => {
    const halfKnown = {
      sessionSeconds: 3600,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
    }

    expect(costOf(halfKnown, rates)).toBeCloseTo(0.12, 6)
  })
})

describe("summariseCost", () => {
  it("has nothing to say about no runs", () => {
    expect(summariseCost([], rates)).toMatchObject({
      priced: 0,
      totalUsd: null,
      meanUsd: null,
    })
  })

  it("totals and averages only the runs it could price", () => {
    const summary = summariseCost(
      [
        priced,
        { ...priced, sessionSeconds: 0 },
        {
          sessionSeconds: null,
          promptTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          cachedInputTokens: null,
        },
      ],
      rates
    )

    expect(summary.priced).toBe(2)
    expect(summary.unpriced).toBe(1)
    expect(summary.totalUsd).toBeCloseTo(60.12, 6)
    // Divided by the two it priced, not by the three it saw.
    expect(summary.meanUsd).toBeCloseTo(30.06, 6)
  })

  it("reports the browser and model halves apart", () => {
    const summary = summariseCost([priced], rates)

    expect(summary.browserUsd).toBeCloseTo(0.12, 6)
    expect(summary.modelUsd).toBeCloseTo(30, 6)
  })
})
