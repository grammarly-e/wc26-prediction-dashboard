// ============================================================================
// Admin authentication helpers.
//
// Auth model: a single ADMIN_PASSWORD environment variable. On login, the
// password is hashed (SHA-256) and stored in an httpOnly cookie. Every admin
// API route and the admin server component verify the cookie against the hash.
//
// Keep ADMIN_PASSWORD server-side only — never use NEXT_PUBLIC_ADMIN_PASSWORD.
// ============================================================================

import { createHash } from "crypto";
import { cookies } from "next/headers";

/** SHA-256 of ADMIN_PASSWORD — stored in the admin_token cookie. */
export function adminTokenHash(): string {
  return createHash("sha256")
    .update(process.env.ADMIN_PASSWORD ?? "")
    .digest("hex");
}

/** Returns true if the current request carries a valid admin_token cookie. */
export function isAdminAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = cookies().get("admin_token")?.value;
  return Boolean(token && token === adminTokenHash());
}
