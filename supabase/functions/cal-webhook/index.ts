// Cal.com booking webhook: marks the contact as "booked" when they book
// through the link the AI sent them.
//
// In Cal.com: Settings -> Developer -> Webhooks -> New
//   Subscriber URL: https://<project>.supabase.co/functions/v1/cal-webhook?client=<CLIENT_ID>
//   Event: Booking Created   Secret: same value as CAL_WEBHOOK_SECRET
// Deploy with JWT verification OFF.

import { adminClient } from "../_shared/db.ts";
import { normalisePhone } from "../_shared/logic.ts";

const db = adminClient();

async function validSignature(raw: string, given: string | null): Promise<boolean> {
  const secret = Deno.env.get("CAL_WEBHOOK_SECRET");
  if (!secret) return true; // no secret configured -> accept (not recommended)
  if (!given) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === given;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const clientId = new URL(req.url).searchParams.get("client");
  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-cal-signature-256")))) {
    return new Response("Invalid signature", { status: 403 });
  }
  if (!clientId) return new Response("Missing ?client=", { status: 400 });

  const event = JSON.parse(raw || "{}");
  if (event.triggerEvent !== "BOOKING_CREATED") return new Response("ignored");

  const p = event.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const rawPhone = p.responses?.attendeePhoneNumber?.value ?? attendee.phoneNumber ?? p.responses?.phone?.value ?? null;
  const phone = normalisePhone(rawPhone);
  const email = (attendee.email ?? p.responses?.email?.value ?? "").toLowerCase() || null;

  let contact = null;
  if (phone) {
    ({ data: contact } = await db.from("contacts").select("*").eq("client_id", clientId).eq("phone", phone).maybeSingle());
  }
  if (!contact && email) {
    ({ data: contact } = await db.from("contacts").select("*").eq("client_id", clientId).ilike("email", email).maybeSingle());
  }
  if (!contact) {
    console.log(`Booking with no matching contact (client ${clientId})`);
    return new Response("no match");
  }

  const when = p.startTime ? new Date(p.startTime).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "";
  await db.from("contacts").update({
    status: contact.status === "sold" ? "sold" : "booked",
    email: contact.email ?? email,
    notes: [contact.notes, `Booked via Cal.com${when ? ` for ${when}` : ""}`].filter(Boolean).join("\n"),
  }).eq("id", contact.id);
  await db.from("conversations").update({
    needs_attention: false,
    last_message_preview: `📅 Booked${when ? ` for ${when}` : ""}`,
  }).eq("contact_id", contact.id);

  return new Response("ok");
});
