import { describe, expect, it } from "vitest"

import {
  cronFor,
  MAX_SCHEDULES_PER_ORG,
  parseScheduleInput,
  scheduleDeduplicationKey,
} from "./schedule-presets"

// A workflow runs on a schedule picked from a few presets, never a free cron
// expression: every preset runs at most once an hour, so no one can schedule
// a browser session a minute by mistake.
describe("cronFor", () => {
  it("runs an hourly schedule at its minute past every hour", () => {
    expect(cronFor({ frequency: "hourly", minute: 15 })).toBe("15 * * * *")
  })

  it("runs a daily schedule at its time every day", () => {
    expect(cronFor({ frequency: "daily", hour: 9, minute: 30 })).toBe(
      "30 9 * * *"
    )
  })

  // Cron counts the days of the week from Sunday, as 0.
  it("runs a weekly schedule at its time on its day", () => {
    expect(
      cronFor({ frequency: "weekly", dayOfWeek: 1, hour: 8, minute: 0 })
    ).toBe("0 8 * * 1")
  })
})

// What the browser sends is untrusted: it is checked here before it reaches
// Trigger.dev or the database.
describe("parseScheduleInput", () => {
  it("takes a well-formed schedule", () => {
    expect(
      parseScheduleInput({
        preset: { frequency: "daily", hour: 9, minute: 30 },
        timezone: "America/Sao_Paulo",
      })
    ).toEqual({
      ok: true,
      schedule: {
        preset: { frequency: "daily", hour: 9, minute: 30 },
        timezone: "America/Sao_Paulo",
      },
    })
  })

  // Only what the preset uses is kept, so a stray field cannot ride along
  // into the row.
  it("drops fields the preset does not use", () => {
    const parsed = parseScheduleInput({
      preset: { frequency: "hourly", minute: 5, hour: 3, cron: "* * * * *" },
      timezone: "UTC",
    })

    expect(parsed).toEqual({
      ok: true,
      schedule: { preset: { frequency: "hourly", minute: 5 }, timezone: "UTC" },
    })
  })

  it.each([
    ["an unknown frequency", { frequency: "minutely", minute: 0 }],
    ["a minute past 59", { frequency: "hourly", minute: 60 }],
    ["a negative minute", { frequency: "hourly", minute: -1 }],
    ["a fractional minute", { frequency: "hourly", minute: 1.5 }],
    ["an hour past 23", { frequency: "daily", hour: 24, minute: 0 }],
    ["a missing hour", { frequency: "daily", minute: 0 }],
    [
      "a day of the week past 6",
      { frequency: "weekly", dayOfWeek: 7, hour: 8, minute: 0 },
    ],
    ["a time given as text", { frequency: "daily", hour: "9", minute: 0 }],
  ])("refuses %s", (_case, preset) => {
    expect(parseScheduleInput({ preset, timezone: "UTC" })).toMatchObject({
      ok: false,
    })
  })

  it("refuses a time zone that does not exist", () => {
    expect(
      parseScheduleInput({
        preset: { frequency: "hourly", minute: 0 },
        timezone: "Mars/Olympus_Mons",
      })
    ).toMatchObject({ ok: false })
  })

  it("refuses something that is not a schedule at all", () => {
    expect(parseScheduleInput(null)).toMatchObject({ ok: false })
    expect(parseScheduleInput("0 * * * *")).toMatchObject({ ok: false })
  })
})

// Trigger.dev keys a schedule's deduplication per project, not per
// environment, and development and production share one database: the same
// workflow must not end up with a single schedule both environments fight
// over.
describe("scheduleDeduplicationKey", () => {
  it("is unique to the workflow and the environment", () => {
    expect(scheduleDeduplicationKey("prod", "wf_1")).toBe("prod:workflow:wf_1")
    expect(scheduleDeduplicationKey("dev", "wf_1")).not.toBe(
      scheduleDeduplicationKey("prod", "wf_1")
    )
  })
})

// The project's Trigger.dev plan allows 10 schedules across every
// environment, so each organization gets a small share of them.
describe("MAX_SCHEDULES_PER_ORG", () => {
  it("leaves room for more than one organization", () => {
    expect(MAX_SCHEDULES_PER_ORG).toBeLessThanOrEqual(3)
  })
})
