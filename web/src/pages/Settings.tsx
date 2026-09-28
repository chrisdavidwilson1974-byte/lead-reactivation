import { FormEvent, useState } from "react";
import { Bot, Copy, RotateCcw, Send } from "lucide-react";
import { callFunction, functionsBase, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { normalisePhone } from "../../../supabase/functions/_shared/logic.ts";
import { useClient } from "./ClientLayout";
import { ErrorNote } from "../components/ui";

export default function Settings() {
  const { client, reload } = useClient();
  const { isAdmin } = useAuth();
  const [f, setF] = useState({
    name: client.name,
    business_description: client.business_description,
    ai_instructions: client.ai_instructions,
    agent_name: client.agent_name,
    booking_url: client.booking_url ?? "",
    notify_email: client.notify_email ?? "",
    twilio_number: client.twilio_number ?? "",
    send_window_start: client.send_window_start,
    send_window_end: client.send_window_end,
    active: client.active,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let twilio: string | null = null;
    if (f.twilio_number.trim()) {
      twilio = normalisePhone(f.twilio_number);
      if (!twilio) { setError("The Twilio number doesn't look valid."); return; }
    }
    if (f.send_window_end <= f.send_window_start) { setError("Sending hours: the end must be after the start."); return; }
    const { error } = await supabase.from("clients").update({
      name: f.name, business_description: f.business_description, ai_instructions: f.ai_instructions,
      agent_name: f.agent_name, booking_url: f.booking_url || null, notify_email: f.notify_email || null,
      send_window_start: Number(f.send_window_start), send_window_end: Number(f.send_window_end),
      ...(isAdmin ? { twilio_number: twilio, active: f.active } : {}),
    }).eq("id", client.id);
    if (error) setError(error.code === "23505" ? "That Twilio number is already used by another client." : error.message);
    else { setSaved(true); reload(); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <form onSubmit={save} className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Business</h2>
          <div><label className="label">Business name</label><input className="input" value={f.name} onChange={set("name")} required /></div>
          <div>
            <label className="label">About the business</label>
            <textarea className="input" rows={5} value={f.business_description} onChange={set("business_description")}
              placeholder="e.g. Independent used car dealer in Rochdale, 80+ cars in stock, part-exchange welcome, finance available, open Mon–Sat 9–6, Sun 10–4. Address: ..." />
            <p className="hint">The AI only states facts written here or in the instructions below. Include opening hours, location and anything customers commonly ask.</p>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">AI assistant</h2>
          <div>
            <label className="label">Who the AI texts as</label>
            <input className="input" value={f.agent_name} onChange={set("agent_name")} placeholder="e.g. Sarah from Central Motors" />
          </div>
          <div>
            <label className="label">Instructions and current offer</label>
            <textarea className="input" rows={6} value={f.ai_instructions} onChange={set("ai_instructions")}
              placeholder={"e.g.\n- Current offer: free valuation and £500 part-exchange bonus until 31 October.\n- Don't quote prices for specific cars; say the team will confirm.\n- If they ask about finance, say we work with several lenders and can do a soft-search quote."} />
          </div>
          <div>
            <label className="label">Booking link</label>
            <input className="input" type="url" value={f.booking_url} onChange={set("booking_url")} placeholder="https://cal.com/central-motors/visit" />
            <p className="hint">Sent to interested people. Leave blank and the AI will say the team will be in touch instead.</p>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Sending and alerts</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Send texts from</label>
              <select className="input" value={f.send_window_start} onChange={set("send_window_start")}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label className="label">Until</label>
              <select className="input" value={f.send_window_end} onChange={set("send_window_end")}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h % 24).padStart(2, "0")}:00</option>)}
              </select>
            </div>
          </div>
          <p className="hint -mt-2">UK time. Only applies to campaign texts; the AI always answers replies straight away.</p>
          <div>
            <label className="label">Alert email</label>
            <input className="input" type="email" value={f.notify_email} onChange={set("notify_email")} placeholder="sales@business.co.uk" />
            <p className="hint">Emailed when someone is interested or the AI hands a conversation over.</p>
          </div>
        </section>

        {isAdmin && (
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Admin</h2>
            <div>
              <label className="label">Twilio SMS number</label>
              <input className="input" value={f.twilio_number} onChange={set("twilio_number")} placeholder="+447..." />
              <p className="hint">The UK mobile number bought in Twilio for this client. Every number needs the webhook below set in Twilio.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.active} onChange={(e) => { setF({ ...f, active: e.target.checked }); setSaved(false); }} />
              Client active (untick to stop all campaign sending for this client)
            </label>
          </section>
        )}

        <ErrorNote error={error} />
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save settings</button>
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      </form>

      <aside className="space-y-6">
        <AiTester clientId={client.id} />
        {isAdmin && <Webhooks clientId={client.id} />}
      </aside>
    </div>
  );
}

type Turn = { role: "contact" | "business"; text: string; meta?: string };

function AiTester({ clientId }: { clientId: string }) {
  const [turns, setTurns] = useState<Turn[]>([
    { role: "business", text: "Hi Sarah, it's Alex from the dealership. Are you still thinking about changing your car this year?" },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const next = [...turns, { role: "contact" as const, text }];
    setTurns(next); setText(""); setBusy(true); setError(null);
    try {
      const { decision } = await callFunction<{ decision: { intent: string; reply: string; needs_human: boolean; summary: string } }>(
        "ai-preview", { client_id: clientId, history: next.map(({ role, text }) => ({ role, text })) },
      );
      const meta = `${decision.intent.replace("_", " ")}${decision.needs_human ? " · would alert you" : ""}`;
      setTurns([...next, { role: "business", text: decision.reply || "(no reply sent)", meta }]);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><Bot size={17} /> Test the AI</h2>
        <button className="btn-ghost p-1.5" title="Reset" onClick={() => setTurns(turns.slice(0, 1))}><RotateCcw size={15} /></button>
      </div>
      <p className="px-4 pt-3 text-xs text-slate-500">Reply as a customer. Save your settings first. Nothing is texted.</p>
      <div className="max-h-96 space-y-2 overflow-y-auto p-4">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "business" ? "justify-end" : ""}`}>
            <div className="max-w-[85%]">
              <p className={`whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${t.role === "business" ? "bg-violet-600 text-white" : "border border-slate-200 bg-white"}`}>{t.text}</p>
              {t.meta && <p className="mt-0.5 text-right text-[11px] text-slate-500">{t.meta}</p>}
            </div>
          </div>
        ))}
        {busy && <p className="text-right text-xs text-slate-400">AI is typing…</p>}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Maybe, what have you got?" />
        <button className="btn-primary" disabled={busy}><Send size={15} /></button>
      </form>
      <div className="px-3 pb-3"><ErrorNote error={error} /></div>
    </div>
  );
}

function Webhooks({ clientId }: { clientId: string }) {
  const items = [
    { label: "Twilio: A message comes in (HTTP POST)", url: `${functionsBase}/twilio-inbound` },
    { label: "Cal.com webhook (Booking Created)", url: `${functionsBase}/cal-webhook?client=${clientId}` },
  ];
  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-semibold">Webhook URLs</h2>
      {items.map((i) => (
        <div key={i.label}>
          <p className="mb-1 text-xs font-medium text-slate-600">{i.label}</p>
          <div className="flex gap-1">
            <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs">{i.url}</code>
            <button className="btn-ghost p-1.5" onClick={() => navigator.clipboard.writeText(i.url)} title="Copy"><Copy size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
