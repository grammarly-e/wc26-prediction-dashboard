"use client";

// ============================================================================
// "You scored X points since your last visit" banner.
//
// Uses localStorage to remember the last total the participant saw. On mount,
// compares current total to stored value — if points have increased, shows a
// brief celebratory banner, then dismisses after a few seconds or on click.
//
// Key format: `wc26_last_pts_${participantId}` to scope per-participant on a
// shared device.
// ============================================================================

import { useEffect, useState } from "react";

export default function ScoreBanner({
  currentPoints,
  participantId,
}: {
  currentPoints: number;
  participantId: string;
}) {
  const [diff, setDiff] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const key = `wc26_last_pts_${participantId}`;
    try {
      const stored = localStorage.getItem(key);
      const last = stored !== null ? parseInt(stored, 10) : null;
      // Update stored value immediately so refreshing doesn't re-show
      localStorage.setItem(key, String(currentPoints));
      if (last !== null && currentPoints > last) {
        setDiff(currentPoints - last);
        setVisible(true);
        // Auto-dismiss after 6 seconds
        const t = setTimeout(() => setVisible(false), 6000);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage unavailable (private browsing, storage full, etc.) — silent fail
    }
  }, [currentPoints, participantId]);

  if (!visible || diff === null) return null;

  return (
    <div
      role="status"
      onClick={() => setVisible(false)}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">🎉</span>
        <div>
          <p className="text-sm font-semibold text-emerald-800">
            You earned +{diff} {diff === 1 ? "point" : "points"} since your last visit
          </p>
          <p className="text-xs text-emerald-600">{currentPoints} match points total</p>
        </div>
      </div>
      <button
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-emerald-600 hover:bg-emerald-100"
      >
        ✕
      </button>
    </div>
  );
}
