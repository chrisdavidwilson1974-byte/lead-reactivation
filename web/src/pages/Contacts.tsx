import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Plus, Upload, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ALL_STATUSES, Contact, ContactStatus, STATUS_LABEL } from "../lib/types";
import { isUkMobile, normalisePhone } from "../../../supabase/functions/_shared/logic.ts";
import { useClient } from "./ClientLayout";
import { Empty, ErrorNote, formatPhone, fullName, Modal, Spinner, StatusBadge, timeAgo } from "../components/ui";

const PAGE = 50;

export default function Contacts() {
  const { client } = useClient();
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ContactStatus | "">("");
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from("contacts").select("*", { count: "exact" }).eq("client_id", client.id)
      .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (status) q = q.eq("status", status);
    const s = search.trim();
    if (s) {
      const digits = s.replace(/\D/g, "");
      const ors = [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits.replace(/^0/, "")}%`);
      q = q.or(ors.join(","));
    }
    const { data, count } = await q;
    setRows((data ?? []) as Contact[]);
    setTotal(count ?? 0);
  }, [client.id, page, search, status]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search name, email or number" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value as ContactStatus | ""); setPage(0); }}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => setEditing("new")}><Plus size={16} /> Add</button>
          <button className="btn-primary" onClick={() => setImporting(true)}><Upload size={16} /> Import CSV</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <Empty title={search || status ? "No matches" : "No contacts yet"}>
            {!search && !status && "Import the business's past customers or old enquiries from a CSV export. Only include people who agreed to be contacted."}
          </Empty>
        ) : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr><th className="th">Name</th><th className="th">Mobile</th><th className="th">Status</th><th className="th">Source</th><th className="th">Added</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(c)}>
                  <td className="td font-medium">{fullName(c)}{c.email && <span className="block text-xs font-normal text-slate-500">{c.email}</span>}</td>
                  <td className="td tabular-nums">{formatPhone(c.phone)}</td>
                  <td className="td"><StatusBadge status={c.status} /></td>
                  <td className="td text-slate-500">{c.consent_source ?? "–"}</td>
                  <td className="td text-slate-500">{timeAgo(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}

      {importing && <ImportModal clientId={client.id} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
      {editing && <ContactModal clientId={client.id} contact={editing === "new" ? null : editing}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ContactModal({ clientId, contact, onClose, onDone }: {
  clientId: string; contact: Contact | null; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({
    first_name: contact?.first_name ?? "", last_name: contact?.last_name ?? "", phone: contact?.phone ?? "",
    email: contact?.email ?? "", consent_source: contact?.consent_source ?? "", notes: contact?.notes ?? "",
    status: contact?.status ?? "new" as ContactStatus,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const phone = normalisePhone(f.phone);
    if (!phone) { setError("That doesn't look like a valid UK phone number."); return; }
    const row = {
      first_name: f.first_name || null, last_name: f.last_name || null, phone, email: f.email || null,
      consent_source: f.consent_source || null, notes: f.notes || null,
      ...(contact?.opted_out ? {} : { status: f.status }),
    };
    const { error } = contact
      ? await supabase.from("contacts").update(row).eq("id", contact.id)
      : await supabase.from("contacts").insert({ ...row, client_id: clientId });
    if (error) setError(error.code === "23505" ? "A contact with that number already exists." : error.message);
    else onDone();
  }

  async function remove() {
    if (!contact || !confirm(`Delete ${fullName(contact)} and their conversation history?`)) return;
    const { error } = await supabase.from("contacts").delete().eq("id", contact.id);
    if (error) setError(error.message); else onDone();
  }

  return (
    <Modal title={contact ? fullName(contact) : "Add contact"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">First name</label><input className="input" value={f.first_name} onChange={set("first_name")} /></div>
          <div><label className="label">Last name</label><input className="input" value={f.last_name} onChange={set("last_name")} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Mobile</label><input className="input" value={f.phone} onChange={set("phone")} required placeholder="07700 900123" /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={set("email")} /></div>
        </div>
        <div>
          <label className="label">Consent source</label>
          <input className="input" value={f.consent_source} onChange={set("consent_source")} placeholder="e.g. Bought a car 2023" />
          <p className="hint">How this person became a customer or agreed to be contacted.</p>
        </div>
        {contact && (
          <div>
            <label className="label">Status</label>
            {contact.opted_out ? <p className="text-sm text-red-700">Opted out. Only the contact can reverse this, by texting START.</p> : (
              <select className="input" value={f.status} onChange={set("status")}>
                {ALL_STATUSES.filter((s) => s !== "opted_out").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            )}
          </div>
        )}
        <div><label className="label">Notes</label><textarea className="input" rows={3} value={f.notes} onChange={set("notes")} /></div>
        <ErrorNote error={error} />
        <div className="flex items-center justify-between">
          {contact ? <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary">Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

type Field = "first_name" | "last_name" | "full_name" | "phone" | "email";
const FIELD_LABEL: Record<Field, string> = {
  first_name: "First name", last_name: "Last name", full_name: "Full name (will be split)", phone: "Mobile number", email: "Email",
};
const GUESS: Record<Field, RegExp> = {
  first_name: /^(first|fore|given)[ _-]?name$|^first$|^forename$/i,
  last_name: /^(last|sur|family)[ _-]?name$|^surname$|^last$/i,
  full_name: /^(full[ _-]?)?name$|^customer([ _-]?name)?$|^contact([ _-]?name)?$/i,
  phone: /mobile|phone|tel|cell|number/i,
  email: /e-?mail/i,
};

function ImportModal({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, string>[]>([]);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [consent, setConsent] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function onFile(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (r) => {
        const hs = r.meta.fields ?? [];
        setHeaders(hs); setData(r.data);
        const m: Partial<Record<Field, string>> = {};
        (Object.keys(GUESS) as Field[]).forEach((f) => {
          const h = hs.find((h) => GUESS[f].test(h.trim()) && !Object.values(m).includes(h));
          if (h) m[f] = h;
        });
        if (m.first_name || m.last_name) delete m.full_name;
        setMap(m);
      },
      error: (e) => setError(e.message),
    });
  }

  const prepared = useMemo(() => {
    const seen = new Set<string>();
    let invalid = 0, dupes = 0, landline = 0;
    const rows: Record<string, string | null>[] = [];
    for (const r of data) {
      const phone = normalisePhone(map.phone ? r[map.phone] : "");
      if (!phone) { invalid++; continue; }
      if (!isUkMobile(phone) && phone.startsWith("+44")) { landline++; continue; }
      if (seen.has(phone)) { dupes++; continue; }
      seen.add(phone);
      let first = map.first_name ? r[map.first_name]?.trim() : "";
      let last = map.last_name ? r[map.last_name]?.trim() : "";
      if (map.full_name && !first && !last) {
        const parts = (r[map.full_name] ?? "").trim().split(/\s+/);
        first = parts.shift() ?? ""; last = parts.join(" ");
      }
      const tidy = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
      rows.push({
        client_id: clientId, phone, first_name: tidy(first ?? ""), last_name: last ? last : null,
        email: map.email ? (r[map.email]?.trim().toLowerCase() || null) : null, consent_source: consent || null,
      });
    }
    return { rows, invalid, dupes, landline };
  }, [data, map, consent, clientId]);

  async function run() {
    setBusy(true); setError(null);
    let added = 0;
    for (let i = 0; i < prepared.rows.length; i += 500) {
      const chunk = prepared.rows.slice(i, i + 500);
      // ignoreDuplicates: never overwrite existing contacts (keeps opt-outs and history intact)
      const { data, error } = await supabase.from("contacts")
        .upsert(chunk, { onConflict: "client_id,phone", ignoreDuplicates: true }).select("id");
      if (error) { setError(error.message); setBusy(false); return; }
      added += data?.length ?? 0;
    }
    setBusy(false);
    setResult(`${added} new contacts added. ${prepared.rows.length - added} were already on the list and were left unchanged.`);
  }

  return (
    <Modal title="Import contacts" onClose={result ? onDone : onClose} wide>
      {result ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result}</p>
          <div className="flex justify-end"><button className="btn-primary" onClick={onDone}>Done</button></div>
        </div>
      ) : headers.length === 0 ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-6 py-12 text-center hover:border-brand-500">
            <Upload className="mb-2 text-slate-400" />
            <span className="font-medium">Choose a CSV file</span>
            <span className="text-sm text-slate-500">Export from the business's CRM or DMS. Needs at least a mobile number column.</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <ErrorNote error={error} />
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">Match your columns ({data.length} rows found)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                <div key={f}>
                  <label className="label">{FIELD_LABEL[f]}{f === "phone" && " *"}</label>
                  <select className="input" value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value || undefined })}>
                    <option value="">— not in file —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Where did these contacts come from? *</label>
            <input className="input" value={consent} onChange={(e) => setConsent(e.target.value)}
              placeholder="e.g. Customers who bought 2021–2024, website enquiries 2025" />
            <p className="hint">Saved on each contact as a record of why you're allowed to text them.</p>
          </div>
          {map.phone && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p><strong>{prepared.rows.length}</strong> contacts ready to import</p>
              {prepared.invalid > 0 && <p className="text-slate-600">{prepared.invalid} skipped: missing or invalid number</p>}
              {prepared.landline > 0 && <p className="text-slate-600">{prepared.landline} skipped: landline (can't receive texts)</p>}
              {prepared.dupes > 0 && <p className="text-slate-600">{prepared.dupes} skipped: duplicate in file</p>}
              {prepared.rows.slice(0, 3).map((r) => (
                <p key={r.phone} className="mt-1 text-xs text-slate-500">e.g. {[r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)"} · {formatPhone(r.phone!)}</p>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I confirm these are existing customers or people who enquired with this business and can lawfully be sent marketing texts (UK PECR / GDPR).</span>
          </label>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !map.phone || !consent || !confirmed || prepared.rows.length === 0} onClick={run}>
              {busy ? "Importing…" : `Import ${prepared.rows.length} contacts`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
