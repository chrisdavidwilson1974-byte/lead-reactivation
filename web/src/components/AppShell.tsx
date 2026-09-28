import { Link, NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";

export default function AppShell() {
  const { session, isAdmin, signOut } = useAuth();
  const nav = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900"}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" className="h-7 w-7" alt="" /> Revive
          </Link>
          {isAdmin && (
            <nav className="flex gap-1">
              <NavLink to="/clients" className={nav}>Clients</NavLink>
              <NavLink to="/users" className={nav}>Users</NavLink>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">{session?.user.email}</span>
            <button className="btn-ghost px-2" onClick={signOut} title="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
