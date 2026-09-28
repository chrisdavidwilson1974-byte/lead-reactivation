// Runs every 5 minutes (see supabase/setup/schedule.sql).
// Sends due opening messages and follow-ups, respecting each client's
// sending hours and each campaign's daily limit.
// Deploy with JWT verification OFF; protected by the CRON_SECRET header instead.

import { adminClient, json } from "../_shared/db.ts";
import { sendSms } from "../_shared/twilio.ts";
import {
  Followup, inSendWindow, renderTemplate, sequenceStep, startOfLocalDay, withOptOutFooter,
} from "../_shared/logic.ts";

const db = adminClient();
const PER_RUN = parseInt(Deno.env.get("SEND_BATCH_PER_RUN") ?? "60", 10);
// In dry-run mode campaigns can be tested before a client has a Twilio number.
const DRY_RUN = Deno.env.get("TWILIO_DRY_RUN") === "true";

// Twilio error codes that mean "this number will never work" -> stop trying.
const PERMANENT_ERRORS = ["21211", "21612", "21614", "21610", "21408"];

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return json({ error: "unauthorised" }, 401);
  }

  const now = new Date();
  const summary: Record<string, unknown>[] = [];

  const { data: campaigns, error } = await db.from("campaigns")
    .select("*, client:clients(*)").eq("status", "active");
  if (error) return json({ error: error.message }, 500);

  for (const campaign of campaigns ?? []) {
    const client = campaign.client;
    const result: Record<string, unknown> = { campaign: campaign.name, sent: 0 };
    summary.push(result);

    if (!client?.active || (!client.twilio_number && !DRY_RUN)) { result.skipped = "client inactive or no number"; continue; }
    if (!inSendWindow(now, client.timezone, client.send_window_start, client.send_window_end)) {
      result.skipped = "outside sending hours"; continue;
    }

    const dayStart = startOfLocalDay(now, client.timezone).toISOString();
    const { count: sentToday } = await db.from("messages").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id).eq("direction", "outbound").in("sender", ["system"])
      .gte("created_at", dayStart);
    const remaining = campaign.daily_send_limit - (sentToday ?? 0);
    if (remaining <= 0) { result.skipped = "daily limit reached"; continue; }

    const { data: due } = await db.from("campaign_contacts")
      .select("*, contact:contacts(*)")
      .eq("campaign_id", campaign.id).eq("completed", false)
      .lte("next_send_at", now.toISOString())
      .order("next_send_at", { ascending: true })
      .limit(Math.min(remaining, PER_RUN));

    const followups: Followup[] = Array.isArray(campaign.followups) ? campaign.followups : [];

    for (const cc of due ?? []) {
      const contact = cc.contact;
      if (!contact || contact.opted_out) {
        await db.from("campaign_contacts").update({ completed: true, completed_reason: "opted_out", next_send_at: null }).eq("id", cc.id);
        continue;
      }
      const step = sequenceStep(campaign.opening_message, followups, cc.stage, now);
      if (!step) {
        await db.from("campaign_contacts").update({ completed: true, completed_reason: "sequence_done", next_send_at: null }).eq("id", cc.id);
        continue;
      }

      let body = renderTemplate(step.body, {
        first_name: contact.first_name,
        business_name: client.name,
        agent_name: client.agent_name,
      });
      if (cc.stage === 0) body = withOptOutFooter(body);

      const { data: conv } = await db.from("conversations").upsert(
        { client_id: client.id, contact_id: contact.id, campaign_id: campaign.id },
        { onConflict: "client_id,contact_id" },
      ).select("id").single();
      if (!conv) continue;

      const r = await sendSms(client.twilio_number ?? "", contact.phone, body);

      await db.from("messages").insert({
        conversation_id: conv.id,
        client_id: client.id,
        campaign_id: campaign.id,
        direction: "outbound",
        sender: "system",
        body,
        twilio_sid: r.sid,
        status: r.status,
        error: r.error,
      });

      if (r.error) {
        const permanent = PERMANENT_ERRORS.some((c) => r.error!.startsWith(c));
        await db.from("campaign_contacts").update(
          permanent
            ? { completed: true, completed_reason: "failed", next_send_at: null }
            : { next_send_at: new Date(now.getTime() + 30 * 60_000).toISOString() }, // retry in 30 min
        ).eq("id", cc.id);
        result.failed = ((result.failed as number) ?? 0) + 1;
        continue;
      }

      await db.from("conversations").update({
        last_message_at: now.toISOString(), last_message_preview: body.slice(0, 140),
      }).eq("id", conv.id);
      await db.from("campaign_contacts").update({
        stage: cc.stage + 1,
        next_send_at: step.nextSendAt?.toISOString() ?? null,
        completed: step.nextSendAt === null,
        completed_reason: step.nextSendAt === null ? "sequence_done" : null,
      }).eq("id", cc.id);
      if (contact.status === "new") {
        await db.from("contacts").update({ status: "contacted" }).eq("id", contact.id);
      }
      result.sent = (result.sent as number) + 1;
    }

    // Close the campaign once nobody is left in the sequence.
    const { count: open } = await db.from("campaign_contacts").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id).eq("completed", false);
    if ((open ?? 0) === 0) {
      await db.from("campaigns").update({ status: "completed", completed_at: now.toISOString() }).eq("id", campaign.id);
      result.completed = true;
    }
  }

  return json({ ran_at: now.toISOString(), campaigns: summary });
});
