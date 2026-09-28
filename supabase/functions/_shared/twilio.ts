// Twilio REST + webhook signature helpers (Deno / Supabase Edge runtime).

const ACCOUNT_SID = () => Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const AUTH_TOKEN = () => Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

export function functionUrl(name: string): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  return `${base.replace(/\/$/, "")}/functions/v1/${name}`;
}

export type SendResult = { sid: string | null; status: string; error: string | null };

/** Send an SMS. Set TWILIO_DRY_RUN=true to log instead of sending (useful for testing). */
export async function sendSms(from: string, to: string, body: string): Promise<SendResult> {
  if (Deno.env.get("TWILIO_DRY_RUN") === "true") {
    console.log(`[DRY RUN] ${from} -> ${to}: ${body}`);
    return { sid: `DRY${crypto.randomUUID().replace(/-/g, "")}`, status: "dry_run", error: null };
  }
  const sid = ACCOUNT_SID();
  const params = new URLSearchParams({
    From: from,
    To: to,
    Body: body,
    StatusCallback: functionUrl("twilio-status"),
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${AUTH_TOKEN()}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { sid: null, status: "failed", error: `${json.code ?? res.status}: ${json.message ?? "Twilio error"}` };
  }
  return { sid: json.sid, status: json.status ?? "queued", error: null };
}

/** Twilio signs requests: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Parse a Twilio webhook and verify it really came from Twilio. */
export async function readTwilioWebhook(req: Request, functionName: string): Promise<Record<string, string> | null> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  if (Deno.env.get("TWILIO_SKIP_SIGNATURE") === "true") return params;

  const given = req.headers.get("x-twilio-signature") ?? "";
  const expected = await computeTwilioSignature(AUTH_TOKEN(), functionUrl(functionName), params);
  if (!timingSafeEqual(given, expected)) {
    console.warn("Rejected webhook with bad Twilio signature");
    return null;
  }
  return params;
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export function twimlResponse(): Response {
  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
