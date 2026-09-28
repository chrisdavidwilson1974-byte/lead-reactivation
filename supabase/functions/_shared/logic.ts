// Pure helpers with no runtime dependencies, so they can be unit tested.

/** Normalise a UK (or already international) phone number to E.164. Returns null if invalid. */
export function normalisePhone(raw: string | null | undefined, defaultCountry = "44"): string | null {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    // +44 07... -> +44 7...
    if (digits.startsWith("440")) return "+44" + digits.slice(3);
    return "+" + digits;
  }
  if (!/^\d+$/.test(s)) return null;
  if (defaultCountry === "44") {
    if (s.startsWith("44") && s.length >= 12) return "+" + s;
    if (s.startsWith("0")) s = s.slice(1);
    // UK numbers are 10 digits after the leading 0
    if (s.length !== 10) return null;
    return "+44" + s;
  }
  return "+" + defaultCountry + s.replace(/^0/, "");
}

/** True for UK mobile numbers (+447...). Landlines can't receive SMS. */
export function isUkMobile(e164: string): boolean {
  return /^\+447\d{9}$/.test(e164);
}

const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt out", "remove me"];
const START_WORDS = ["start", "unstop", "resume"];

function clean(body: string): string {
  return body.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/** Opt-out is decided in code, never by the AI. Matches the whole message only,
 *  so "don't stop texting me" isn't treated as an opt-out, but "STOP", "Stop!" and
 *  "please stop" are. */
export function isOptOut(body: string): boolean {
  const c = clean(body);
  if (!c) return false;
  if (STOP_WORDS.includes(c)) return true;
  const stripped = c.replace(/^(please |pls )/, "").replace(/( please| pls| thanks| thank you)$/, "");
  return STOP_WORDS.includes(stripped);
}

export function isOptIn(body: string): boolean {
  return START_WORDS.includes(clean(body));
}

/** Fill {placeholders}. Unknown/empty values collapse cleanly ("Hi {first_name}," -> "Hi,"). */
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  let out = tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? "").toString().trim());
  out = out.replace(/ +([,.!?])/g, "$1").replace(/ {2,}/g, " ").trim();
  return out;
}

export const OPT_OUT_FOOTER = "Reply STOP to opt out";

/** First message of a sequence must tell people how to opt out. */
export function withOptOutFooter(body: string): string {
  if (/\bstop\b/i.test(body)) return body;
  return `${body}\n\n${OPT_OUT_FOOTER}`;
}

/** Local hour in a timezone, used for the quiet-hours check. */
export function localHour(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date);
  return parseInt(h, 10);
}

export function inSendWindow(date: Date, timeZone: string, start: number, end: number): boolean {
  const h = localHour(date, timeZone);
  return h >= start && h < end;
}

/** Start of "today" in the given timezone, as a UTC Date. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUtc - Math.floor(date.getTime() / 1000) * 1000;
  const localMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(localMidnightAsUtc - offsetMs);
}

export type Followup = { delay_hours: number; message: string };

/** What to send for a campaign contact at a given stage, and when the next one is due. */
export function sequenceStep(
  opening: string,
  followups: Followup[],
  stage: number,
  now: Date,
): { body: string; nextSendAt: Date | null } | null {
  if (stage === 0) {
    const next = followups[0];
    return { body: opening, nextSendAt: next ? new Date(now.getTime() + next.delay_hours * 3600_000) : null };
  }
  const current = followups[stage - 1];
  if (!current) return null;
  const next = followups[stage];
  return { body: current.message, nextSendAt: next ? new Date(now.getTime() + next.delay_hours * 3600_000) : null };
}

/** Rough SMS segment count (GSM-7 = 160/153, anything else UCS-2 = 70/67). */
export function smsSegments(body: string): number {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}
