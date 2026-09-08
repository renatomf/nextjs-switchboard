import type { Metadata } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import "@clerk/ui/themes/shadcn.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// The template puts the workflow name in front of the product name, so a canvas
// left open in a background tab is identifiable by what it holds rather than by
// a row of identical titles. `default` covers every route that sets none.
export const metadata: Metadata = {
  title: {
    default: "Switchboard",
    template: "%s · Switchboard",
  },
  description:
    "Build browser automations visually, run them in cloud browsers, and replay every run.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ClerkProvider
          appearance={{ theme: shadcn }}
          taskUrls={{ "choose-organization": "/choose-organization" }}
        >
          <ThemeProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
