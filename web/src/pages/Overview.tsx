import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Conversation, Stats } from "../lib/types";
import { useClient } from "./ClientLayout";
import { fullName, gbp, pct, Spinner, StatCard, timeAgo } from "../components/ui";

export default function Overview() {
  const { client } = useClient();
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaignCount, setCampaignCount] = useState(0);
  const [waiting, setWaiting] = useState<Conversation[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { count }, { data: convs }] = await Promise.all([
        supabase.rpc("client_stats", { p_client_id: client.id }),
        supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("client_id", client.id),
        supabase.from("conversations").select("*, contact:contacts(*)").eq("client_id", client.id)
          .eq("needs_attention", true).order("last_message_at", { ascending: false }).limit(8),
      ]);
      setStats(s as Stats);
      setCampaignCount(count ?? 0);
      setWaiting((convs ?? []) as Conversation[]);
    })();
  }, [client.id]);

  if (!stats) return <Spinner />;

  const steps = [
    { done: Boolean(client.business_description && client.agent_name), label: "Describe the business and name the AI", to: "settings" },
    { done: Boolean(client.twilio_number), label: "Add the Twilio SMS number", to: "settings" },
    { done: Boolean(client.booking_url), label: "Add a booking link (optional)", to: "settings" },
    { done: stats.contacts > 0, label: "Import contacts", to: "contacts" },
    { done: campaignCount > 0, label: "Create and launch a campaign", to: "campaigns" },
  ];
  const setupDone = steps.every((s) => s.done);

  const funnel = [
    { label: "Texted", value: stats.enrolled },
    { label: "Replied", value: stats.replied },
    { label: "Interested", value: stats.interested },
    { label: "Booked", value: stats.booked },
    { label: "Sold", value: stats.sold },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <div className="space-y-6">
      {!setupDone && (
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Get set up</h2>
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2 text-sm">
                {s.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-slate-300" />}
                {s.done ? <span className="text-slate-500 line-through">{s.label}</span>
                  : <Link to={s.to} className="text-brand-700 hover:underline">{s.label}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Contacts" value={stats.contacts} sub={`${stats.opted_out} opted out`} />
        <StatCard label="Reply rate" value={pct(stats.replied, stats.enrolled)} sub={`${stats.replied} of ${stats.enrolled} texted`} />
        <StatCard label="Booked" value={stats.booked} sub={`${pct(stats.booked, stats.enrolled)} of texted`} />
        <StatCard label="Revenue" value={gbp(Number(stats.revenue))} sub={`${stats.sold} sales logged`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Funnel</h2>
          <div className="space-y-3">
            {funnel.map((f) => (
              <div key={f.label} className="grid grid-cols-[80px_1fr_48px] items-center gap-3 text-sm">
                <span className="text-slate-600">{f.label}</span>
                <div className="h-6 rounded bg-slate-100">
                  <div className="h-6 rounded bg-brand-500" style={{ width: `${(f.value / max) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums">{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Waiting for you</h2>
            <Link to="inbox" className="text-sm text-brand-700 hover:underline">Open inbox</Link>
          </div>
          {waiting.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing needs you right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {waiting.map((c) => (
                <li key={c.id}>
                  <Link to={`inbox?c=${c.id}`} className="block px-5 py-3 hover:bg-slate-50">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{c.contact ? fullName(c.contact) : "Unknown"}</span>
                      <span className="text-xs text-slate-500">{timeAgo(c.last_message_at)}</span>
                    </div>
                    <p className="truncate text-sm text-slate-500">{c.last_message_preview}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
