import type { Metadata } from "next";
import { Suspense } from "react";

import AutoRefresher from "@/components/AutoRefresher";
import Nav from "@/components/Nav";
import PendingBadge from "@/components/PendingBadge";

import "./globals.css";

export const metadata: Metadata = {
  title: "WC26 Prediction Dashboard — Live Data",
  description: "Live FIFA World Cup 2026 scores, standings, and top scorers, synced from football-data.org.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Polls every 30s and refreshes server data — see AutoRefresher.tsx.
            PendingBadge streams in via Suspense without blocking Nav render. */}
        <AutoRefresher />
        <Nav pendingBadge={<Suspense fallback={null}><PendingBadge /></Suspense>} />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
