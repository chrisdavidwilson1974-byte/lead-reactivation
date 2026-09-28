import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const configured = Boolean(url && anon);

export const supabase = createClient(url || "http://localhost", anon || "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const functionsBase = `${(url || "").replace(/\/$/, "")}/functions/v1`;

/** Call one of our Edge Functions as the logged-in user. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Surface the function's own error message when there is one.
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = (await ctx.json()).error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}
