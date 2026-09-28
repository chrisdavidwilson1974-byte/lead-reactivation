import { FormEvent, useCallback, useEffect, useState } from "react";
import { Pause, Play, Plus, Rocket, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Campaign, ContactStatus, Followup, Stats, STATUS_LABEL } from "../lib/types";
import { renderTemplate, smsSegments, withOptOutFooter } from "../../../supabase/functions/_shared/logic.ts";
import { useClient } from "./ClientLayout";
import { Empty, ErrorNote, Modal, pct, Spinner } from "../components/ui";

const STATUS_PILL: Record<Campaign["status"], string> = {
  draft: "bg-slate-100 text-slate-700", active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800", completed: "bg-sky-100 text-sky-800",
};

const DEFAULT_OPENING = "Hi {first_name}, it's {agent_name} from {business_name}. Are you still interested in ...?";
const DEFAULT_FOLLOWUPS: Followup[] = [
  { delay_hours: 48, message: "Hi {first_name}, just checking you got my last message?" },
];

export default function Campaigns() {
  const { client } = useClient();
  const [rows, setRows] = useState<(Campaign & { stats?: Stats })[] | null>(null);
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [launching, setLaunching] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("campaigns").select("*").eq("client_id", client.id).order("created_at", { ascending: false });
    const list = (data ?? []) as Campaign[];
    setRows(list);
    const withStats = await Promise.all(list.map(async (c) => {
      const { data: s } = await supabase.rpc("client_stats", { p_client_id: client.id, p_campaign_id: c.id });
      return { ...c, stats: s as Stats };
    }));
    setRows(withStats);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(c: Campaign, status: Campaign["status"]) {
    await supabase.from("campaigns").update({ status }).eq("id", c.id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Texts send between {client.send_window_start}:00 and {client.send_window_end}:00 UK time, checked every 5 minutes.
        </p>
        <button className="btn-primary" onClick={() => setEditing("new")}><Plus size={16} /> New campaign</button>
      </div>

      {!rows ? <Spinner /> : rows.length === 0 ? (
        <div className="card"><Empty title="No campaigns yet">A campaign is an opening text plus optional follow-ups for anyone who doesn't reply.</Empty></div>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold">{c.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[c.status]}`}>{c.status}</span>
                <div className="ml-auto flex gap-2">
                  {c.status === "draft" && <>
                    <button className="btn-secondary py-1.5" onClick={() => setEditing(c)}>Edit</button>
                    <button className="btn-primary py-1.5" onClick={() => setLaunching(c)} disabled={!client.twilio_number}
                      title={client.twilio_number ? "" : "Add a Twilio number in Settings first"}><Rocket size={15} /> Launch</button>
                  </>}
                  {c.status === "active" && <button className="btn-secondary py-1.5" onClick={() => setStatus(c, "paused")}><Pause size={15} /> Pause</button>}
                  {c.status === "paused" && <>
                    <button className="btn-secondary py-1.5" onClick={() => setEditing(c)}>Edit</button>
                    <button className="btn-primary py-1.5" onClick={() => setStatus(c, "active")}><Play size={15} /> Resume</button>
                  </>}
                  {(c.status === "active" || c.status === "paused" || c.status === "completed") && (
                    <button className="btn-ghost py-1.5" onClick={() => setLaunching(c)} title="Add more contacts">+ Contacts</button>
                  )}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.opening_message}</p>
              <p className="mt-1 text-xs text-slate-500">
                {c.followups.length} follow-up{c.followups.length === 1 ? "" : "s"} · up to {c.daily_send_limit} texts/day
              </p>
              {c.stats && c.stats.enrolled > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-5">
                  <Metric label="Enrolled" value={c.stats.enrolled} />
                  <Metric label="Texts sent" value={c.stats.sent} />
                  <Metric label="Replied" value={`${c.stats.replied} (${pct(c.stats.replied, c.stats.enrolled)})`} />
                  <Metric label="Interested" value={c.stats.interested} />
                  <Metric label="Booked" value={c.stats.booked} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <CampaignEditor clientId={client.id} businessName={client.name} agentName={client.agent_name}
        campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {launching && <LaunchModal campaign={launching} clientId={client.id} onClose={() => setLaunching(null)} onDone={() => { setLaunching(null); load(); }} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="font-medium tabular-nums">{value}</p></div>;
}

function MessagePreview({ text, businessName, agentName, first }: { text: string; businessName: string; agentName: string; first?: boolean }) {
  let body = renderTemplate(text, { first_name: "Sarah", business_name: businessName, agent_name: agentName || "Alex" });
  if (first) body = withOptOutFooter(body);
  const segs = smsSegments(body);
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3">
      <p className="whitespace-pre-wrap text-sm">{body}</p>
      <p className={`mt-1 text-xs ${segs > 2 ? "text-amber-700" : "text-slate-500"}`}>
        {body.length} characters · {segs} SMS part{segs > 1 ? "s" : ""}{segs > 2 ? " (shorter texts cost less and get more replies)" : ""}
      </p>
    </div>
  );
}

function CampaignEditor({ clientId, businessName, agentName, campaign, onClose, onDone }: {
  clientId: string; businessName: string; agentName: string; campaign: Campaign | null; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [opening, setOpening] = useState(campaign?.opening_message ?? DEFAULT_OPENING);
  const [followups, setFollowups] = useState<Followup[]>(campaign?.followups ?? DEFAULT_FOLLOWUPS);
  const [limit, setLimit] = useState(campaign?.daily_send_limit ?? 200);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const row = { name, opening_message: opening, followups: followups.filter((f) => f.message.trim()), daily_send_limit: limit };
    const { error } = campaign
      ? await supabase.from("campaigns").update(row).eq("id", campaign.id)
      : await supabase.from("campaigns").insert({ ...row, client_id: clientId });
    if (error) setError(error.message); else onDone();
  }

  async function remove() {
    if (!campaign || !confirm("Delete this campaign?")) return;
    await supabase.from("campaigns").delete().eq("id", campaign.id);
    onDone();
  }

  const upd = (i: number, patch: Partial<Followup>) => setFollowups(followups.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <Modal title={campaign ? "Edit campaign" : "New campaign"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <div><label className="label">Campaign name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Service reminder – Oct" /></div>
          <div><label className="label">Max texts per day</label><input className="input" type="number" min={1} max={5000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></div>
        </div>
        <div>
          <label className="label">Opening text</label>
          <textarea className="input" rows={3} value={opening} onChange={(e) => setOpening(e.target.value)} required />
          <p className="hint">Use {"{first_name}"}, {"{agent_name}"} and {"{business_name}"}. Short, personal and ending in a question works best. "Reply STOP to opt out" is added automatically.</p>
          <MessagePreview text={opening} businessName={businessName} agentName={agentName} first />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Follow-ups (only sent if they haven't replied)</label>
            <button type="button" className="btn-ghost py-1 text-brand-700" onClick={() => setFollowups([...followups, { delay_hours: 72, message: "" }])}>
              <Plus size={15} /> Add
            </button>
          </div>
          <div className="space-y-3">
            {followups.map((f, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span>Send</span>
                  <input className="input w-20 py-1" type="number" min={1} value={Math.round(f.delay_hours / 24 * 10) / 10}
                    onChange={(e) => upd(i, { delay_hours: Math.max(1, Math.round(Number(e.target.value) * 24)) })} />
                  <span>days after the previous text</span>
                  <button type="button" className="btn-ghost ml-auto p-1 text-slate-400 hover:text-red-600" onClick={() => setFollowups(followups.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                </div>
                <textarea className="input" rows={2} value={f.message} onChange={(e) => upd(i, { message: e.target.value })} />
                {f.message && <MessagePreview text={f.message} businessName={businessName} agentName={agentName} />}
              </div>
            ))}
          </div>
        </div>
        <ErrorNote error={error} />
        <div className="flex items-center justify-between">
          {campaign ? <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary">Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

const LAUNCHABLE: ContactStatus[] = ["new", "contacted", "replied", "not_interested"];

function LaunchModal({ campaign, clientId, onClose, onDone }: { campaign: Campaign; clientId: string; onClose: () => void; onDone: () => void }) {
  const [statuses, setStatuses] = useState<ContactStatus[]>(["new"]);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (statuses.length === 0) { setCount(0); return; }
      const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true })
        .eq("client_id", clientId).eq("opted_out", false).in("status", statuses);
      setCount(count ?? 0);
    })();
  }, [statuses, clientId]);

  async function launch() {
    setBusy(true);
    const { data, error } = await supabase.rpc("launch_campaign", { p_campaign_id: campaign.id, p_statuses: statuses });
    setBusy(false);
    if (error) setError(error.message);
    else { alert(`${data} contacts added. Sending starts within 5 minutes during sending hours.`); onDone(); }
  }

  return (
    <Modal title={campaign.status === "draft" ? `Launch "${campaign.name}"` : `Add contacts to "${campaign.name}"`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="label">Who should get it?</p>
          <div className="space-y-1.5">
            {LAUNCHABLE.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={statuses.includes(s)}
                  onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s))} />
                {STATUS_LABEL[s]}{s === "new" && " (never texted)"}
              </label>
            ))}
          </div>
          <p className="hint">Opted-out contacts are always excluded. People already in this campaign won't be added twice.</p>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {count === null ? "Counting…" : <><strong>{count}</strong> contacts match. At {campaign.daily_send_limit}/day that's about {Math.max(1, Math.ceil(count / campaign.daily_send_limit))} day(s) of sending.</>}
        </p>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !count} onClick={launch}><Rocket size={15} /> {busy ? "Launching…" : "Launch"}</button>
        </div>
      </div>
    </Modal>
  );
}
