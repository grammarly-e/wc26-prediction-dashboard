// ============================================================================
// Supabase session refresh middleware.
//
// @supabase/ssr stores auth tokens in cookies. The server-side client can read
// cookies inside Server Components, but it CANNOT write them back (Next.js
// blocks cookie mutation outside of Route Handlers / Server Actions). The only
// place a server can both read and write response cookies is middleware.
//
// Without this file, a participant's JWT access token expires after ~1 hour and
// is never refreshed — so they appear logged out on their next page visit even
// though their session (refresh token) is still valid. The supabase.auth.getUser()
// call below triggers the refresh internally and forwards the new token cookies
// to the response, keeping every participant silently logged in for as long as
// their refresh token is valid (default: 7 days).
//
// See: https://supabase.com/docs/guides/auth/server-side/nextjs
// ============================================================================

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // First, update the request cookies so any downstream middleware sees
          // the refreshed token.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Rebuild the response so the Set-Cookie headers are forwarded to
          // the browser — this is the part that actually persists the refresh.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add any logic between createServerClient and getUser().
  // getUser() is what triggers the token refresh; splitting it causes subtle
  // race conditions where the session is read before the refresh completes.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on every request except static assets and image optimisation paths.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
