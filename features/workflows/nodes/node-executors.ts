import type { Stagehand } from "@browserbasehq/stagehand"

import type {
  ActionNodeType,
  NodeType,
} from "@/features/workflows/nodes/node-registry"
import { act } from "./act"
import { agent } from "./agent"
import { extract } from "./extract"
import { observe } from "./observe"
import { openUrl } from "./open-url"
import { sendEmail } from "./send-email"

type NodeContext = {
  values: Record<string, string>
  getStagehand: () => Promise<Stagehand>
  // Unique to this step of this run, and the same for every attempt of it:
  // what a node hands a service that could otherwise do its work twice.
  idempotencyKey: string
}

export type NodeExecutor = (ctx: NodeContext) => Promise<unknown>

export const nodeExecutors: Partial<Record<NodeType, NodeExecutor>> = {
  "open-url": async ({ values, getStagehand }) =>
    openUrl({ stagehand: await getStagehand(), url: values.url }),
  act: async ({ values, getStagehand }) =>
    act({ stagehand: await getStagehand(), instruction: values.instruction }),
  extract: async ({ values, getStagehand }) =>
    extract({
      stagehand: await getStagehand(),
      instruction: values.instruction,
    }),
  observe: async ({ values, getStagehand }) =>
    observe({
      stagehand: await getStagehand(),
      instruction: values.instruction,
    }),
  agent: async ({ values, getStagehand }) =>
    agent({ stagehand: await getStagehand(), instruction: values.instruction }),
  // No getStagehand call, so this step runs without opening a browser session.
  "send-email": async ({ values, idempotencyKey }) =>
    sendEmail({
      to: values.to,
      subject: values.subject,
      body: values.body,
      idempotencyKey,
    }),
} satisfies Record<ActionNodeType, NodeExecutor>
