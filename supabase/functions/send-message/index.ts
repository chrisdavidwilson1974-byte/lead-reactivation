// Sends a message typed by a person in the dashboard inbox.
// Called from the frontend with the user's login token (JWT verification ON).
// Sending a manual message automatically switches the AI off for that conversation.

import { adminClient, corsHeaders, json, userClient } from "../_shared/db.ts";
import { sendSms } from "../_shared/twilio.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { conversation_id, body, keep_ai } = await req.json().catch(() => ({}));
  const text = typeof body === "string" ? body.trim() : "";
  if (!conversation_id || !text) return json({ error: "conversation_id and body are required" }, 400);
  if (text.length > 1000) return json({ error: "Message too long" }, 400);

  // Reading through the user's client proves they're allowed to see this conversation.
  const asUser = userClient(req);
  const { data: conv, error } = await asUser.from("conversations")
    .select("id, client_id, campaign_id, contact:contacts(phone, opted_out), client:clients(twilio_number)")
    .eq("id", conversation_id).maybeSingle();
  if (error || !conv) return json({ error: "Conversation not found" }, 404);

  // deno-lint-ignore no-explicit-any
  const contact = conv.contact as any;
  // deno-lint-ignore no-explicit-any
  const client = conv.client as any;
  if (contact?.opted_out) return json({ error: "This contact has opted out. You can't text them." }, 409);
  const dryRun = Deno.env.get("TWILIO_DRY_RUN") === "true";
  if (!client?.twilio_number && !dryRun) return json({ error: "No Twilio number set for this client" }, 409);

  const { data: { user } } = await asUser.auth.getUser();
  const r = await sendSms(client?.twilio_number ?? "", contact.phone, text);

  const db = adminClient();
  const { data: msg } = await db.from("messages").insert({
    conversation_id: conv.id,
    client_id: conv.client_id,
    campaign_id: conv.campaign_id,
    direction: "outbound",
    sender: "human",
    body: text,
    twilio_sid: r.sid,
    status: r.status,
    error: r.error,
  }).select("*").single();

  await db.from("conversations").update({
    ai_enabled: keep_ai ? true : false,
    needs_attention: false,
    last_message_at: new Date().toISOString(),
    last_message_preview: text.slice(0, 140),
  }).eq("id", conv.id);

  if (r.error) return json({ error: `Twilio: ${r.error}`, message: msg }, 502);
  console.log(`Manual message sent by ${user?.email ?? "unknown"}`);
  return json({ message: msg });
});
