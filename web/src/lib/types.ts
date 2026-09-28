export type ContactStatus =
  | "new" | "contacted" | "replied" | "interested" | "booked"
  | "not_interested" | "wrong_person" | "opted_out" | "sold";

export type Client = {
  id: string;
  name: string;
  business_description: string;
  ai_instructions: string;
  agent_name: string;
  booking_url: string | null;
  twilio_number: string | null;
  notify_email: string | null;
  timezone: string;
  send_window_start: number;
  send_window_end: number;
  active: boolean;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  role: "admin" | "client";
  client_id: string | null;
};

export type Contact = {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  email: string | null;
  consent_source: string | null;
  notes: string | null;
  status: ContactStatus;
  opted_out: boolean;
  created_at: string;
};

export type Followup = { delay_hours: number; message: string };

export type Campaign = {
  id: string;
  client_id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  opening_message: string;
  followups: Followup[];
  daily_send_limit: number;
  created_at: string;
  started_at: string | null;
};

export type Conversation = {
  id: string;
  client_id: string;
  contact_id: string;
  campaign_id: string | null;
  ai_enabled: boolean;
  needs_attention: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  contact?: Contact;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human" | "system";
  body: string;
  status: string | null;
  error: string | null;
  ai_intent: string | null;
  created_at: string;
};

export type Stats = {
  contacts: number; enrolled: number; sent: number; replied: number;
  interested: number; booked: number; sold: number; opted_out: number; revenue: number;
};

export const STATUS_LABEL: Record<ContactStatus, string> = {
  new: "New", contacted: "Contacted", replied: "Replied", interested: "Interested",
  booked: "Booked", not_interested: "Not interested", wrong_person: "Wrong person",
  opted_out: "Opted out", sold: "Sold",
};

export const STATUS_STYLE: Record<ContactStatus, string> = {
  new: "bg-slate-100 text-slate-700",
  contacted: "bg-sky-50 text-sky-700",
  replied: "bg-indigo-50 text-indigo-700",
  interested: "bg-amber-50 text-amber-800",
  booked: "bg-emerald-50 text-emerald-700",
  sold: "bg-emerald-600 text-white",
  not_interested: "bg-slate-100 text-slate-500",
  wrong_person: "bg-slate-100 text-slate-500",
  opted_out: "bg-red-50 text-red-700",
};

export const ALL_STATUSES = Object.keys(STATUS_LABEL) as ContactStatus[];
