import * as Sentry from "@sentry/nextjs"
import { auth, clerkClient } from "@clerk/nextjs/server"

// `Liveblocks` is a global interface declared in liveblocks.config.ts.
type UserInfo = Liveblocks["UserMeta"]["info"]

export async function POST(request: Request) {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  Sentry.getIsolationScope().setAttributes({
    route: "POST /api/liveblocks/users",
    userId,
    orgId,
  })

  let userIds: unknown
  try {
    ;({ userIds } = await request.json())
  } catch {
    // A 400 is the right answer and not an exception, but the only client of
    // this route is our own canvas — so a malformed body means we sent one.
    Sentry.logger.warn("Liveblocks user resolution — invalid JSON body", {
      orgId,
    })
    return new Response("Invalid JSON body", { status: 400 })
  }

  if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== "string")) {
    Sentry.logger.warn("Liveblocks user resolution — malformed userIds", {
      orgId,
    })
    return new Response("Expected { userIds: string[] }", { status: 400 })
  }

  const ids = userIds as string[]

  if (ids.length === 0) {
    return Response.json([])
  }

  // Only resolve users that belong to the caller's organization, so display
  // info can't be harvested for arbitrary users across other tenants.
  const client = await clerkClient()
  const { data: users } = await client.users.getUserList({
    userId: ids,
    organizationId: [orgId],
    limit: ids.length,
  })

  const usersById = new Map(users.map((user) => [user.id, user]))

  // Return one entry per requested ID, in the same order, null for unknown.
  const resolved: (UserInfo | null)[] = ids.map((id) => {
    const user = usersById.get(id)

    if (!user) {
      return null
    }

    return {
      name:
        user.fullName ??
        user.username ??
        user.primaryEmailAddress?.emailAddress ??
        "Anonymous",
      avatar: user.imageUrl,
    }
  })

  // requested vs resolved is the useful pair: a gap means ids were asked for
  // that the caller's org doesn't contain, which is what a stale cursor looks
  // like from here.
  Sentry.logger.info("Liveblocks users resolved", {
    orgId,
    requested: ids.length,
    resolved: resolved.filter(Boolean).length,
  })

  return Response.json(resolved)
}
