import { Canvas } from "@/features/workflows/components/canvas"
import { ConsolePanel } from "@/features/workflows/components/console-panel"
import { RightSidebar } from "@/features/workflows/components/right-sidebar"
import type { ScheduleSummary } from "@/features/workflows/components/schedule-panel"
import type { WebhookSummary } from "@/features/workflows/components/webhook-panel"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

interface WorkflowShellProps {
  workflowId: string
  // The workflow's schedule in this environment, read by the page.
  schedule: ScheduleSummary | null
  // Its webhook, without the secret: that is shown once, when it is made.
  webhook: WebhookSummary | null
}

export function WorkflowShell({
  workflowId,
  schedule,
  webhook,
}: WorkflowShellProps) {
  return (
    <ResizablePanelGroup
      id={`workflow-${workflowId}`}
      orientation="horizontal"
      className="size-full"
    >
      <ResizablePanel minSize="30rem">
        <ResizablePanelGroup
          id={`workflow-${workflowId}-primary`}
          orientation="vertical"
          className="size-full"
        >
          <ResizablePanel minSize="18rem">
            <Canvas />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="8rem" minSize="6rem">
            <ConsolePanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize="16rem"
        minSize="14rem"
        maxSize="36rem"
        groupResizeBehavior="preserve-pixel-size"
      >
        <RightSidebar
          workflowId={workflowId}
          schedule={schedule}
          webhook={webhook}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
