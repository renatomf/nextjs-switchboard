"use client"

import { useMemo } from "react"
import { useStore } from "@xyflow/react"
import { CircleDashed, Lock, MonitorPlay } from "lucide-react"
import prettyMs from "pretty-ms"

import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { NodeIcon } from "@/features/workflows/components/node-icon"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import {
  nodeRegistry,
  type NodeDefinition,
  type StepNodeData,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import {
  useRunHistory,
  type WorkflowRun,
} from "@/features/workflows/components/workflow-runs-provider"
import type { RunStep } from "@/features/workflows/tasks/run-workflow"
import { cn } from "@/lib/utils"

// What a click on a step row identifies. The run id is part of it because the
// same node appears in every run of the workflow — keying on the node alone
// would light up its row in all of them at once.
export type SelectedStep = {
  kind: "step"
  runId: string
  nodeId: string
}

// The replay row. There is one per run rather than one per node, so the run id
// is the whole of it — that is the difference the `kind` tag is carrying.
export type SelectedReplay = {
  kind: "replay"
  runId: string
}

// Everything the console can have open. A union rather than two pieces of state
// because the output pane shows one thing: selecting a replay has to clear the
// step it replaces, and making that unrepresentable is cheaper than remembering
// to do it.
export type ConsoleSelection = SelectedStep | SelectedReplay

// One string per selectable row. Both "is this row the selected one?" and "was
// this click on the row that is already open?" are the same question, and this
// is what lets both kinds answer it without knowing which kind they are.
export function selectionKey(selection: ConsoleSelection) {
  return selection.kind === "step"
    ? `step:${selection.runId}:${selection.nodeId}`
    : `replay:${selection.runId}`
}

interface LogsPanelProps {
  selected: ConsoleSelection | null
  // Fired with the clicked row on every click. Whether that selects or
  // deselects is the console's call, not this list's.
  onSelect: (selection: ConsoleSelection) => void
}

// One step of one run: the node's chip and title on the left, how long it took
// on the right.
function StepRow({
  step,
  node,
  isLive,
  isSelected,
  onSelect,
}: {
  step: RunStep
  // The node on the canvas this step ran, when it is still there. Only read as
  // a fallback — see below.
  node: StepNodeData | undefined
  isLive: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  // Tied to the run still being live, the way the canvas node is: a run that
  // dies mid-step leaves its step at "running" forever, and a row that spins
  // for good is worse than one that simply stops. This is the console's version
  // of the blue border the canvas paints on the node in flight.
  const isRunning = step.status === "running" && isLive
  const isFailed = step.status === "failed"

  // RunStep describes what the task writes today, but a run is a historical
  // record: one from before the console existed wrote only a node id and a
  // status, so its own type and title are genuinely missing. The canvas node
  // under the same id is the next best source — it is what that step ran, as
  // the node stands now. A step that carries its own values always wins, so a
  // node edited since the run cannot rewrite its own history.
  const type = step.nodeType ?? node?.type
  const title = step.title || node?.title || step.nodeId

  // Still nothing to draw when the node has since been deleted, or when its
  // type left the registry. The chip degrades to a neutral one rather than
  // taking the whole panel down.
  const def: NodeDefinition | undefined = type ? nodeRegistry[type] : undefined

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent text-accent-foreground",
        // A step still pending when the run is over never ran — the run stopped
        // before reaching it. Dimmed, because there is no result behind it.
        step.status === "pending" && "opacity-50"
      )}
    >
      {def && type ? (
        // The same chip the toolbar and the canvas node draw, a size down: the
        // console is a short panel, and the smaller chip fits more of a run in
        // it without the row reading as anything else. While the step is in
        // flight the chip spins in place of its icon, exactly as the node on
        // the canvas does — the icon comes back when the step settles.
        <NodeIcon
          type={type}
          className="size-5"
          iconClassName="size-3"
          running={isRunning}
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {isRunning ? (
            <Spinner className="size-3" />
          ) : (
            <CircleDashed className="size-3" />
          )}
        </span>
      )}
      <span
        className={cn(
          "truncate text-xs font-medium",
          isFailed && "text-destructive"
        )}
      >
        {title}
      </span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {step.durationMs !== undefined && prettyMs(step.durationMs)}
      </span>
    </button>
  )
}

// The run's recording, as one row under its steps. It is deliberately not shaped
// like a step: no node chip, no duration, a neutral icon — it stands for the
// whole run, and a row that looked like the others would read as a step the
// workflow contains.
function ReplayRow({
  isSelected,
  onSelect,
}: {
  isSelected: boolean
  onSelect: () => void
}) {
  // Watching a recording is a paid feature. The row stays visible for a non-pro
  // org — it is what tells them the recording is there at all — but it points at
  // the billing page instead of opening the player. As in the toolbar, the lock
  // waits for `isLoaded` so a pro org doesn't see its own replays flash locked.
  const { isLoaded, isPro, goToBilling } = useProPlan()
  const locked = isLoaded && !isPro

  return (
    <button
      type="button"
      disabled={!isLoaded}
      onClick={locked ? goToBilling : onSelect}
      // A locked row navigates rather than toggling a pane, so it isn't a
      // pressed-state control while it is in that mode.
      aria-pressed={locked ? undefined : isSelected}
      title={
        locked
          ? "Session replay is part of the Pro plan — upgrade to watch it"
          : undefined
      }
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent text-accent-foreground",
        locked && "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
          locked && "opacity-50"
        )}
      >
        <MonitorPlay className="size-3" />
      </span>
      <span className="truncate text-xs font-medium">Replay</span>
      {locked && <Lock className="ml-auto size-3 shrink-0" />}
    </button>
  )
}

// The run's own line: when it started, how it ended, and how long the whole
// thing took.
function RunHeader({ run }: { run: WorkflowRun }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-2 py-1.5">
      <Badge
        variant={
          run.isFailed ? "destructive" : run.isLive ? "secondary" : "outline"
        }
      >
        {run.isLive && <Spinner className="size-3" />}
        {run.status.toLowerCase().replace(/_/g, " ")}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {run.createdAt.toLocaleTimeString()}
      </span>
      {/* Zero until the run actually starts, which reads as a suspiciously fast
          run rather than as one that has not begun. */}
      {run.durationMs > 0 && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {prettyMs(run.durationMs)}
        </span>
      )}
    </div>
  )
}

// Every run of this workflow, newest first, each followed by its steps.
export function LogsPanel({ selected, onSelect }: LogsPanelProps) {
  const { runs, error } = useRunHistory()

  // The canvas nodes, keyed by id, so a step written before the task recorded
  // its node's type and title can still be drawn as that node. Selected as the
  // raw array — the store hands back a stable reference, and building the map
  // inside the selector would return a new one on every read.
  const nodes = useStore((s) => s.nodes) as StepNodeType[]
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.data])),
    [nodes]
  )

  if (error) {
    return (
      <p className="p-3 text-xs text-destructive">
        Lost connection to the runs: {error.message}
      </p>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="flex size-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No runs yet</p>
      </div>
    )
  }

  // The key of whatever is open, resolved once: every row below asks whether it
  // is the selected one, and comparing strings keeps that one question rather
  // than one shape of comparison per kind of row.
  const selectedKey = selected && selectionKey(selected)

  return (
    <div className="size-full overflow-y-auto">
      {runs.map((run) => {
        const { browserbaseSessionId } = run

        // Both halves are load-bearing. The id only lands on a run's output, so
        // a live run has none to offer — but a run can also finish without ever
        // opening a browser, and neither of those has a recording to play.
        const replay = browserbaseSessionId && !run.isLive

        return (
          <div key={run.id}>
            <RunHeader run={run} />
            <div className="flex flex-col gap-0.5 p-1">
              {run.steps.length === 0 && !replay ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  No steps
                </p>
              ) : (
                run.steps.map((step) => (
                  <StepRow
                    key={step.nodeId}
                    step={step}
                    node={nodesById.get(step.nodeId)}
                    isLive={run.isLive}
                    isSelected={
                      selectedKey ===
                      selectionKey({
                        kind: "step",
                        runId: run.id,
                        nodeId: step.nodeId,
                      })
                    }
                    onSelect={() =>
                      onSelect({
                        kind: "step",
                        runId: run.id,
                        nodeId: step.nodeId,
                      })
                    }
                  />
                ))
              )}
              {/* Last, under the steps: the recording is what the run left
                  behind, so it reads as the end of the run rather than another
                  thing it did. */}
              {replay && (
                <ReplayRow
                  isSelected={
                    selectedKey ===
                    selectionKey({ kind: "replay", runId: run.id })
                  }
                  onSelect={() => onSelect({ kind: "replay", runId: run.id })}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
