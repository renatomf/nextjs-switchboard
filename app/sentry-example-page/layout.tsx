import { auth } from "@clerk/nextjs/server"

// page.tsx here is a client component, so it can't gate itself — this server
// layout is the resource-level check for the route. It exists because the proxy
// no longer protects anything by path: without it, removing the old
// createRouteMatcher gate would have quietly made this page public.
export default async function SentryExampleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await auth.protect()

  return children
}
