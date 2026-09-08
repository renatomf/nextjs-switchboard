"use client"

import { useTransition } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { createWorkflowAction } from "@/features/workflows/actions"
import { generateSlug } from "@/features/workflows/lib/generate-slug"

// The empty state's call to action: the same "create a workflow under a
// generated name" the sidebar's + does, as a button a page can drop in.
//
// Nothing happens here on success — the action redirects to the new workflow,
// and a redirecting server action rejects its client-side promise, so a catch
// around it would fire on the happy path.
export function CreateWorkflowButton() {
  const [isPending, startTransition] = useTransition()

  const handleCreate = () => {
    startTransition(async () => {
      await createWorkflowAction(generateSlug())
    })
  }

  return (
    <Button disabled={isPending} onClick={handleCreate}>
      {isPending ? <Spinner /> : <Plus />}
      New workflow
    </Button>
  )
}
