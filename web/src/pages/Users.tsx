import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Client, Profile } from "../lib/types";
import { Spinner } from "../components/ui";

export default function Users() {
  const { isAdmin, session } = useAuth();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);

  async function load() {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("clients").select("*").order("name"),
    ]);
    setUsers((p ?? []) as Profile[]);
    setClients((c ?? []) as Client[]);
  }
  useEffect(() => { load(); }, []);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function update(id: string, patch: Partial<Profile>) {
    await supabase.from("profiles").update(patch).eq("id", id);
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          To give a client access, ask them to create an account on the login page, then link them to their business here.
          Client users only see their own business.
        </p>
      </div>
      <div className="card overflow-x-auto">
        {!users ? <Spinner /> : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">User</th><th className="th">Role</th><th className="th">Business</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="td font-medium">{u.full_name ?? u.id}{u.id === session?.user.id && <span className="ml-2 text-xs text-slate-500">(you)</span>}</td>
                  <td className="td">
                    <select className="input w-auto py-1.5" value={u.role} disabled={u.id === session?.user.id}
                      onChange={(e) => update(u.id, { role: e.target.value as Profile["role"] })}>
                      <option value="client">Client</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="td">
                    {u.role === "admin" ? <span className="text-sm text-slate-500">All businesses</span> : (
                      <select className="input w-auto py-1.5" value={u.client_id ?? ""} onChange={(e) => update(u.id, { client_id: e.target.value || null })}>
                        <option value="">— not linked —</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
