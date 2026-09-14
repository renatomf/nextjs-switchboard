import { auth } from "@clerk/nextjs/server"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Covers the segment on a full document load, and is what stops the sidebar
  // below from rendering for a signed-out visitor. It is not the only gate: a
  // layout doesn't re-run on client-side navigation between its own children,
  // so each page under it protects itself as well.
  //
  // A *pending* session — one still owing a session task like choosing an
  // organization — counts as signed out here and is redirected to /sign-in,
  // which is why /choose-organization lives outside this group.
  await auth.protect()

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden border shadow-none!">
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
