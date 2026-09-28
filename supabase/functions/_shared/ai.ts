// The AI reply agent. Uses Claude with a forced tool call so the output is
// always structured: an intent, the reply to send, and a handoff flag.

export type Intent =
  | "interested"      // wants to book / take up the offer
  | "question"        // asking something before deciding
  | "not_now"         // maybe later
  | "not_interested"  // polite no
  | "wrong_person"    // wrong number / not them
  | "already_booked"  // says they've booked or are sorted
  | "other";

export type AiDecision = {
  intent: Intent;
  reply: string;          // empty string = don't reply
  needs_human: boolean;   // flag the conversation for a person to look at
  summary: string;        // one line for the dashboard
};

export type AgentContext = {
  businessName: string;
  businessDescription: string;
  aiInstructions: string;
  agentName: string;
  bookingUrl: string | null;
  contactFirstName: string | null;
  history: { role: "contact" | "business"; text: string }[];
};

const TOOL = {
  name: "respond",
  description: "Decide how to respond to the latest text message from the contact.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["interested", "question", "not_now", "not_interested", "wrong_person", "already_booked", "other"],
      },
      reply: {
        type: "string",
        description: "The SMS to send back. Empty string if no reply should be sent.",
      },
      needs_human: {
        type: "boolean",
        description: "True if a person at the business should look at this conversation.",
      },
      summary: { type: "string", description: "One short line describing where this conversation stands." },
    },
    required: ["intent", "reply", "needs_human", "summary"],
  },
};

export function buildSystemPrompt(ctx: AgentContext): string {
  const signOff = ctx.agentName || `the team at ${ctx.businessName}`;
  return `You reply to text messages on behalf of ${ctx.businessName}. You are ${signOff}.

ABOUT THE BUSINESS
${ctx.businessDescription || "(no description provided)"}

CONTEXT
These are past customers or past enquiries of the business. They were sent a short text to restart the conversation and have now replied. Your job is to be helpful, find out if they're interested, answer simple questions, and get interested people booked in.

BOOKING
${ctx.bookingUrl ? `When someone is interested, give them this booking link: ${ctx.bookingUrl}` : "There is no booking link. When someone is interested, tell them someone from the team will be in touch shortly, and set needs_human to true."}

BUSINESS-SPECIFIC INSTRUCTIONS
${ctx.aiInstructions || "(none)"}

RULES
- This is SMS. Keep replies short: one to three sentences, under 300 characters where possible. Plain text, no markdown, no emojis unless they used one first.
- UK English, friendly and natural, never pushy. One question at a time.
- Only state facts, prices, offers or availability that appear above. If asked something you can't answer from the information above, say you'll check with the team, and set needs_human to true.
- If they say no, not interested, or wrong number: reply once, politely, and don't try to change their mind. For wrong_person, apologise briefly.
- If they say "not now" or "maybe later": acknowledge it warmly; don't push.
- If they are rude, upset or complaining, or mention anything legal, financial hardship, health or safety: keep the reply brief and calm, and set needs_human to true.
- If asked whether you're a bot or AI, be honest: you're an automated assistant for ${ctx.businessName} and a person can take over at any time.
- Never ask for payment details, passwords, or ID over text.
- If their message needs no reply (e.g. "ok thanks" after you've already given the link), return an empty reply.
- Opt-outs are handled separately; you will not see STOP messages.

Always answer by calling the respond tool.`;
}

export async function decideReply(ctx: AgentContext): Promise<AiDecision> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("AI_MODEL") ?? "claude-haiku-4-5-20251001";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  // Collapse history into alternating user/assistant turns.
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of ctx.history) {
    const role = h.role === "contact" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += "\n" + h.text;
    else messages.push({ role, content: h.text });
  }
  // The API needs the first turn to be from the user.
  if (messages[0]?.role === "assistant") {
    messages.unshift({ role: "user", content: "(conversation started by the business)" });
  }
  if (messages[messages.length - 1]?.role !== "user") {
    throw new Error("Last message must be from the contact");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: buildSystemPrompt(ctx),
      tools: [TOOL],
      tool_choice: { type: "tool", name: "respond" },
      messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const block = (json.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("AI did not return a decision");
  const d = block.input as AiDecision;
  return {
    intent: d.intent ?? "other",
    reply: (d.reply ?? "").trim(),
    needs_human: !!d.needs_human,
    summary: (d.summary ?? "").slice(0, 200),
  };
}
