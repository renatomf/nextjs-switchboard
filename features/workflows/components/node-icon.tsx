"use client"

import { Spinner } from "@/components/ui/spinner"
import {
  nodeRegistry,
  type NodeType,
} from "@/features/workflows/nodes/node-registry"
import { cn } from "@/lib/utils"

// The accent-colored icon chip, mirroring the node on the canvas. Its own file
// because it is drawn in four places now — the toolbar, the node editor, the run
// console's log rows and the inspector's header — and none of them should have
// to import a sidebar to get it.
export function NodeIcon({
  type,
  className,
  iconClassName = "size-3.5",
  running = false,
}: {
  type: NodeType
  className?: string
  iconClassName?: string
  // Swaps the glyph for a spinner while this node's step is in flight, the way
  // the canvas node does it. The chip itself stays put, so the row keeps its
  // color and nothing shifts when the work finishes and the icon comes back.
  running?: boolean
}) {
  const def = nodeRegistry[type]
  const Icon = def.icon

  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md",
        def.accent,
        className
      )}
    >
      {running ? (
        <Spinner className={iconClassName} />
      ) : (
        <Icon className={iconClassName} />
      )}
    </span>
  )
}
