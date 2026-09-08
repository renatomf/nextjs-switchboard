import { clerkMiddleware } from "@clerk/nextjs/server"

// No auth gate here, by design. Path matching in a proxy can diverge from how
// Next.js actually resolves a request, and Server Functions are dispatched by
// id rather than by path, so a gate at this layer can be walked around. Every
// protected resource authenticates itself instead: pages and layouts call
// `auth.protect()`, route handlers answer 401 on their own, and the data layer
// in features/workflows/data.ts takes `orgId` as a required argument so no
// query can be written that isn't org-scoped.
//
// clerkMiddleware() still has to run — it is what populates the request's auth
// context for everything downstream — it just no longer decides anything.
export default clerkMiddleware()

export const config = {
  matcher: [
    "/((?!_next|monitoring|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
