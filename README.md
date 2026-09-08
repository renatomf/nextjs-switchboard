# Browserbase Workflows

A multi-tenant SaaS for building **browser automations visually** and running them in the cloud.

You drag nodes onto a canvas — open a page, click something, extract data, hand a whole goal to
an AI agent, email the result — connect them into a flow, and press **Run**. The flow executes on
a real cloud browser, streams each step's status back to the canvas live, and leaves behind a
video recording of everything the browser did.

The canvas is **collaborative**: everyone in your organization edits the same workflow at the
same time, with live cursors and presence, like a Figma file.

---

## What it actually does

### The product loop

1. **Build** — compose a workflow on an infinite canvas from a palette of typed nodes.
2. **Wire** — connect nodes into a DAG. Later nodes reference earlier nodes' results through
   `{{ nodeId.path }}` placeholders.
3. **Run** — the graph is validated, saved to Postgres, and handed to a durable background job.
4. **Watch** — each step reports `pending → running → done / failed` to the canvas in realtime,
   with its duration and its output.
5. **Review** — the console panel shows what every step returned; the replay panel plays back a
   video of the actual browser session.

### One run, one browser

A run opens **a single Browserbase session, lazily**, on the first node that actually needs a
browser — and every later node reuses it. That's what makes the session recording span the whole
flow instead of fragmenting per step, and it's why a workflow made only of `Send Email` nodes
never opens a browser at all.

Nodes execute in **topological order** (`toposort`). Orphan nodes that touch no edge are skipped.
A cycle is rejected before the run starts.

### Passing data between nodes

Any field on any node can interpolate an upstream result:

```
https://example.com/search?q={{ n1.extraction.query }}
```

The first segment is the node id, the rest is a path into whatever that node returned
(`{{ n1.items[0].name }}` works). Unresolved placeholders become an empty string rather than the
literal `undefined`. Because nodes run in dependency order, anything a node points at has already
produced its value.

### Node catalog

| Node | Kind | What it does | Outputs |
| --- | --- | --- | --- |
| **Start** | trigger | Entry point. Executes nothing — it's where the walk begins | — |
| **Open URL** | action | Navigates the session to a URL | `url`, `title` |
| **Act** | action | Performs exactly one AI-driven action ("click the sign in button") | `success`, `message`, `url` |
| **Extract** | action | Pulls structured data off the page from a natural-language instruction | `extraction` |
| **Observe** | action | Finds candidate elements without acting on them | `matches` |
| **Agent** 💎 | action | Hands over a whole goal and runs an autonomous multi-step loop | `success`, `message`, `completed` |
| **Send Email** | action | Sends the result by email. Touches no browser | `id` |

💎 = **Pro plan only**. The Agent node runs a full computer-use loop — many model calls per step,
which makes it by far the most expensive node to execute.

---

## Tech stack

| Layer | Choice | Why / what it's used for |
| --- | --- | --- |
| **Framework** | [Next.js 16](https://nextjs.org) (App Router, Turbopack) | Server Components, Server Functions, `proxy.ts` |
| **UI** | React 19, TypeScript 5 | |
| **Styling** | Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com), Radix UI, Base UI | Design system + primitives |
| **Canvas** | [React Flow](https://reactflow.dev) (`@xyflow/react` 12) | The node editor |
| **Realtime** | [Liveblocks](https://liveblocks.io) + `@liveblocks/react-flow` | Multiplayer canvas, cursors, presence |
| **Auth** | [Clerk](https://clerk.com) | Sign-in, **Organizations** (multi-tenancy), session tasks |
| **Billing** | Clerk Billing | Org-level subscriptions, `PricingTable`, in-app checkout |
| **Database** | [Neon](https://neon.com) Postgres | Serverless Postgres, branch-per-environment |
| **ORM** | [Drizzle](https://orm.drizzle.team) + `node-postgres` | Schema, migrations, typed queries |
| **Background jobs** | [Trigger.dev](https://trigger.dev) v4 | Durable run execution, realtime metadata streaming |
| **Browser automation** | [Browserbase](https://browserbase.com) + [Stagehand v3](https://docs.stagehand.dev) | Cloud browsers, `act` / `extract` / `observe` / `agent` |
| **AI model** | `google/gemini-3.5-flash` | Routed through Stagehand's shared free tier |
| **Email** | [Resend](https://resend.com) | The `Send Email` node |
| **Observability** | [Sentry](https://sentry.io) | Errors, logs, tracing — web + task worker |
| **Video replay** | Browserbase Session Replay + `hls.js` | HLS playback of the run's browser session |

### How the pieces fit

```
   Browser (canvas)
        |  Liveblocks room  ------------->  live collaborative editing
        |
        v  Run  (Server Function)
   Postgres (Neon)          <-- graph snapshot saved on Run
        |
        v
   Trigger.dev task "run-workflow"
        |  toposort -> walk nodes -> per-node executor
        |  metadata.set("steps", ...)  -->  streams back to the canvas
        v
   Browserbase session (Stagehand)
        +-- recording ------------------->  HLS replay, proxied server-side
```

---

## Architecture notes

### Multi-tenancy is enforced at the data layer

Every function in [`features/workflows/data.ts`](features/workflows/data.ts) takes `orgId` as a
**required argument**. There is no way to write a query that isn't scoped to an organization —
it's a type error, not a code-review question.

### Auth lives on the resource, not in the proxy

`proxy.ts` runs `clerkMiddleware()` and nothing else. Every protected surface authenticates
itself: pages and layouts call `auth.protect()`, route handlers return their own `401`, and
Server Functions check `orgId` before touching data. Path-based gates in middleware can diverge
from how Next.js actually resolves a request, and Server Functions are dispatched by id rather
than by path — so the gate belongs at the resource.

### Plan gating is enforced server-side, twice

The toolbar locks the Agent node for a free org, but that's presentation. The real gates are:

- **On page load** — reads the *live Liveblocks room* (not just the saved snapshot), because a
  workflow built on Pro and never run has its Agent node in the room and nothing in Postgres.
- **On Run** — checks the graph in hand, before saving it, because a collaborator on the shared
  canvas may have added a premium node seconds ago. This is the last possible checkpoint: the
  Trigger.dev task runs without a Clerk session, so it has no `has()` to ask.

Refusals throw a named `PlanRequiredError` so they group separately in Sentry from real failures.

### Two copies of the graph, on purpose

The **Liveblocks room** is the live editing copy. The **`graph` jsonb column** is a snapshot
written on Run — it's what the background task reads, since the worker has no room connection.

### The run task retries once, deliberately

The project default is 3 attempts. That's wrong here: an attempt re-runs the whole graph from the
first node against a brand new browser session, so a failure in the last step pays for every step
before it three times over. The failures that actually happen (a bad instruction, an exhausted
quota) aren't the kind a retry fixes.

---

## Project structure

```
app/
  (auth)/            sign-in, sign-up, choose-organization
  (dashboard)/       workflow list, canvas, billing
  api/
    liveblocks/      auth endpoint + user resolution
    replays/         server-side HLS playlist proxy
features/
  init.ts            Trigger.dev worker lifecycle hooks (Sentry wiring)
  workflows/
    actions.ts       Server Functions: create / delete / run / cancel
    data.ts          org-scoped Drizzle queries
    components/      canvas, right sidebar, console, logs, replay
    lib/             interpolate, validate-graph, premium-gate
    nodes/           one file per node + registry + executor map
    tasks/           the run-workflow Trigger.dev task
lib/
  billing.ts         plan slug + PlanRequiredError
  db/                Drizzle client + schema
  browserbase.ts     core SDK client (observability)
  liveblocks.ts      server client
  resend.ts          email client
proxy.ts             clerkMiddleware() only
```

---

## Adding a workflow node

Three edits, all under `features/workflows/nodes/`:

1. **The impl file** (e.g. `open-url.ts`) — the executor logic.
2. **`node-executors.ts`** — register it. The `satisfies` contract makes a missing executor a
   *compile error* for action nodes.
3. **`node-registry.ts`** — its manifest entry: kind, label, icon, accent, input `fields`, and the
   `outputs` downstream nodes can reference. Add `premium: true` to gate it behind Pro.

The run task and the canvas step node are registry-driven — **never touch them to add a node.**

---

## Getting started

### Prerequisites

Accounts for Clerk, Neon, Liveblocks, Trigger.dev, Browserbase, Resend, and Sentry.

### 1. Install

```bash
npm install
```

### 2. Environment

Create `.env.local`:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/

# Neon Postgres — pooled for the app, direct for migrations
DATABASE_URL=postgresql://...            # pooled (PgBouncer)
DATABASE_URL_UNPOOLED=postgresql://...   # direct, required by drizzle-kit

# Liveblocks
NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY=pk_...
LIVEBLOCKS_SECRET_KEY=sk_...

# Browserbase
BROWSERBASE_API_KEY=bb_...

# Trigger.dev
TRIGGER_SECRET_KEY=tr_dev_...

# Resend
RESEND_API_KEY=re_...

# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://...
SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=sntrys_...            # source map upload
```

### 3. Database

```bash
npm run db:generate   # generate a migration from lib/db/schema.ts
npm run db:migrate    # apply it
npm run db:studio     # browse the data
```

### 4. Clerk setup

- Enable **Organizations**, and add `choose-organization` as a **session task** so users must pick
  an org at sign-in.
- Enable **Billing** and create an organization plan with the slug `pro`
  (matches `PRO_PLAN = "org:pro"` in [`lib/billing.ts`](lib/billing.ts)).

### 5. Run

Two processes, in separate terminals:

```bash
npm run dev                          # Next.js
npx trigger.dev@latest dev           # the task worker
```

Without the second one, the Run button fires a task nothing picks up.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (+ Sentry source maps) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier |
| `npm run db:*` | `generate` · `migrate` · `push` · `studio` |

---

## Known limits

- **The AI model runs on a shared free tier.** Stagehand routes `google/gemini-3.5-flash` through
  a metered free path when no provider key is given, so `quota exceeded` (limit 20) and
  `this model is experiencing high demand` are expected under load — that's the free tier talking,
  not a broken run. Pass your own key to get past it.
- **Email sends from Resend's sandbox** (`onboarding@resend.dev`), which only delivers to the
  address on the Resend account. A verified domain is needed to mail anyone else.
- **Run metadata is capped at 256KB.** A single step's output is clamped to 4,000 characters
  before publishing; the full value still lives in the run's output and on the trace timeline.
- **Session replays lag the run.** Browserbase returns 404 until the recording is assembled, so
  the replay panel polls and the route answers `202 pending` in the meantime.
- **Clerk is on development keys**, which cap out at ~100 users and use Clerk's shared demo OAuth
  apps. Production needs a production instance and a custom domain.
