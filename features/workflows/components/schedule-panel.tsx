"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { CalendarClock, Lock } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  deleteWorkflowScheduleAction,
  saveWorkflowScheduleAction,
} from "@/features/workflows/actions"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import {
  describeSchedule,
  WEEKDAY_NAMES,
  type SchedulePreset,
} from "@/features/workflows/lib/schedule-presets"
import { validateGraph } from "@/features/workflows/lib/validate-graph"
import type { StepNodeType } from "@/features/workflows/nodes/node-registry"
import type { WorkflowSchedule } from "@/lib/db/schema"
import { cn } from "@/lib/utils"

// What the page knows of a workflow's schedule: enough to show it, and to
// fill the form with it.
export type ScheduleSummary = Pick<
  WorkflowSchedule,
  "preset" | "timezone" | "active"
>

type Frequency = SchedulePreset["frequency"]

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
]

const twoDigits = (value: number) => String(value).padStart(2, "0")

// A native select, dressed like the Input beside it. The app has no Select
// component, and a native one is accessible and works as it should on a phone.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

// The Schedule tab: when the workflow runs on its own, and the form to change
// it. The server checks everything again; the form only makes the common
// case easy.
export function SchedulePanel({
  workflowId,
  schedule,
}: {
  workflowId: string
  schedule: ScheduleSummary | null
}) {
  const router = useRouter()
  const { getNodes, getEdges } = useReactFlow<StepNodeType>()
  const { isLoaded, isPro, goToBilling } = useProPlan()
  const [isPending, startTransition] = useTransition()

  const preset = schedule?.preset
  const [frequency, setFrequency] = useState<Frequency>(
    preset?.frequency ?? "daily"
  )
  const [time, setTime] = useState(
    preset && preset.frequency !== "hourly"
      ? `${twoDigits(preset.hour)}:${twoDigits(preset.minute)}`
      : "09:00"
  )
  const [minute, setMinute] = useState(preset?.minute ?? 0)
  const [dayOfWeek, setDayOfWeek] = useState(
    preset?.frequency === "weekly" ? preset.dayOfWeek : 1
  )
  // The browser's own time zone for a new schedule. Safe to read here: the
  // panel only mounts once its tab is opened, in the browser, never in the
  // server render.
  const [timezone, setTimezone] = useState(
    () => schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  const presetFromForm = (): SchedulePreset => {
    const [hour, minuteOfTime] = time.split(":").map(Number)

    switch (frequency) {
      case "hourly":
        return { frequency, minute }
      case "daily":
        return { frequency, hour, minute: minuteOfTime }
      case "weekly":
        return { frequency, dayOfWeek, hour, minute: minuteOfTime }
    }
  }

  const handleSave = () => {
    const graph = { nodes: getNodes(), edges: getEdges() }
    const problems = validateGraph(graph)

    if (problems.length > 0) {
      toast.error(problems[0])
      return
    }

    startTransition(async () => {
      try {
        const result = await saveWorkflowScheduleAction({
          workflowId,
          schedule: { preset: presetFromForm(), timezone },
          graph,
        })

        if (!result.ok) {
          toast.error(result.error)
          return
        }

        toast.success("Schedule saved")
        // The tab unmounts when another is opened, and remounts from what the
        // page last read: this re-reads it.
        router.refresh()
      } catch (error) {
        Sentry.captureException(error, {
          tags: { action: "save-workflow-schedule" },
          extra: { workflowId },
        })
        toast.error("Failed to save the schedule")
      }
    })
  }

  const handleRemove = () => {
    startTransition(async () => {
      try {
        await deleteWorkflowScheduleAction(workflowId)
        toast.success("Schedule removed")
        router.refresh()
      } catch (error) {
        Sentry.captureException(error, {
          tags: { action: "delete-workflow-schedule" },
          extra: { workflowId },
        })
        toast.error("Failed to remove the schedule")
      }
    })
  }

  const removeButton = schedule && (
    <Button
      size="sm"
      variant="ghost"
      disabled={isPending}
      onClick={handleRemove}
    >
      Remove schedule
    </Button>
  )

  if (!isLoaded) {
    return (
      <div className="p-3">
        <Spinner />
      </div>
    )
  }

  // Off Pro, the form is locked. A schedule kept from a Pro plan can still be
  // removed, which is the one thing left to do with it.
  if (!isPro) {
    return (
      <div className="flex flex-col items-start gap-3 p-3 text-xs">
        <p className="text-muted-foreground">
          Scheduled workflows are part of the Pro plan.
        </p>
        <Button size="sm" onClick={goToBilling}>
          <Lock />
          Upgrade to schedule
        </Button>
        {schedule && (
          <>
            <p className="text-muted-foreground">
              {describeSchedule(schedule.preset, schedule.timezone)}, paused.
            </p>
            {removeButton}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {schedule ? (
        <div className="rounded-lg border border-border bg-card p-2 text-xs">
          <p className="font-medium">
            {describeSchedule(schedule.preset, schedule.timezone)}
          </p>
          {!schedule.active && (
            <p className="mt-1 text-muted-foreground">
              Paused when the organization left the Pro plan. Save it to resume.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Not scheduled. Pick when it should run on its own.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-frequency" className="text-xs">
          Runs
        </Label>
        <NativeSelect
          id="schedule-frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
        >
          {FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {frequency === "weekly" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-day" className="text-xs">
            On
          </Label>
          <NativeSelect
            id="schedule-day"
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
          >
            {WEEKDAY_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {frequency === "hourly" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-minute" className="text-xs">
            Minute past the hour
          </Label>
          <Input
            id="schedule-minute"
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(e) => setMinute(Number(e.target.value))}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-time" className="text-xs">
            At
          </Label>
          <Input
            id="schedule-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-timezone" className="text-xs">
          Time zone
        </Label>
        <Input
          id="schedule-timezone"
          value={timezone}
          placeholder="America/Sao_Paulo"
          onChange={(e) => setTimezone(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? <Spinner /> : <CalendarClock />}
          {schedule ? "Update schedule" : "Schedule"}
        </Button>
        {removeButton}
      </div>

      <p className="text-xs text-muted-foreground">
        Scheduled runs use the workflow as it was last saved here or run.
      </p>
    </div>
  )
}
