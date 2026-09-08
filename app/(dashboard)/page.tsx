import { auth } from "@clerk/nextjs/server"
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

export default async function Page() {
  // Renders no protected data itself, but it is a page of the signed-in app and
  // has to answer for itself rather than lean on the layout above, which does
  // not re-run on client-side navigation.
  await auth.protect()

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
