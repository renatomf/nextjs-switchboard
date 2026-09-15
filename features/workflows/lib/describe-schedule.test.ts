import { describe, expect, it } from "vitest"

import { describeSchedule } from "./schedule-presets"

// How the Schedule tab tells the user when a workflow runs.
describe("describeSchedule", () => {
  it("says the minute past the hour of an hourly schedule", () => {
    expect(describeSchedule({ frequency: "hourly", minute: 5 }, "UTC")).toBe(
      "Every hour at :05 (UTC)"
    )
  })

  it("says the time of a daily schedule, on the 24-hour clock", () => {
    expect(
      describeSchedule(
        { frequency: "daily", hour: 9, minute: 30 },
        "America/Sao_Paulo"
      )
    ).toBe("Every day at 09:30 (America/Sao_Paulo)")
  })

  it.each([
    [0, "Sunday"],
    [1, "Monday"],
    [6, "Saturday"],
  ])("names day %i of a weekly schedule %s", (dayOfWeek, day) => {
    expect(
      describeSchedule(
        { frequency: "weekly", dayOfWeek, hour: 8, minute: 0 },
        "Europe/Lisbon"
      )
    ).toBe(`Every ${day} at 08:00 (Europe/Lisbon)`)
  })
})
