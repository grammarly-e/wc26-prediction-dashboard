import MatchCard from "@/components/MatchCard";
import {
  getLastSyncedAt,
  getLiveMatches,
  getRecentResults,
  getTeamNameMap,
  getUpcomingMatches,
} from "@/lib/data";

export const revalidate = 0; // always fetch fresh — Realtime keeps the client in sync anyway

function SyncFooter({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  return (
    <p className="mt-8 text-center text-xs text-neutral-400">
      {lastSyncedAt
        ? `Live data last synced ${new Date(lastSyncedAt).toLocaleString()} · source: football-data.org`
        : "No live data synced yet — run `npm run sync` once FOOTBALL_DATA_API_KEY is configured."}
      {" "}This page updates automatically as new data arrives.
    </p>
  );
}

function Section({ title, matches, teamNames, emptyText }: {
  title: string;
  matches: Awaited<ReturnType<typeof getLiveMatches>>;
  teamNames: Map<string, string>;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {matches.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">{emptyText}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} teamNames={teamNames} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function OverviewPage() {
  const [live, upcoming, results, teamNames, lastSyncedAt] = await Promise.all([
    getLiveMatches(),
    getUpcomingMatches(),
    getRecentResults(),
    getTeamNameMap(),
    getLastSyncedAt(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">World Cup 2026 — Live Overview</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Real-time scores, results, and what&apos;s coming up next, synced automatically from football-data.org.
        </p>
      </div>

      <Section
        title={`Live now (${live.length})`}
        matches={live}
        teamNames={teamNames}
        emptyText="Nothing kicking off right now — check back at the next scheduled kickoff."
      />

      <Section
        title="Latest results"
        matches={results}
        teamNames={teamNames}
        emptyText="No matches have finished yet."
      />

      <Section
        title="Coming up"
        matches={upcoming}
        teamNames={teamNames}
        emptyText="The full schedule is loaded — kickoff times will appear here as the tournament approaches."
      />

      <SyncFooter lastSyncedAt={lastSyncedAt} />
    </div>
  );
}
