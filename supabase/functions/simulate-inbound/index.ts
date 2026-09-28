// "Simulate a reply" test tool in the dashboard inbox.
// Pretends a text arrived from `phone`, and runs it through exactly the same
// pipeline as a real Twilio message (opt-out check, AI, status updates, alerts).
// Nothing is sent by SMS: every outgoing reply is logged with status "simulated".
// JWT verification ON: only logged-in users with access to the client can use it.

import { corsHeaders, json, userClient } from "../_shared/db.ts";
import { processInbound } from "../_shared/inbound.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { client_id, phone, body } = await req.json().catch(() => ({}));
  if (!client_id || !phone || !body) return json({ error: "client_id, phone and body are required" }, 400);

  // Reading through the user's own session proves they can access this client.
  const { data: client } = await userClient(req).from("clients").select("id").eq("id", client_id).maybeSingle();
  if (!client) return json({ error: "Client not found" }, 404);

  const result = await processInbound({ clientId: client.id, from: phone, body, simulated: true });
  if (!result.ok) return json({ error: result.note ?? "Simulation failed" }, 400);
  return json(result);
});
