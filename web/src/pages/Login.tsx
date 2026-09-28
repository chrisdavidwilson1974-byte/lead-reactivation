import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ErrorNote } from "../components/ui";

export default function Login() {
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
      });
      if (error) setError(error.message);
      else if (!data.session) setNotice("Check your email to confirm your account, then sign in.");
    }
    setBusy(false);
  }

  async function reset() {
    if (!email) { setError("Enter your email first."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setError(error.message); else setNotice("Password reset email sent.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" className="h-9 w-9" alt="" />
          <div>
            <p className="text-lg font-semibold leading-tight">Revive</p>
            <p className="text-xs text-slate-500">AI SMS lead reactivation</p>
          </div>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-base font-semibold">{mode === "signin" ? "Sign in" : "Create an account"}</h1>
          {mode === "signup" && (
            <div>
              <label className="label">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <ErrorNote error={error} />
          {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-brand-600 hover:underline"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
              {mode === "signin" ? "Create an account" : "I already have an account"}
            </button>
            {mode === "signin" && (
              <button type="button" className="text-slate-500 hover:underline" onClick={reset}>Forgot password?</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
