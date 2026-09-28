import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, CheckCheck, PoundSterling, Send, User } from "lucide-react";
import { callFunction, supabase } from "../lib/supabase";
import { ALL_STATUSES, ContactStatus, Conversation, Message, STATUS_LABEL } from "../lib/types";
import { useClient } from "./ClientLayout";
import { Empty, ErrorNote, formatPhone, fullName, Modal, Spinner, StatusBadge, timeAgo } from "../components/ui";

export default function Inbox() {
  const { client } = useClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("c");
  const [filter, setFilter] = useState<"attention" | "all">("all");
  const [search, setSearch] = useState("");
  const [convs, setConvs] = useState<Conversation[] | null>(null);

  const loadConvs = useCallback(async () => {
    let q = supabase.from("conversations").select("*, contact:contacts(*)")
      .eq("client_id", client.id).order("last_message_at", { ascending: false }).limit(200);
    if (filter === "attention") q = q.eq("needs_attention", true);
    const { data } = await q;
    setConvs((data ?? []) as Conversation[]);
  }, [client.id, filter]);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  useEffect(() => {
    const ch = supabase.channel(`inbox-${client.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `client_id=eq.${client.id}` },
        () => loadConvs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [client.id, loadConvs]);

  const shown = (convs ?? []).filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.contact && (fullName(c.contact).toLowerCase().includes(s) || c.contact.phone.includes(s.replace(/\s/g, ""))))
      || (c.last_message_preview ?? "").toLowerCase().includes(s);
  });

  return (
    <div className="card grid h-[calc(100vh-220px)] min-h-[520px] grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
      <aside className={`flex min-h-0 flex-col border-r border-slate-200 ${selectedId ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-2 border-b border-slate-200 p-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {(["all", "attention"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex-1 rounded-md py-1 font-medium ${filter === f ? "bg-white shadow-sm" : "text-slate-500"}`}>
                {f === "all" ? "All" : "Needs you"}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Search name, number or text" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!convs ? <Spinner /> : shown.length === 0 ? (
            <Empty title={filter === "attention" ? "All caught up" : "No conversations yet"}>
              {filter === "all" && "Conversations appear here once a campaign starts sending."}
            </Empty>
          ) : shown.map((c) => (
            <button key={c.id} onClick={() => setParams({ c: c.id })}
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedId === c.id ? "bg-brand-50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {c.needs_attention && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                  {c.contact ? fullName(c.contact) : "Unknown"}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{timeAgo(c.last_message_at)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="flex-1 truncate text-sm text-slate-500">{c.last_message_preview}</p>
                {c.contact && <StatusBadge status={c.contact.status} />}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section className={`min-h-0 ${selectedId ? "flex" : "hidden md:flex"} flex-col`}>
        {selectedId ? (
          <Thread key={selectedId} conversationId={selectedId} onBack={() => setParams({})} onChanged={loadConvs} />
        ) : (
          <div className="m-auto"><Empty title="Pick a conversation" /></div>
        )}
      </section>
    </div>
  );
}

function Thread({ conversationId, onBack, onChanged }: { conversationId: string; onBack: () => void; onChanged: () => void }) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [keepAi, setKeepAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from("conversations").select("*, contact:contacts(*)").eq("id", conversationId).single(),
      supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at"),
    ]);
    setConv(c as Conversation);
    setMessages((m ?? []) as Message[]);
  }, [conversationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  useEffect(() => {
    const ch = supabase.channel(`thread-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, load]);

  // Opening a conversation clears the "needs you" flag.
  useEffect(() => {
    if (conv?.needs_attention) {
      supabase.from("conversations").update({ needs_attention: false }).eq("id", conv.id).then(() => onChanged());
    }
  }, [conv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!conv) return <Spinner />;
  const contact = conv.contact!;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true); setError(null);
    try {
      await callFunction("send-message", { conversation_id: conversationId, body: text, keep_ai: keepAi });
      setText("");
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
    setSending(false);
  }

  async function toggleAi() {
    await supabase.from("conversations").update({ ai_enabled: !conv!.ai_enabled }).eq("id", conv!.id);
    load();
  }

  async function setStatus(status: ContactStatus) {
    await supabase.from("contacts").update({ status }).eq("id", contact.id);
    load(); onChanged();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button className="btn-ghost px-2 md:hidden" onClick={onBack}>←</button>
        <div className="min-w-[60%] flex-1">
          <p className="truncate font-semibold">{fullName(contact)}</p>
          <p className="truncate text-xs text-slate-500">
            {formatPhone(contact.phone)}{contact.consent_source ? ` · ${contact.consent_source}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <select className="input w-auto py-1.5" value={contact.status} onChange={(e) => setStatus(e.target.value as ContactStatus)}
          disabled={contact.opted_out}>
          {ALL_STATUSES.filter((s) => s !== "opted_out" || contact.opted_out).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button className="btn-secondary py-1.5" onClick={() => setSelling(true)} disabled={contact.opted_out}>
          <PoundSterling size={15} /> Log sale
        </button>
        <button onClick={toggleAi} disabled={contact.opted_out}
          className={`btn py-1.5 ${conv.ai_enabled ? "bg-violet-100 text-violet-800 hover:bg-violet-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          title={conv.ai_enabled ? "The AI is replying. Click to take over." : "You're handling this. Click to hand back to the AI."}>
          <Bot size={15} /> AI {conv.ai_enabled ? "on" : "off"}
        </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={bottom} />
      </div>

      {contact.opted_out ? (
        <p className="border-t border-slate-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This person opted out. They can't be texted unless they reply START.
        </p>
      ) : (
        <form onSubmit={send} className="space-y-2 border-t border-slate-200 p-3">
          <ErrorNote error={error} />
          <div className="flex gap-2">
            <textarea className="input min-h-[44px] flex-1 resize-none" rows={2} placeholder="Type a reply…"
              value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }} />
            <button className="btn-primary self-end" disabled={sending || !text.trim()}><Send size={16} /></button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={keepAi} onChange={(e) => setKeepAi(e.target.checked)} />
            Let the AI keep replying after my message (otherwise it switches off for this conversation)
          </label>
        </form>
      )}

      {selling && <SaleModal contactId={contact.id} onClose={() => setSelling(false)} onDone={() => { setSelling(false); load(); onChanged(); }} />}
    </>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === "outbound";
  const who = m.sender === "ai" ? <><Bot size={12} /> AI</> : m.sender === "human" ? <><User size={12} /> You</>
    : m.sender === "system" ? "Campaign" : null;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${out
          ? m.sender === "ai" ? "bg-violet-600 text-white" : "bg-brand-500 text-white"
          : "border border-slate-200 bg-white"}`}>
          {m.body}
        </div>
        <div className={`mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 ${out ? "justify-end" : ""}`}>
          {who && <span className="inline-flex items-center gap-0.5">{who}</span>}
          <span>{new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          {m.ai_intent && !out && <span className="rounded bg-slate-200 px-1">{m.ai_intent.replace("_", " ")}</span>}
          {out && m.status === "delivered" && <CheckCheck size={12} className="text-emerald-600" />}
          {out && m.error && <span className="text-red-600" title={m.error}>failed</span>}
        </div>
      </div>
    </div>
  );
}

export function SaleModal({ contactId, onClose, onDone }: { contactId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("record_sale", {
      p_contact_id: contactId, p_amount: Number(amount || 0), p_description: description || null,
    });
    if (error) setError(error.message); else onDone();
  }
  return (
    <Modal title="Log a sale" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label">Sale value (£)</label>
          <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          <p className="hint">Used for results reporting and performance-based billing.</p>
        </div>
        <div>
          <label className="label">What was sold (optional)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 2021 VW Golf, service plan" />
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary">Save sale</button>
        </div>
      </form>
    </Modal>
  );
}
