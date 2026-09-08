"use client"

import prettyMs from "pretty-ms"

import type { SelectedStep } from "@/features/workflows/components/logs-panel"
import { NodeIcon } from "@/features/workflows/components/node-icon"
import { useRunHistory } from "@/features/workflows/components/workflow-runs-provider"
import {
  nodeRegistry,
  type NodeDefinition,
} from "@/features/workflows/nodes/node-registry"

interface InspectorPanelProps {
  selected: SelectedStep
}

// A short line of prose where a result would go — for the states that have no
// result to show rather than an empty one.
function Note({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>
}

// What the selected step produced: its output as formatted JSON, its error when
// it failed, or a note when there is neither.
export function InspectorPanel({ selected }: InspectorPanelProps) {
  const { runs } = useRunHistory()

  const run = runs.find((candidate) => candidate.id === selected.runId)
  const step = run?.steps.find(
    (candidate) => candidate.nodeId === selected.nodeId
  )

  if (!run || !step) {
    return <Note>This step is no longer in the run list.</Note>
  }

  // A step that failed writes its own message, but the one repaired from the
  // run's status never got that far — the run's error is what happened to it.
  const error =
    step.error ?? (step.status === "failed" ? run.error?.message : undefined)

  // Legacy steps carry no nodeType, and a type can leave the registry, so the
  // chip is only drawn when there is one to draw — the title below carries the
  // step either way.
  const def: NodeDefinition | undefined = step.nodeType
    ? nodeRegistry[step.nodeType]
    : undefined

  return (
    <div className="flex size-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        {def && (
          <NodeIcon
            type={step.nodeType}
            className="size-5"
            iconClassName="size-3"
            running={step.status === "running"}
          />
        )}
        <span className="truncate text-xs font-semibold">
          {step.title || step.nodeId}
        </span>
        {step.durationMs !== undefined && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {prettyMs(step.durationMs)}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <pre className="p-3 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
            {error}
          </pre>
        ) : step.output !== undefined ? (
          <pre className="p-3 font-mono text-xs break-words whitespace-pre-wrap">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        ) : step.status === "skipped" ? (
          <Note>
            This is where the run starts, not a step it executes — there is
            nothing to show.
          </Note>
        ) : step.status === "pending" ? (
          <Note>This step never ran.</Note>
        ) : step.status === "running" ? (
          <Note>Still running&hellip;</Note>
        ) : (
          <Note>This step produced no output.</Note>
        )}
      </div>
    </div>
  )
}
