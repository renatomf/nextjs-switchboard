// The schedules a workflow can run on. A few presets rather than a free cron
// expression: each runs at most once an hour, so no one can schedule a browser
// session a minute by mistake, and there is no cron syntax to validate.
export type SchedulePreset =
  | { frequency: "hourly"; minute: number }
  | { frequency: "daily"; hour: number; minute: number }
  | { frequency: "weekly"; dayOfWeek: number; hour: number; minute: number }

type ScheduleInput = {
  preset: SchedulePreset
  // An IANA time zone, such as "America/Sao_Paulo". Trigger.dev follows its
  // daylight saving changes.
  timezone: string
}

// The project's Trigger.dev plan allows 10 schedules across all of its
// environments, so each organization gets a small share.
export const MAX_SCHEDULES_PER_ORG = 2

// The Trigger.dev task every workflow schedule is attached to. Named here
// rather than read off the task, so the app can refer to it without importing
// the worker's code.
export const SCHEDULED_WORKFLOW_TASK_ID = "run-scheduled-workflow"

// The cron expression Trigger.dev runs a preset on. Cron counts the days of
// the week from Sunday, as 0, like dayOfWeek does.
export function cronFor(preset: SchedulePreset): string {
  switch (preset.frequency) {
    case "hourly":
      return `${preset.minute} * * * *`
    case "daily":
      return `${preset.minute} ${preset.hour} * * *`
    case "weekly":
      return `${preset.minute} ${preset.hour} * * ${preset.dayOfWeek}`
  }
}

// Trigger.dev keys a schedule's deduplication per project, not per
// environment, and development and production share one database, so the
// same workflow exists in both. Without the environment in the key, saving
// the workflow's schedule in one would take over the other's.
export function scheduleDeduplicationKey(
  environment: string,
  workflowId: string
): string {
  return `${environment}:workflow:${workflowId}`
}

type ParsedSchedule =
  { ok: true; schedule: ScheduleInput } | { ok: false; problem: string }

// Checks what the browser sent before it reaches Trigger.dev or the database.
// Only the fields the preset uses are kept, so a stray one cannot ride along.
export function parseScheduleInput(input: unknown): ParsedSchedule {
  if (typeof input !== "object" || input === null) {
    return { ok: false, problem: "Not a schedule" }
  }

  const { preset, timezone } = input as Record<string, unknown>

  if (!isTimeZone(timezone)) {
    return { ok: false, problem: "Unknown time zone" }
  }

  const parsedPreset = parsePreset(preset)

  if (!parsedPreset) {
    return { ok: false, problem: "Not a schedule this app offers" }
  }

  return { ok: true, schedule: { preset: parsedPreset, timezone } }
}

function parsePreset(value: unknown): SchedulePreset | null {
  if (typeof value !== "object" || value === null) return null

  const { frequency, minute, hour, dayOfWeek } = value as Record<
    string,
    unknown
  >

  if (!isIntegerIn(minute, 0, 59)) return null
  if (frequency === "hourly") return { frequency, minute }

  if (!isIntegerIn(hour, 0, 23)) return null
  if (frequency === "daily") return { frequency, hour, minute }

  if (frequency === "weekly" && isIntegerIn(dayOfWeek, 0, 6)) {
    return { frequency, dayOfWeek, hour, minute }
  }

  return null
}

const isIntegerIn = (
  value: unknown,
  min: number,
  max: number
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max

// Whether a time zone exists, by the runtime's own list: Intl refuses to
// format in one it does not know.
function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}
