"use client"

import { useState } from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { InspectorPanel } from "@/features/workflows/components/inspector-panel"
import {
  LogsPanel,
  type SelectedStep,
} from "@/features/workflows/components/logs-panel"

// The console below the canvas. It owns which step is selected — the list only
// reports clicks — so that the detail view of a step's output has one place to
// read the selection from.
export function ConsolePanel() {
  const [selected, setSelected] = useState<SelectedStep | null>(null)

  // Clicking the selected step again clears it, so a row is its own toggle and
  // there is no separate way to close what you opened.
  const selectStep = (step: SelectedStep) => {
    setSelected((current) =>
      current?.runId === step.runId && current.nodeId === step.nodeId
        ? null
        : step
    )
  }

  return (
    <ResizablePanelGroup
      id="workflow-console"
      orientation="horizontal"
      className="size-full bg-background"
    >
      <ResizablePanel id="logs" minSize="16rem">
        <LogsPanel selected={selected} onSelectStep={selectStep} />
      </ResizablePanel>
      {/* Handle and inspector both come and go with the selection, so the runs
          list has the whole panel — which is short — the rest of the time. The
          ids are what let the group hand the inspector back the width it was
          dragged to the last time it was open. */}
      {selected && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="inspector" defaultSize="50%" minSize="14rem">
            <InspectorPanel selected={selected} />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
