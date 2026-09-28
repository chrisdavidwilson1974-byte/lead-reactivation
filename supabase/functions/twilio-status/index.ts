// Twilio delivery status callbacks (queued -> sent -> delivered / failed).
// Deploy with JWT verification OFF.

import { adminClient } from "../_shared/db.ts";
import { readTwilioWebhook } from "../_shared/twilio.ts";

const db = adminClient();

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const p = await readTwilioWebhook(req, "twilio-status");
  if (!p) return new Response("Invalid signature", { status: 403 });

  const sid = p.MessageSid ?? p.SmsSid;
  const status = p.MessageStatus ?? p.SmsStatus;
  if (sid && status) {
    const update: Record<string, string | null> = { status };
    if (p.ErrorCode) update.error = `${p.ErrorCode}${p.ErrorMessage ? `: ${p.ErrorMessage}` : ""}`;
    await db.from("messages").update(update).eq("twilio_sid", sid);
  }
  return new Response("ok");
});
