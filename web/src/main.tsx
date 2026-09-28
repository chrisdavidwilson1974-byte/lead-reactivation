import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { configured } from "./lib/supabase";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import AppShell from "./components/AppShell";
import ClientsPage from "./pages/Clients";
import ClientLayout from "./pages/ClientLayout";
import Overview from "./pages/Overview";
import Inbox from "./pages/Inbox";
import Contacts from "./pages/Contacts";
import Campaigns from "./pages/Campaigns";
import Settings from "./pages/Settings";
import Users from "./pages/Users";

function Home() {
  const { profile, isAdmin } = useAuth();
  if (isAdmin) return <Navigate to="/clients" replace />;
  if (profile?.client_id) return <Navigate to={`/clients/${profile.client_id}`} replace />;
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="text-lg font-semibold">Your account is ready</h1>
      <p className="mt-2 text-sm text-slate-600">
        An administrator needs to link your login to your business before you can see anything. Let them know
        you've signed up and they'll do it in a moment.
      </p>
    </div>
  );
}

function Protected() {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  return <AppShell />;
}

function App() {
  if (!configured) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <h1 className="text-lg font-semibold">Almost there</h1>
        <p className="mt-2 text-sm text-slate-600">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your Vercel project's
          environment variables, then redeploy.
        </p>
      </div>
    );
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Home />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/users" element={<Users />} />
            <Route path="/clients/:clientId" element={<ClientLayout />}>
              <Route index element={<Overview />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
