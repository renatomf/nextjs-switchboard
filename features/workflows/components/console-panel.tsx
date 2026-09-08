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
  selectionKey,
  type ConsoleSelection,
} from "@/features/workflows/components/logs-panel"

// The console below the canvas. It owns what is selected — the list only reports
// clicks — so that the output pane has one place to read the selection from.
export function ConsolePanel() {
  // One slot for both kinds of row, which is what makes "only one open at a
  // time" a property of the state rather than something the handlers have to
  // maintain: selecting a replay overwrites the step it replaces, and vice
  // versa, because there is nowhere else for either to live.
  const [selected, setSelected] = useState<ConsoleSelection | null>(null)

  // Clicking whatever is already open clears it, so a row is its own toggle and
  // there is no separate way to close what you opened.
  const select = (selection: ConsoleSelection) => {
    setSelected((current) =>
      current && selectionKey(current) === selectionKey(selection)
        ? null
        : selection
    )
  }

  return (
    <ResizablePanelGroup
      id="workflow-console"
      orientation="horizontal"
      className="size-full bg-background"
    >
      <ResizablePanel id="logs" minSize="16rem">
        <LogsPanel selected={selected} onSelect={select} />
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
