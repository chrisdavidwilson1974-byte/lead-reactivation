// "Test the AI" sandbox in the dashboard. Runs the same AI agent the live
// system uses, against a pretend conversation. Nothing is sent or stored.
// JWT verification ON.

import { corsHeaders, json, userClient } from "../_shared/db.ts";
import { decideReply } from "../_shared/ai.ts";
import { isOptOut } from "../_shared/logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { client_id, history } = await req.json().catch(() => ({}));
  if (!client_id || !Array.isArray(history) || history.length === 0) {
    return json({ error: "client_id and history are required" }, 400);
  }

  const { data: client } = await userClient(req).from("clients").select("*").eq("id", client_id).maybeSingle();
  if (!client) return json({ error: "Client not found" }, 404);

  const last = history[history.length - 1];
  if (last?.role === "contact" && isOptOut(String(last.text ?? ""))) {
    return json({ decision: {
      intent: "opt_out",
      reply: `You've been unsubscribed and won't receive any more texts from ${client.name}. Reply START to resubscribe.`,
      needs_human: false,
      summary: "Opted out (handled automatically, not by the AI)",
    } });
  }

  try {
    const decision = await decideReply({
      businessName: client.name,
      businessDescription: client.business_description,
      aiInstructions: client.ai_instructions,
      agentName: client.agent_name,
      bookingUrl: client.booking_url,
      contactFirstName: null,
      history: history.slice(-30).map((h: { role: string; text: string }) => ({
        role: h.role === "contact" ? "contact" as const : "business" as const,
        text: String(h.text ?? ""),
      })),
    });
    return json({ decision });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
