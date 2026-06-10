"use client";

// ============================================================================
// "Join the prediction game" — the entire sign-up flow, in one form.
//
// Why anonymous auth instead of email/password: this is a casual office
// activity, not an account system. Supabase's anonymous sign-in
// (auth.signInAnonymously) creates a real, unique session for the browser
// with no email required — the participant just picks a display name. That
// keeps the UX to "type a name, click Join" while still giving every
// participant a real account that Row Level Security can lock predictions
// to (see supabase/migrations/0002_row_level_security.sql) — nobody can see
// or edit anyone else's picks before they're revealed.
//
// IMPORTANT one-time setup: Anonymous Sign-Ins must be enabled in the
// Supabase dashboard (Authentication > Sign In / Providers > Anonymous
// Sign-Ins) or this will fail with "Anonymous sign-ins are disabled".
// See SETUP_AND_VERIFY.md.
// ============================================================================

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { reconnectByDisplayName } from "@/app/actions";

export default function JoinForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      setError("Display names must be 2-40 characters.");
      return;
    }

    setStatus("loading");
    setError(null);
    const supabase = createClient();

    // Reuse an existing anonymous session if the page reloaded mid-signup
    // (e.g. they typed a taken name and tried again) -- no need for a fresh one.
    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const { data, error: authError } = await supabase.auth.signInAnonymously();
      if (authError || !data.user) {
        setStatus("error");
        setError(
          authError?.message?.includes("disabled")
            ? "Anonymous sign-ins aren't enabled yet for this project -- see SETUP_AND_VERIFY.md."
            : "Couldn't start a session. Try refreshing the page."
        );
        return;
      }
      user = data.user;
    }

    const { error: insertError } = await supabase
      .from("participants")
      .insert({ auth_user_id: user.id, display_name: trimmed });

    if (insertError) {
      if (insertError.code === "23505") {
        // Display name already exists -- reconnect to the existing account
        // by updating its auth_user_id to the current anonymous session.
        const ok = await reconnectByDisplayName(trimmed, user.id);
        if (!ok) {
          setStatus("error");
          setError("Couldn't reconnect to that account. Try again.");
          return;
        }
        // Fall through to router.refresh() -- participant row now points at
        // the current session so getCurrentParticipant() will find it.
      } else {
        setStatus("idle");
        setError("Couldn't save your name. Try again.");
        return;
      }
    }

    // Re-render the server-component page now that a participants row
    // exists for this session -- getCurrentParticipant() will find it and
    // the page will swap from this form to the prediction UI.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3 p-5 sm:max-w-sm">
      <div>
        <h2 className="text-lg font-bold">Join the prediction game</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Pick a display name -- that&rsquo;s all it takes. No email, no password.
          Already joined? Enter your display name again to pick up where you left off.
        </p>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        maxLength={40}
        autoComplete="off"
        disabled={status === "loading"}
        className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pitch focus:outline-none disabled:opacity-50"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-gold transition hover:opacity-90 disabled:opacity-50"
      >
        {status === "loading" ? "Joining..." : "Join"}
      </button>
    </form>
  );
}
