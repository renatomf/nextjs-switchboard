<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Adding a workflow node

Three edits, all under `features/workflows/nodes/`:

1. the impl file (e.g. `open-url.ts`) — the node's executor logic,
2. register it in `node-executors.ts` — the `satisfies` contract makes a missing
   executor a compile error for action nodes,
3. add its manifest entry in `node-registry.ts` — kind, label, icon, accent, its
   input `fields`, and the `outputs` downstream nodes can reference.

The run task and the canvas step node are registry-driven — never touch them to add
a node.

# React Flow

Do not write React Flow (`@xyflow/react`) code from memory — the API has moved (package rename, `reactflow` -> `@xyflow/react`, v11 -> v12 hook/prop/type changes) and training data is unreliable here. Before adding or changing anything that touches React Flow — components, hooks, node/edge types, handles, props, styling, or provider setup — fetch https://reactflow.dev/llms.txt and follow its links to the specific docs pages for the APIs in question, then implement from what the docs actually say. Same rule when debugging React Flow behavior: check the current docs before guessing.

# Database types

Derive database types from the Drizzle schema — never hand-write custom or partial shapes for table rows. Export typeof table.$inferSelect (and $inferInsert when needed) from lib/schema.ts and import it. When a consumer needs only some columns, narrow with Pick<Row, ...> / Omit<Row, ...> rather than redeclaring a literal type. Don't add an insert type where db.insert(...).values() already enforces the shape.

# JSX text entities

Never write a raw `'`, `"`, `<`, or `>` in JSX text content — `react/no-unescaped-entities` fails the build. Escape them as HTML entities: `&apos;` for apostrophes, `&quot;` for quotes, `&lt;`/`&gt;` for angle brackets. This applies only to literal text between tags; apostrophes inside string props, attribute values, comments, and non-JSX code (including plain `.ts` files) are fine as-is. Prefer rewording over an escape-heavy sentence when the copy reads just as well without the contraction.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

# Stagehand Project

This project uses **Stagehand v3** (`^3.6.0`), a browser automation framework with
AI-powered `act`, `extract`, and `observe` methods. The main class is imported as
`Stagehand` from `@browserbasehq/stagehand`.

**Do not write Stagehand code from memory.** v4 exists and reads very differently —
`browserbase.launch()`, `Stagehand.create()`, every result wrapped in
`{ data, metadata }`, no `agent` API, `await page.url()`. None of that applies
here. This project is pinned to v3 deliberately. When unsure, read the typings in
`node_modules/@browserbasehq/stagehand/dist/cjs/lib/v3/` — they are the most
reliable reference for this version.

**Key surfaces:**

- `Stagehand` — the orchestrator, built with `new` and then `init()`ed. Carries
  `act`, `extract`, `observe`, and `agent`
- `stagehand.context` — the CDP-backed context owning pages, cookies, clipboard
- `stagehand.context.pages()` — top-level pages, oldest first. Also
  `activePage()` and `newPage(url?)`

## Initialize

```typescript
import { Stagehand } from "@browserbasehq/stagehand"

const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY!,
  model: "google/gemini-3.5-flash",
  // Pino's logging backend spawns a thread-stream worker (lib/worker.js) that
  // cannot be resolved inside a bundled environment such as trigger.dev's output.
  disablePino: true,
})

await stagehand.init()

const page = stagehand.context.pages()[0]
```

`init()` is what launches the session — nothing works before it resolves. With
`env: "BROWSERBASE"` the session runs in the cloud and act/extract/observe route
through the Stagehand API, which is also what makes the run appear under the
session's Stagehand tab in the Browserbase dashboard. `env: "LOCAL"` runs a local
Chrome instead.

After `init()`, `stagehand.browserbaseSessionID` holds the session id — capture it
if you need to link to the replay later.

Stagehand does fall back to reading `BROWSERBASE_API_KEY` and
`BROWSERBASE_PROJECT_ID` from the environment, but pass keys explicitly anyway so
the dependency is visible at the call site.

## Act

Actions are called on the `stagehand` instance, not on the page:

```typescript
const result = await stagehand.act("click the sign in button")

console.log(result.success, result.message)
```

The result comes back directly — `{ success, message, actionDescription, actions }`.
There is no `data` wrapper.

**Instructions must be atomic and specific:**

- Good: "Click the sign in button" or "Type 'hello' into the search input"
- Bad: "Order me pizza" or "Type in the search bar and hit enter" (multi-step)

`act` resolves whether or not the model managed the action — a failure returns
`success: false` rather than throwing. Check the flag; do not rely on try/catch.

Use `variables` for secrets. Values are substituted locally and never sent to the
model:

```typescript
await stagehand.act("type %password% into the password field", {
  variables: { password: process.env.USER_PASSWORD },
})
```

### Observe Then Act Pattern (Recommended)

`act` accepts either a string or an `Action` returned by `observe`. Observe first
to inspect the candidate, then pass it back for deterministic replay with no
inference:

```typescript
const [action] = await stagehand.observe("Click the sign in button")

if (action) {
  await stagehand.act(action)
}
```

## Extract

Four forms, and the one you pick decides the return shape:

```typescript
// No instruction — the whole page as text: { pageText: string }
const { pageText } = await stagehand.extract()

// Instruction only — the default schema: { extraction: string }
const { extraction } = await stagehand.extract("extract the sign in button text")

// Instruction plus schema — your shape, inferred
const { listings } = await stagehand.extract(
  "extract all apartment listings with prices and addresses",
  z.object({
    listings: z.array(z.object({ price: z.string(), address: z.string() })),
  }),
)
```

The extracted value is returned directly, not under `data`. A schema is optional;
without one you get a single `extraction` string.

### URL Extraction

When extracting links, use `z.string().url()`:

```typescript
const { links } = await stagehand.extract(
  "extract all navigation links",
  z.object({ links: z.array(z.string().url()) }),
)
```

### Targeted Extraction

Scope with `selector`, prune noise with `ignoreSelectors`:

```typescript
const { reason } = await stagehand.extract(
  "extract the reason why script injection fails",
  z.object({ reason: z.string() }),
  { selector: "#main-content", ignoreSelectors: ["nav", ".cookie-banner"] },
)
```

## Observe

Plan actions before executing them. Candidates come back as a plain array:

```typescript
const actions = await stagehand.observe("Click the sign in button")

for (const action of actions) {
  console.log(action.selector, action.description)
}
```

## Agent

v3 ships an agent that runs its own multi-step loop, for goals too broad for a
single `act`:

```typescript
const result = await stagehand.agent().execute("find the cheapest flight to Lisbon")

console.log(result.success, result.message, result.completed)
```

Reach for it only when the steps genuinely have to be decided at run time. A known
sequence is cheaper and far more predictable written as explicit `act` calls.

## Pages

```typescript
const page = stagehand.context.pages()[0]

await page.goto("https://example.com", { waitUntil: "load", timeoutMs: 30_000 })

const url = page.url() // synchronous — cached from navigation events
const title = await page.title() // async

const second = await stagehand.context.newPage("https://example.com/pricing")
```

Two details that trip up v4-trained code: the navigation option is `timeoutMs`,
not `timeout`, and `url()` is synchronous — awaiting it is harmless but wrong, and
a reliable sign the code was written against the wrong version.

Target a specific page through the options:

```typescript
await stagehand.act("click the buy button", { page: second })
```

## Cleanup

`close()` releases the Browserbase session. There is no separate browser handle in
v3 — this one call is the whole cleanup:

```typescript
const stagehand = new Stagehand({ env: "BROWSERBASE", apiKey, disablePino: true })

try {
  await stagehand.init()
  // ...
} finally {
  await stagehand.close()
}
```

## Project Structure Best Practices

- Read configuration from environment variables and pass it explicitly to the
  constructor
- Always `await stagehand.init()` before touching pages or calling act/extract
- Wrap every workflow in `try`/`finally` so `close` runs even when a step throws
- Keep Zod schemas next to the code that consumes them and reuse `z.infer` for the
  decoded type
- Prefer narrow, atomic instructions over one instruction describing a whole flow

## Security Notes

- Never hard-code API keys. Read them from `process.env` and pass them explicitly
- Pass secrets through `variables` so they are substituted locally and never reach
  the model provider
- Set `verbose: 0` when handling sensitive data so nothing sensitive is logged
- Avoid broad instructions that may trigger unintended navigation; call `observe`
  first, then replay the returned `Action`

## Resources/References

- TypeScript SDK: `@browserbasehq/stagehand` on npm, pinned to `^3.6.0`
- Local typings, the reference of record for this version:
  `node_modules/@browserbasehq/stagehand/dist/cjs/lib/v3/`
- Stagehand documentation: https://docs.stagehand.dev — defaults to v4, so check
  the version selector before copying anything
