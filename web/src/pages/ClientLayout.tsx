import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Client } from "../lib/types";
import { Spinner } from "../components/ui";

type Ctx = { client: Client; reload: () => Promise<void> };
export const useClient = () => useOutletContext<Ctx>();

export default function ClientLayout() {
  const { clientId } = useParams();
  const { isAdmin } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [attention, setAttention] = useState(0);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await supabase.from("clients").select("*").eq("id", clientId!).maybeSingle();
    setClient(data as Client | null);
    setMissing(!data);
  }, [clientId]);

  const loadAttention = useCallback(async () => {
    const { count } = await supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("client_id", clientId!).eq("needs_attention", true);
    setAttention(count ?? 0);
  }, [clientId]);

  useEffect(() => { reload(); loadAttention(); }, [reload, loadAttention]);

  useEffect(() => {
    const ch = supabase.channel(`attention-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `client_id=eq.${clientId}` },
        () => loadAttention())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId, loadAttention]);

  if (missing) return <p className="text-sm text-slate-600">Client not found, or you don't have access.</p>;
  if (!client) return <Spinner />;

  const tab = ({ isActive }: { isActive: boolean }) =>
    `relative whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${isActive ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`;

  return (
    <div>
      <div className="mb-5">
        {isAdmin && (
          <Link to="/clients" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ChevronLeft size={16} /> All clients
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{client.name}</h1>
          {!client.active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">Paused</span>}
          {!client.twilio_number && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">No SMS number yet</span>
          )}
        </div>
      </div>
      <nav className="mb-6 flex gap-6 overflow-x-auto border-b border-slate-200">
        <NavLink end to="" className={tab}>Overview</NavLink>
        <NavLink to="inbox" className={tab}>
          Inbox
          {attention > 0 && (
            <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{attention}</span>
          )}
        </NavLink>
        <NavLink to="contacts" className={tab}>Contacts</NavLink>
        <NavLink to="campaigns" className={tab}>Campaigns</NavLink>
        <NavLink to="settings" className={tab}>Settings</NavLink>
      </nav>
      <Outlet context={{ client, reload } satisfies Ctx} />
    </div>
  );
}
