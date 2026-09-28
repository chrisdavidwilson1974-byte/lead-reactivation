import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Client, Stats } from "../lib/types";
import { Empty, ErrorNote, gbp, Modal, pct, Spinner } from "../components/ui";

type Row = Client & { stats?: Stats; attention?: number };

export default function ClientsPage() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("*").order("name");
      const list = (data ?? []) as Row[];
      setRows(list);
      const withStats = await Promise.all(list.map(async (c) => {
        const [{ data: stats }, { count }] = await Promise.all([
          supabase.rpc("client_stats", { p_client_id: c.id }),
          supabase.from("conversations").select("id", { count: "exact", head: true })
            .eq("client_id", c.id).eq("needs_attention", true),
        ]);
        return { ...c, stats: stats as Stats, attention: count ?? 0 };
      }));
      setRows(withStats);
    })();
  }, []);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function create(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from("clients").insert({ name }).select("id").single();
    if (error) { setError(error.message); return; }
    nav(`/clients/${data.id}/settings`);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clients</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New client</button>
      </div>

      {!rows ? <Spinner /> : rows.length === 0 ? (
        <div className="card">
          <Empty title="No clients yet">
            Add the first business you're running reactivation campaigns for. You'll set up its SMS number, AI and
            booking link next.
          </Empty>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Client</th><th className="th">Contacts</th><th className="th">Texts sent</th>
                <th className="th">Reply rate</th><th className="th">Booked</th><th className="th">Revenue</th><th className="th">Needs you</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td font-medium">
                    <Link to={`/clients/${c.id}`} className="text-brand-700 hover:underline">{c.name}</Link>
                    {!c.twilio_number && <span className="ml-2 text-xs text-amber-700">no number</span>}
                    {!c.active && <span className="ml-2 text-xs text-slate-500">paused</span>}
                  </td>
                  <td className="td tabular-nums">{c.stats?.contacts ?? "…"}</td>
                  <td className="td tabular-nums">{c.stats?.sent ?? "…"}</td>
                  <td className="td tabular-nums">{c.stats ? pct(c.stats.replied, c.stats.enrolled) : "…"}</td>
                  <td className="td tabular-nums">{c.stats?.booked ?? "…"}</td>
                  <td className="td tabular-nums">{c.stats ? gbp(Number(c.stats.revenue)) : "…"}</td>
                  <td className="td">
                    {c.attention ? (
                      <Link to={`/clients/${c.id}/inbox`} className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {c.attention} waiting
                      </Link>
                    ) : <span className="text-slate-400">–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <Modal title="New client" onClose={() => setCreating(false)}>
          <form onSubmit={create} className="space-y-4">
            <div>
              <label className="label">Business name</label>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Central Motor Group" required />
            </div>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary">Create and set up</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
