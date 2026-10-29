"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client: used only to upload files straight to private storage. */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
