"use server";

// ============================================================================
// Server actions that require elevated (service-role) database access.
// These run on the server only — the service-role key is never sent to the
// browser. Import from Client Components via the normal server-action pattern.
// ============================================================================

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Re-links an existing participant record to a new anonymous session.
 *
 * Called when a user enters a display name that already exists in the
 * participants table. We issue a fresh anonymous sign-in (new auth.users row)
 * and then update the participant's auth_user_id to point at the new session,
 * effectively "transferring" the account to the current browser.
 *
 * Security note: anyone who knows a display name can take over that account.
 * Acceptable for a casual office prediction game with no sensitive data.
 *
 * Returns true on success, false if the name doesn't exist or update fails.
 */
export async function reconnectByDisplayName(
  displayName: string,
  newAuthUserId: string
): Promise<boolean> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("participants")
    .update({ auth_user_id: newAuthUserId })
    .eq("display_name", displayName)
    .select("id");

  return !error && Array.isArray(data) && data.length > 0;
}
