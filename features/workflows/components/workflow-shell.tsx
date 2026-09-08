import { Canvas } from "@/features/workflows/components/canvas"
import { ConsolePanel } from "@/features/workflows/components/console-panel"
import { RightSidebar } from "@/features/workflows/components/right-sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

interface WorkflowShellProps {
  workflowId: string
}

export function WorkflowShell({ workflowId }: WorkflowShellProps) {
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
        <RightSidebar workflowId={workflowId} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
