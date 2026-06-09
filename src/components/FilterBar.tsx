"use client";

// ============================================================================
// Match filter bar — group pills (A–L + Knockout) and a team-name search input.
//
// Architecture: URL-based filtering. Clicking a group pill or typing in the
// search box updates ?group= / ?q= params and triggers a server re-render,
// which runs the filter logic in the Server Component (no extra client state
// needed there). useTransition keeps the old content visible while the new
// render loads, so the page never flashes blank.
// ============================================================================

import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef } from "react";

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export default function FilterBar({
  activeGroup,
  activeSearch,
}: {
  /** Currently active group filter: a letter A–L, "knockout", or null (all). */
  activeGroup: string | null;
  /** Currently active team-name search string. */
  activeSearch: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(activeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(group: string | null, q: string) {
    const params = new URLSearchParams();
    if (group) params.set("group", group);
    if (q.trim()) params.set("q", q.trim());
    const url = params.toString() ? `${pathname}?${params}` : pathname;
    startTransition(() => router.push(url));
  }

  function handleGroupClick(g: string | null) {
    navigate(g, searchValue);
  }

  function handleSearchChange(val: string) {
    setSearchValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(activeGroup, val), 350);
  }

  const pillBase = "rounded-lg px-3 py-1 text-xs font-semibold transition";
  const pillActive = "bg-pitch text-gold";
  const pillInactive = "bg-neutral-100 text-neutral-600 hover:bg-neutral-200";

  return (
    <div className={`flex flex-col gap-3 transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => handleGroupClick(null)}
          className={`${pillBase} ${activeGroup === null ? pillActive : pillInactive}`}
        >
          All
        </button>
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => handleGroupClick(activeGroup === g ? null : g)}
            className={`${pillBase} ${activeGroup === g ? pillActive : pillInactive}`}
          >
            Group {g}
          </button>
        ))}
        <button
          onClick={() => handleGroupClick(activeGroup === "knockout" ? null : "knockout")}
          className={`${pillBase} ${activeGroup === "knockout" ? pillActive : pillInactive}`}
        >
          Knockout
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by team…"
          className="w-full max-w-xs rounded-lg border border-neutral-200 px-3 py-1.5 text-sm focus:border-pitch focus:outline-none"
        />
        {searchValue && (
          <button
            onClick={() => {
              setSearchValue("");
              navigate(activeGroup, "");
            }}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            Clear ×
          </button>
        )}
      </div>
    </div>
  );
}
