import { Workflow } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { CreateWorkflowButton } from "@/features/workflows/components/create-workflow-button"

export default function Page() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Workflow />
        </EmptyMedia>
        <EmptyTitle>No workflow selected</EmptyTitle>
        <EmptyDescription>
          Select a workflow from the sidebar or create a new one to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CreateWorkflowButton />
      </EmptyContent>
    </Empty>
  )
}
