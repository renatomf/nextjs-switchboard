import * as Sentry from "@sentry/nextjs"
import { auth, currentUser } from "@clerk/nextjs/server"

import { getLiveblocks } from "@/lib/liveblocks"

export async function POST() {
  const { userId, orgId } = await auth()

  if (!userId || !orgId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const user = await currentUser()

  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  Sentry.getIsolationScope().setAttributes({
    route: "POST /api/liveblocks/auth",
    userId,
    orgId,
  })

  // Identify the user with an ID token. Permissions are resolved per room from the users groups - scope access to their Clerk organization
  const { status, body } = await getLiveblocks().identifyUser(
    {
      userId,
      groupIds: [orgId],
      organizationId: orgId
    },
    {
      userInfo: {
        name:
          user.fullName ??
          user.username ??
          user.primaryEmailAddress?.emailAddress ??
          "Anonymous",
        avatar: user.imageUrl,
      },
    }
  )

  // Liveblocks answers with a status rather than throwing, so a failure here is
  // invisible unless it is read off the response. The canvas silently fails to
  // connect when this goes wrong, which is exactly the kind of break that needs
  // a log to be findable.
  if (status >= 400) {
    Sentry.logger.error("Liveblocks user identification failed", {
      userId,
      orgId,
      status,
    })
  } else {
    Sentry.logger.info("Liveblocks user identified", { userId, orgId, status })
  }

  return new Response(body, { status })
}
