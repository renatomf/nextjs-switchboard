import { PricingTable } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"
import { Building2 } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default async function Page() {
  // `for="organization"` bills the *active* organization, so without one Clerk
  // has nothing to subscribe. The sidebar's OrganizationSwitcher runs with
  // `hidePersonal`, and the instance forces org selection at sign-in, so this
  // is a guard rather than a path users normally hit.
  const { orgId } = await auth.protect()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-muted-foreground text-sm">
            Choose the plan for your organization. Everyone in the organization
            shares its subscription.
          </p>
        </div>

        {orgId ? (
          // Renders the Organization plans configured in Clerk and opens
          // Clerk's in-app checkout drawer on select — subscribe, upgrade and
          // cancel all happen in here, so there is no checkout route to build.
          <PricingTable
            for="organization"
            newSubscriptionRedirectUrl="/billing"
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyTitle>No organization selected</EmptyTitle>
              <EmptyDescription>
                Select an organization from the sidebar to see the plans it can
                subscribe to.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
