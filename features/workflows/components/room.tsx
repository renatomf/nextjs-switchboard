"use client"

import { ReactNode } from "react"
import * as Sentry from "@sentry/nextjs"
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense"
import { Spinner } from "@/components/ui/spinner"

export function Room({
  roomId,
  children,
}: {
  roomId: string
  children: ReactNode
}) {
  return (
    <LiveblocksProvider
      throttle={16}
      authEndpoint="/api/liveblocks/auth"
      resolveUsers={async ({ userIds }) => {
        try {
          const response = await fetch("/api/liveblocks/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds }),
          })

          if (!response.ok) {
            Sentry.captureException(
              new Error(`Resolving Liveblocks users failed (${response.status})`),
              { tags: { area: "liveblocks" }, extra: { userIds } }
            )
            return undefined
          }

          return await response.json()
        } catch (error) {
          // Returning undefined only costs the cursors their names, so this
          // stays non-fatal for the canvas — but silently is how it stayed
          // broken. Reported, then degraded.
          Sentry.captureException(error, {
            tags: { area: "liveblocks" },
            extra: { userIds },
          })
          return undefined
        }
      }}
    >
      <RoomProvider id={roomId}>
        <ClientSideSuspense
          fallback={
            <div className="flex min-h-svh items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  )
}
