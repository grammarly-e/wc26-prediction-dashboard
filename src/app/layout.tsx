import type { Metadata } from "next";

import AutoRefresher from "@/components/AutoRefresher";
import Nav from "@/components/Nav";

import "./globals.css";

export const metadata: Metadata = {
  title: "WC26 Prediction Dashboard — Live Data",
  description: "Live FIFA World Cup 2026 scores, standings, and top scorers, synced from football-data.org.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Polls every 30s and refreshes server data — see
            src/components/AutoRefresher.tsx for why polling beats Supabase
            Realtime here (one less manual setup step, same practical result
            given the sync job's 10-minute cadence). */}
        <AutoRefresher />
        <Nav />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
