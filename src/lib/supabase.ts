import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Realtime-only client (quiz board, availability, recruitment). Not used for auth
// or data fetching.
//
// This module used to call createClient() at module scope. createClient throws on
// a missing OR malformed URL, and a module-scope throw is unrecoverable: it takes
// down every component that imports this file, on the client, during hydration.
// A bad NEXT_PUBLIC_SUPABASE_URL in one environment therefore white-screened the
// homepage, the availability board, both quiz surfaces and all of recruitment,
// with no digest to trace it by, even though realtime is a progressive
// enhancement none of those pages actually need to render.
//
// So the client is built lazily and the failure is contained: callers get null,
// skip their subscription, and the page renders. Live updates degrade to whatever
// polling the caller already does.

function readConfig(): { url: string; key: string } | null {
  // Must be static property reads: Next inlines NEXT_PUBLIC_* at build time and
  // cannot substitute a dynamic lookup.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  // Same rule createClient enforces, checked here so a bad value is a disabled
  // feature rather than a thrown error.
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, key };
}

export const isRealtimeConfigured = readConfig() !== null;

let cached: SupabaseClient | null = null;

/** The realtime client, or null when it is unconfigured or misconfigured. */
export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const config = readConfig();
  if (!config) return null;
  try {
    cached = createClient(config.url, config.key);
    return cached;
  } catch (err) {
    // Belt and braces: a future validation rule must not become an outage.
    console.error("[supabase] realtime disabled:", err);
    return null;
  }
}
