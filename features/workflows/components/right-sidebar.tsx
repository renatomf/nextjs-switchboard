"use client"

import { useRef, useState, useTransition, type FocusEvent } from "react"
import { useRouter } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { Lock, MoreHorizontal, Play, Square, Trash2 } from "lucide-react"
import { useReactFlow, useStore } from "@xyflow/react"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import {
  cancelWorkflowRunAction,
  deleteWorkflowAction,
  runWorkflowAction,
} from "@/features/workflows/actions"
import { NodeIcon } from "@/features/workflows/components/node-icon"
import {
  useLiveRun,
  useRunHistory,
} from "@/features/workflows/components/workflow-runs-provider"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import { useUpstreamConnections } from "@/features/workflows/hooks/use-upstream-connections"
import { validateGraph } from "@/features/workflows/lib/validate-graph"
import { cn } from "@/lib/utils"
import {
  nodeRegistry,
  type NodeDefinition,
  type NodeField,
  type NodeType,
  type StepNodeKind,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"

// This file builds up to the RightSidebar component exported at the bottom: a
// header with workflow actions (delete, run/stop), then two tabs — a Toolbar for
// adding nodes and an Editor for tweaking the selected node. Each helper below is
// defined just above the block that uses it.

// ---------------------------------------------------------------------------
// Shared pieces — used by both the Toolbar and the Editor.
// ---------------------------------------------------------------------------

// A titled, scrollable panel. Each tab renders its content inside one.
function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-y border-border bg-card px-3 py-1.5 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor tab — edits the fields of the selected node.
// ---------------------------------------------------------------------------

// The control a node property asked for — a textarea when it opts into
// multiline, an input otherwise. The Inspector renders the label above it.
// The element a field renders into — the Inspector keeps the last one focused so
// a connection chip knows where to insert.
type FieldElement = HTMLInputElement | HTMLTextAreaElement

function Field({
  field,
  value,
  onChange,
  onFocus,
}: {
  field: NodeField
  value: string
  onChange: (value: string) => void
  onFocus: (el: FieldElement) => void
}) {
  const Control = field.multiline ? Textarea : Input
  return (
    <Control
      id={field.key}
      value={value}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e: FocusEvent<FieldElement>) => onFocus(e.currentTarget)}
    />
  )
}

// The Editor tab: one input per field on the selected node, or an empty state.
function Inspector({ node }: { node: StepNodeType | undefined }) {
  const { updateNodeData } = useReactFlow<StepNodeType>()
  // Every output produced anywhere upstream of the selected node, as insertable
  // tokens. The hook reads the selection from the store itself.
  const connections = useUpstreamConnections()
  // The field the user last put a cursor in. A ref, not state — nothing renders
  // from it, and it is read only when a chip is clicked. Cleared on selection
  // change by the key on this component.
  const lastEdited = useRef<{ key: string; el: FieldElement } | null>(null)

  if (!node) {
    return (
      <Section title="Editor">
        <p className="p-3 text-sm text-muted-foreground">No node selected</p>
      </Section>
    )
  }

  const { type, title, values } = node.data
  const def: NodeDefinition = nodeRegistry[type]

  // Drops a token into the field the user was last in, or the first field when
  // they have not focused one yet, splicing it at the cursor rather than
  // appending so it lands where they were typing.
  const insert = (token: string) => {
    const last = lastEdited.current
    const key = last?.key ?? def.fields[0]?.key
    if (!key) return

    // A blurred input keeps its selection, so the cursor is still where it was
    // left. Null means no field has been focused yet — append in that case.
    const el = last?.el
    const start = el?.selectionStart ?? null
    const end = el?.selectionEnd ?? null

    updateNodeData(node.id, (current) => {
      const value = current.data.values[key] ?? ""
      return {
        values: {
          ...current.data.values,
          [key]:
            value.slice(0, start ?? value.length) +
            token +
            value.slice(end ?? value.length),
        },
      }
    })

    if (!el) return

    // Hand focus back with the cursor after the token, once React has rendered
    // the new value — moving it any earlier would be undone by that render.
    const caret = (start ?? el.value.length) + token.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <Section title={title} icon={<NodeIcon type={type} />}>
      <div className="flex flex-col gap-3 p-3">
        {def.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">No properties</p>
        ) : (
          def.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={field.key} className="text-xs">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Field
                field={field}
                value={values[field.key] ?? ""}
                onChange={(value) => {
                  updateNodeData(node.id, {
                    values: { ...values, [field.key]: value },
                  })
                }}
                onFocus={(el) => {
                  lastEdited.current = { key: field.key, el }
                }}
              />
            </div>
          ))
        )}
      </div>
      {/* Only worth showing when there is somewhere to put a token — a node
          without fields has nothing a chip could insert into. */}
      {connections.length > 0 && def.fields.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Connections
          </p>
          <div className="flex flex-wrap gap-1.5">
            {connections.map((connection) => (
              <button
                key={connection.token}
                type="button"
                title={connection.token}
                onClick={() => insert(connection.token)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <NodeIcon
                  type={connection.nodeType}
                  className="size-4 rounded-full"
                  iconClassName="size-2.5"
                />
                {connection.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Toolbar tab — adds nodes to the canvas, grouped by kind.
// ---------------------------------------------------------------------------

// The Toolbar's groups, one accordion section per node kind.
const sections: { kind: StepNodeKind; label: string }[] = [
  { kind: "trigger", label: "Triggers" },
  { kind: "action", label: "Actions" },
]

// Every node type from the registry, filtered into the groups below. Widened to
// NodeDefinition so optional manifest flags (premium) are readable — `satisfies`
// keeps each entry's literal type, which omits the keys it didn't set.
const definitions: NodeDefinition[] = Object.values(nodeRegistry)

// The Toolbar tab: a button per node type that adds it to the canvas.
function Palette() {
  // The shared React Flow store (lifted to a provider above the canvas and this
  // sidebar) lets us read the current nodes/viewport and add to them from here.
  const { getNodes, getViewport, addNodes } = useReactFlow<StepNodeType>()
  // The pane's measured size, used to find the center of the current view.
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  // Gates the premium nodes. `isLoaded` is held separately so the lock only
  // appears once we actually know the org's plan — otherwise a pro org sees its
  // Agent node flash as locked on every mount and after every org switch.
  const { isLoaded, isPro, goToBilling } = useProPlan()

  const add = (type: NodeType) => {
    const def: NodeDefinition = nodeRegistry[type]
    const nodes = getNodes()

    // Premium nodes are the plan's whole point, so re-check here rather than
    // trusting the button to have been rendered locked.
    if (def.premium && !isPro) {
      goToBilling()
      return
    }

    // Only one trigger is allowed — a workflow has a single entry point.
    if (
      def.kind === "trigger" &&
      nodes.some((n) => n.data.kind === "trigger")
    ) {
      toast.error("A workflow can only have one trigger.")
      return
    }

    // Number nodes of the same type (e.g. "Open URL 1", "Open URL 2") so
    // duplicates stay easy to tell apart.
    const count = nodes.filter((n) => n.data.type === type).length
    const title = `${def.label} ${count + 1}`

    // Drop the node in the middle of the current view. The viewport transform
    // maps a flow point p to the screen as p * zoom + {x, y}, so the pane center
    // in flow coordinates is (center - offset) / zoom.
    const { x, y, zoom } = getViewport()
    const position = {
      x: (width / 2 - x) / zoom,
      y: (height / 2 - y) / zoom,
    }

    addNodes({
      id: crypto.randomUUID(),
      type: "step",
      position,
      data: { type, kind: def.kind, title, values: {} },
    })
  }

  return (
    <Section title="Toolbar">
      <Accordion
        type="multiple"
        defaultValue={sections.map((s) => s.kind)}
        className="px-3 py-2"
      >
        {sections.map((section) => (
          <AccordionItem
            key={section.kind}
            value={section.kind}
            className="not-last:border-b-0"
          >
            <AccordionTrigger className="py-2 text-xs font-medium text-muted-foreground hover:no-underline">
              {section.label}
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-0.5">
              {definitions
                .filter((def) => def.kind === section.kind)
                .map((def) => {
                  // Locked reads as "we know they can't have it", which is only
                  // true once the plan has resolved. Until then the node is
                  // simply not clickable yet — no lock, no upgrade prompt.
                  const locked = def.premium && isLoaded && !isPro
                  return (
                    <Button
                      key={def.type}
                      variant="ghost"
                      disabled={def.premium && !isLoaded}
                      onClick={() => add(def.type as NodeType)}
                      title={
                        locked
                          ? `${def.label} is part of the Pro plan — upgrade to add it`
                          : undefined
                      }
                      className={cn(
                        "justify-start gap-2.5 px-1.5 text-xs",
                        locked && "text-muted-foreground"
                      )}
                    >
                      <NodeIcon
                        type={def.type as NodeType}
                        className={locked ? "opacity-50 grayscale" : undefined}
                      />
                      {def.label}
                      {locked && <Lock className="ml-auto size-3" />}
                    </Button>
                  )
                })}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Header — workflow-level actions shown above the tabs.
// ---------------------------------------------------------------------------

// The "..." menu for workflow-level actions.
function ActionsMenu({ workflowId }: { workflowId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteWorkflowAction(workflowId)
      } catch (error) {
        // The toast is what the user gets; the report is how anyone finds out
        // it happened. A server action's message is replaced by a digest in
        // production, so the matching server-side event carries the stack and
        // this one carries the user and the workflow.
        Sentry.logger.error("Workflow delete failed", { workflowId })
        Sentry.captureException(error, {
          tags: { action: "delete-workflow" },
          extra: { workflowId },
        })
        toast.error("Failed to delete workflow")
        return
      }

      // The workflow this page renders is gone, so leave for the home page.
      router.push("/")
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          className="text-xs [&_svg:not([class*='size-'])]:size-3.5"
          onSelect={(e) => {
            // Keep the menu open while the delete runs so the item can show it
            // is in flight instead of the menu closing on an unfinished action.
            e.preventDefault()
            handleDelete()
          }}
        >
          {isPending ? <Spinner /> : <Trash2 />}
          Delete workflow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The header's run control: it starts a run of the current workflow, and while
// that run is going it turns into the Stop button that cancels it.
function RunControl({ workflowId }: { workflowId: string }) {
  const { getNodes, getEdges } = useReactFlow<StepNodeType>()
  const [isPending, startTransition] = useTransition()
  // A workflow has at most one run going at a time, so this is the run Stop
  // has to cancel — including one started before this page was opened.
  const liveRun = useLiveRun()
  const { runs } = useRunHistory()
  // The run this button just started. The realtime subscription needs a moment
  // to report it, and without holding it the button would flash back to Run in
  // that gap — long enough to start a second run of the same workflow.
  const [startedId, setStartedId] = useState<string | null>(null)
  const settling =
    startedId !== null && !runs.some((run) => run.id === startedId)

  const activeRunId = liveRun?.id ?? (settling ? startedId : null)

  const handleRun = () => {
    const graph = { nodes: getNodes(), edges: getEdges() }
    const problems = validateGraph(graph)
    if (problems.length > 0) {
      // A graph the user built that can't run. Not an error — the pre-flight
      // did its job — but which shapes keep failing it is worth knowing.
      Sentry.logger.warn("Workflow run rejected by validation", {
        workflowId,
        problem: problems[0],
        problemCount: problems.length,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      })
      toast.error(problems[0])
      return
    }

    startTransition(async () => {
      try {
        const handle = await runWorkflowAction({ id: workflowId, graph })

        setStartedId(handle.id)
      } catch (error) {
        Sentry.logger.error("Workflow run failed to start", {
          workflowId,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        })
        Sentry.captureException(error, {
          tags: { action: "run-workflow" },
          extra: {
            workflowId,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
          },
        })
        toast.error("Failed to start workflow run")
      }
    })
  }

  const handleStop = () => {
    if (!activeRunId) return

    startTransition(async () => {
      try {
        await cancelWorkflowRunAction({ workflowId, runId: activeRunId })
      } catch (error) {
        // Cancelling is the user's way out of a run that is misbehaving, so a
        // failure here leaves them stuck — worth a report, not just a toast.
        Sentry.logger.error("Workflow run failed to cancel", {
          workflowId,
          runId: activeRunId,
        })
        Sentry.captureException(error, {
          tags: { action: "cancel-workflow-run" },
          extra: { workflowId, runId: activeRunId },
        })
        toast.error("Failed to stop workflow run")
      }
    })
  }

  // The button the run itself decides: nothing running means Run, and a run in
  // flight means the only thing left to do is stop it. The cancelled run turns
  // up as not-live on the subscription, which flips this back on its own.
  if (activeRunId) {
    return (
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={handleStop}
      >
        {isPending ? <Spinner /> : <Square />}
        Stop
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={isPending}
      onClick={handleRun}
    >
      {isPending ? <Spinner /> : <Play />}
      Run
    </Button>
  )
}

// ---------------------------------------------------------------------------
// The sidebar itself — header on top, then the Toolbar / Editor tabs.
// ---------------------------------------------------------------------------

// The tab triggers are styled to read as plain toggles rather than the default
// underlined tabs.
const tabTriggerClassName =
  "flex-none rounded-sm data-active:bg-accent! data-active:text-accent-foreground! data-active:shadow-none! dark:data-active:border-transparent!"

export function RightSidebar({ workflowId }: { workflowId: string }) {
  const [tab, setTab] = useState("toolbar")

  // The currently selected node, read from the shared React Flow store.
  const selected = useStore((s) => s.nodes.find((n) => n.selected)) as
    StepNodeType | undefined

  // Auto-switch to the Editor tab when the selection changes.
  const [prevSelectedId, setPrevSelectedId] = useState(selected?.id)
  if (selected && selected.id !== prevSelectedId) {
    setPrevSelectedId(selected.id)
    setTab("editor")
  }

  return (
    <div className="size-full bg-background">
      <Tabs value={tab} onValueChange={setTab} className="size-full gap-0">
        <div className="flex items-center justify-between border-b border-border p-2">
          <ActionsMenu workflowId={workflowId} />
          <RunControl workflowId={workflowId} />
        </div>
        <TabsList className="m-2 w-fit bg-background">
          <TabsTrigger value="toolbar" className={tabTriggerClassName}>
            Toolbar
          </TabsTrigger>
          <TabsTrigger value="editor" className={tabTriggerClassName}>
            Editor
          </TabsTrigger>
        </TabsList>
        <TabsContent value="toolbar" className="flex min-h-0 flex-col">
          <Palette />
        </TabsContent>
        <TabsContent value="editor" className="flex min-h-0 flex-col">
          <Inspector key={selected?.id} node={selected} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
