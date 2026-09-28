import { ok as assert, deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  inSendWindow, isOptIn, isOptOut, normalisePhone, renderTemplate, sequenceStep,
  smsSegments, startOfLocalDay, withOptOutFooter,
} from "../functions/_shared/logic.ts";
import { computeTwilioSignature } from "../functions/_shared/twilio.ts";
import { buildSystemPrompt } from "../functions/_shared/ai.ts";

Deno.test("normalisePhone handles UK formats", () => {
  assertEquals(normalisePhone("07700 900123"), "+447700900123");
  assertEquals(normalisePhone("+44 7700 900123"), "+447700900123");
  assertEquals(normalisePhone("+44 (0)7700 900123"), "+447700900123");
  assertEquals(normalisePhone("447700900123"), "+447700900123");
  assertEquals(normalisePhone("0044 7700-900-123"), "+447700900123");
  assertEquals(normalisePhone("7700900123"), "+447700900123");
  assertEquals(normalisePhone("0161 496 0000"), "+441614960000");
  assertEquals(normalisePhone("12345"), null);
  assertEquals(normalisePhone("not a number"), null);
  assertEquals(normalisePhone(""), null);
});

Deno.test("opt-out detection is strict", () => {
  for (const s of ["STOP", "stop", "Stop!", " stop ", "please stop", "Unsubscribe", "STOP ALL".replace(" ", ""), "remove me", "Stop thanks"]) {
    assert(isOptOut(s), `should opt out: ${s}`);
  }
  for (const s of ["don't stop", "can you stop by tomorrow?", "yes please", "when do you close", ""]) {
    assert(!isOptOut(s), `should NOT opt out: ${s}`);
  }
  assert(isOptIn("START"));
  assert(!isOptIn("start me a quote"));
});

Deno.test("templates render and collapse missing names", () => {
  assertEquals(renderTemplate("Hi {first_name}, it's {agent_name}.", { first_name: "Jo", agent_name: "Sam" }), "Hi Jo, it's Sam.");
  assertEquals(renderTemplate("Hi {first_name}, quick one", { first_name: null }), "Hi, quick one");
});

Deno.test("opt-out footer added once", () => {
  assert(withOptOutFooter("Hello").endsWith("Reply STOP to opt out"));
  assertEquals(withOptOutFooter("Hi, text STOP to opt out"), "Hi, text STOP to opt out");
});

Deno.test("sequence steps", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const f = [{ delay_hours: 48, message: "F1" }, { delay_hours: 72, message: "F2" }];
  const s0 = sequenceStep("Open", f, 0, now)!;
  assertEquals(s0.body, "Open");
  assertEquals(s0.nextSendAt!.toISOString(), "2026-10-03T10:00:00.000Z");
  const s1 = sequenceStep("Open", f, 1, now)!;
  assertEquals(s1.body, "F1");
  assertEquals(s1.nextSendAt!.toISOString(), "2026-10-04T10:00:00.000Z");
  const s2 = sequenceStep("Open", f, 2, now)!;
  assertEquals(s2.body, "F2");
  assertEquals(s2.nextSendAt, null);
  assertEquals(sequenceStep("Open", f, 3, now), null);
  assertEquals(sequenceStep("Open", [], 0, now)!.nextSendAt, null);
});

Deno.test("quiet hours respect UK time incl. BST", () => {
  // 08:30 UTC in October = 09:30 BST -> inside 9-20
  assert(inSendWindow(new Date("2026-10-01T08:30:00Z"), "Europe/London", 9, 20));
  // 07:30 UTC in October = 08:30 BST -> outside
  assert(!inSendWindow(new Date("2026-10-01T07:30:00Z"), "Europe/London", 9, 20));
  // 19:30 UTC in December = 19:30 GMT -> inside; 20:00 -> outside
  assert(inSendWindow(new Date("2026-12-01T19:30:00Z"), "Europe/London", 9, 20));
  assert(!inSendWindow(new Date("2026-12-01T20:00:00Z"), "Europe/London", 9, 20));
});

Deno.test("start of local day", () => {
  assertEquals(startOfLocalDay(new Date("2026-10-01T15:00:00Z"), "Europe/London").toISOString(), "2026-09-30T23:00:00.000Z");
  assertEquals(startOfLocalDay(new Date("2026-12-01T15:00:00Z"), "Europe/London").toISOString(), "2026-12-01T00:00:00.000Z");
});

Deno.test("sms segments", () => {
  assertEquals(smsSegments("a".repeat(160)), 1);
  assertEquals(smsSegments("a".repeat(161)), 2);
  assertEquals(smsSegments("Hi 😀"), 1);
  assertEquals(smsSegments("😀".repeat(40)), 2);
});

Deno.test("Twilio signature matches Node's crypto implementation", async () => {
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const ours = await computeTwilioSignature(token, url, params);
  const { createHmac } = await import("node:crypto");
  const data = url + Object.keys(params).sort().map((k) => k + (params as Record<string, string>)[k]).join("");
  const ref = createHmac("sha1", token).update(data).digest("base64");
  assertEquals(ours, ref);
});

Deno.test("system prompt includes booking link and honesty rule", () => {
  const p = buildSystemPrompt({
    businessName: "Central Motors", businessDescription: "Used car dealer in Rochdale", aiInstructions: "",
    agentName: "Sarah", bookingUrl: "https://cal.com/central/test-drive", contactFirstName: "Jo", history: [],
  });
  assert(p.includes("https://cal.com/central/test-drive"));
  assert(p.includes("be honest"));
});
