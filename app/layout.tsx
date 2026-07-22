import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Classroom Opinion Analytics Platform",
  description: "Collects and analyses binary student opinions across paired assignments.",
};

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
