import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase credentials not found. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file."
  );
}

// Only create client if URL is valid to prevent crash
export const supabase = (supabaseUrl && supabaseUrl.startsWith("http"))
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as any);
