// The inbound-message pipeline, shared by the real Twilio webhook and the
// dashboard's "Simulate a reply" test tool, so both run exactly the same logic.
// In simulated mode nothing is ever sent by SMS.

import { adminClient, dashboardLink, notifyClient } from "./db.ts";
import { sendSms, SendResult } from "./twilio.ts";
import { isOptIn, isOptOut, normalisePhone } from "./logic.ts";
import { decideReply, Intent } from "./ai.ts";

const db = adminClient();

const INTENT_TO_STATUS: Partial<Record<Intent, string>> = {
  interested: "interested",
  not_interested: "not_interested",
  wrong_person: "wrong_person",
  already_booked: "booked",
};
// Statuses the AI should never move a contact backwards from.
const PROTECTED = new Set(["booked", "sold", "opted_out"]);

async function logOutbound(p: {
  conversationId: string; clientId: string; campaignId: string | null;
  sender: "ai" | "system"; body: string; from: string | null; to: string; simulated: boolean;
}) {
  const r: SendResult = p.simulated || !p.from
    ? { sid: `SIM${crypto.randomUUID().replace(/-/g, "")}`, status: "simulated", error: null }
    : await sendSms(p.from, p.to, p.body);
  await db.from("messages").insert({
    conversation_id: p.conversationId,
    client_id: p.clientId,
    campaign_id: p.campaignId,
    direction: "outbound",
    sender: p.sender,
    body: p.body,
    twilio_sid: r.sid,
    status: r.status,
    error: r.error,
  });
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: p.body.slice(0, 140),
  }).eq("id", p.conversationId);
}

export type InboundInput = {
  from: string;            // the contact's number (any format)
  body: string;
  sid?: string | null;     // Twilio MessageSid (real messages only)
  to?: string;             // the client's Twilio number (real messages)
  clientId?: string;       // or the client directly (simulations)
  simulated?: boolean;
};

export type InboundResult = { ok: boolean; conversationId?: string; note?: string };

export async function processInbound(input: InboundInput): Promise<InboundResult> {
  const simulated = !!input.simulated;
  const from = normalisePhone(input.from);
  const body = (input.body ?? "").trim();
  const sid = input.sid ?? null;
  if (!from) return { ok: false, note: "Invalid phone number" };
  if (!body) return { ok: false, note: "Empty message" };

  // Which client is this for?
  let client;
  if (input.clientId) {
    ({ data: client } = await db.from("clients").select("*").eq("id", input.clientId).maybeSingle());
  } else {
    const to = normalisePhone(input.to);
    if (to) ({ data: client } = await db.from("clients").select("*").eq("twilio_number", to).maybeSingle());
  }
  if (!client) {
    console.warn(`Inbound for unknown client/number ${input.to ?? input.clientId}`);
    return { ok: false, note: "Unknown client" };
  }
  const tag = simulated ? "[TEST] " : "";

  // Ignore Twilio retries of a message we've already stored.
  if (sid) {
    const { data: dupe } = await db.from("messages").select("id").eq("twilio_sid", sid).maybeSingle();
    if (dupe) return { ok: true, note: "duplicate" };
  }

  // Find or create the contact.
  let { data: contact } = await db.from("contacts").select("*")
    .eq("client_id", client.id).eq("phone", from).maybeSingle();
  if (!contact) {
    const ins = await db.from("contacts").insert({
      client_id: client.id, phone: from, consent_source: simulated ? "Test contact (simulated)" : "Texted in", status: "replied",
    }).select("*").single();
    contact = ins.data;
  }
  if (!contact) return { ok: false, note: "Could not create contact" };

  // Find or create the conversation.
  const { data: conv } = await db.from("conversations").upsert(
    { client_id: client.id, contact_id: contact.id },
    { onConflict: "client_id,contact_id", ignoreDuplicates: false },
  ).select("*").single();
  if (!conv) return { ok: false, note: "Could not open conversation" };
  const done = (note?: string): InboundResult => ({ ok: true, conversationId: conv.id, note });

  const { data: inbound } = await db.from("messages").insert({
    conversation_id: conv.id,
    client_id: client.id,
    campaign_id: conv.campaign_id,
    direction: "inbound",
    sender: "contact",
    body,
    twilio_sid: sid,
    status: simulated ? "simulated" : "received",
  }).select("id").single();

  await db.from("conversations").update({
    last_message_at: new Date().toISOString(),
    last_message_preview: body.slice(0, 140),
  }).eq("id", conv.id);

  // Any reply stops the follow-up sequence for this contact.
  await db.from("campaign_contacts").update({ completed: true, completed_reason: "replied", next_send_at: null })
    .eq("contact_id", contact.id).eq("completed", false);

  const send = (text: string, sender: "ai" | "system" = "system") =>
    logOutbound({
      conversationId: conv.id, clientId: client.id, campaignId: conv.campaign_id,
      sender, body: text, from: client.twilio_number, to: from, simulated,
    });

  // ---- Opt-out / opt-in: decided in code, before the AI ever sees it ----
  if (isOptOut(body)) {
    await db.from("contacts").update({
      opted_out: true, opted_out_at: new Date().toISOString(), status: "opted_out",
    }).eq("id", contact.id);
    await db.from("campaign_contacts").update({ completed: true, completed_reason: "opted_out", next_send_at: null })
      .eq("contact_id", contact.id);
    await db.from("conversations").update({ ai_enabled: false, needs_attention: false }).eq("id", conv.id);
    await db.from("messages").update({ ai_intent: "opt_out" }).eq("id", inbound!.id);
    await send(`You've been unsubscribed and won't receive any more texts from ${client.name}. Reply START to resubscribe.`);
    return done("opted out");
  }
  if (isOptIn(body)) {
    await db.from("contacts").update({ opted_out: false, opted_out_at: null, status: "replied" }).eq("id", contact.id);
    await db.from("messages").update({ ai_intent: "opt_in" }).eq("id", inbound!.id);
    await send(`Thanks, you're resubscribed to texts from ${client.name}. Reply STOP at any time to opt out.`);
    return done("opted back in");
  }
  // Someone who opted out and texts again (without START) gets no automated reply.
  if (contact.opted_out) {
    await db.from("conversations").update({ needs_attention: true }).eq("id", conv.id);
    return done("contact is opted out: no automated reply");
  }

  if (["new", "contacted"].includes(contact.status)) {
    await db.from("contacts").update({ status: "replied" }).eq("id", contact.id);
  }

  const who = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || from;

  // ---- A person has taken over this conversation ----
  if (!conv.ai_enabled) {
    await db.from("conversations").update({ needs_attention: true }).eq("id", conv.id);
    await notifyClient(client.notify_email, `${tag}New reply from ${who}`,
      `${who} replied:\n\n"${body}"\n\nReply here: ${dashboardLink(client.id, conv.id)}`);
    return done("AI is off: alerted you instead");
  }

  // ---- AI reply ----
  const { data: history } = await db.from("messages").select("direction, body")
    .eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(30);

  let decision;
  try {
    decision = await decideReply({
      businessName: client.name,
      businessDescription: client.business_description,
      aiInstructions: client.ai_instructions,
      agentName: client.agent_name,
      bookingUrl: client.booking_url,
      contactFirstName: contact.first_name,
      history: (history ?? []).reverse().map((m) => ({
        role: m.direction === "inbound" ? "contact" as const : "business" as const,
        text: m.body,
      })),
    });
  } catch (e) {
    console.error("AI failed", e);
    await db.from("conversations").update({ needs_attention: true }).eq("id", conv.id);
    await notifyClient(client.notify_email, `${tag}Reply from ${who} needs you`,
      `The AI couldn't respond to ${who}:\n\n"${body}"\n\nReply here: ${dashboardLink(client.id, conv.id)}`);
    return done("AI failed: " + (e as Error).message);
  }

  await db.from("messages").update({ ai_intent: decision.intent }).eq("id", inbound!.id);

  const newStatus = INTENT_TO_STATUS[decision.intent];
  if (newStatus && !PROTECTED.has(contact.status)) {
    await db.from("contacts").update({ status: newStatus }).eq("id", contact.id);
  }

  if (decision.reply) await send(decision.reply, "ai");

  const flag = decision.needs_human || decision.intent === "interested";
  if (flag) {
    await db.from("conversations").update({ needs_attention: true }).eq("id", conv.id);
    const heading = decision.intent === "interested" ? `🔥 ${who} is interested` : `${who} needs a reply from you`;
    await notifyClient(client.notify_email, tag + heading,
      `${decision.summary}\n\nTheir message: "${body}"\n${decision.reply ? `AI replied: "${decision.reply}"\n` : ""}\nOpen conversation: ${dashboardLink(client.id, conv.id)}`);
  }
  return done(decision.intent);
}
