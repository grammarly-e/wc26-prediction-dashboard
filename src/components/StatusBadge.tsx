import type { MatchStatus } from "@/lib/types";

const STYLES: Record<MatchStatus, string> = {
  live: "bg-red-100 text-red-700",
  finished: "bg-neutral-200 text-neutral-700",
  scheduled: "bg-pitch/10 text-pitch",
  postponed: "bg-amber-100 text-amber-700",
  cancelled: "bg-neutral-200 text-neutral-500 line-through",
};

const LABELS: Record<MatchStatus, string> = {
  live: "Live",
  finished: "Final",
  scheduled: "Scheduled",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

export default function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <span className={`badge ${STYLES[status]}`}>
      {status === "live" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-600" />
        </span>
      )}
      {LABELS[status]}
    </span>
  );
}
