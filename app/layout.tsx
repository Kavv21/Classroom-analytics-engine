import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Classroom Opinion Analytics Platform",
  description: "Collects and analyses binary student opinions across paired assignments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
