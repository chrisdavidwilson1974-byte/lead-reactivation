// Receives every inbound SMS from Twilio.
// Twilio number -> "A message comes in" webhook -> this function (HTTP POST).
// Deploy with JWT verification OFF (Twilio can't send a Supabase token).

import { readTwilioWebhook, twimlResponse } from "../_shared/twilio.ts";
import { processInbound } from "../_shared/inbound.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const params = await readTwilioWebhook(req, "twilio-inbound");
  if (!params) return new Response("Invalid signature", { status: 403 });

  // Answer Twilio straight away; do the work (incl. the AI call) in the background.
  const work = processInbound({
    from: params.From,
    to: params.To,
    body: params.Body ?? "",
    sid: params.MessageSid ?? params.SmsSid ?? null,
  }).catch((e) => console.error("Inbound handler error", e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work);
  else await work;

  return twimlResponse();
});
