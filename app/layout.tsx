import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Classroom Opinion Analytics Platform",
  description: "Collects and analyses binary student opinions across paired assignments.",
};

/**
 * NOTE — the global sidebar shell is built but NOT mounted.
 *
 * `components/shell/app-shell.tsx` is complete and typechecks, but
 * mounting it here made two end-to-end tests fail: the Excel export link
 * and the admin console link never became "visible, enabled and stable",
 * because something inside shadcn's SidebarProvider keeps the layout
 * shifting after paint. Disabling the sidebar's width/left transitions
 * (which violated this project's motion budget anyway, and that override
 * is kept in globals.css) did not settle it.
 *
 * Unmounting it makes all 21 e2e tests pass again, which is the
 * confirming experiment. A shell is polish; the export button and admin
 * navigation are functionality, so the functionality wins until the
 * instability is properly diagnosed. Mounting it is a one-line change
 * once that is fixed — see the phase report.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        {/* Toasts announce the outcome of an action in the same words as
            the control that caused it ("Publish" -> "Published"). */}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
