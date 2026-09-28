import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client: bypasses RLS. Only use server-side. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Client acting as the logged-in user (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    },
  );
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Email the client when a conversation needs them. Uses Resend if RESEND_API_KEY is set; otherwise logs. */
export async function notifyClient(to: string | null, subject: string, text: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "Revive <onboarding@resend.dev>";
  if (!to) return;
  if (!key) {
    console.log(`[notify skipped: no RESEND_API_KEY] ${to}: ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) console.error("Notify failed", res.status, await res.text());
}

export function dashboardLink(clientId: string, conversationId?: string): string {
  const base = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  return `${base}/clients/${clientId}/inbox${conversationId ? `?c=${conversationId}` : ""}`;
}
