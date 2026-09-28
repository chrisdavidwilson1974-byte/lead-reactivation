-- =====================================================================
-- Revive: AI SMS database reactivation platform
-- Initial schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type user_role as enum ('admin', 'client');
create type contact_status as enum (
  'new', 'contacted', 'replied', 'interested', 'booked',
  'not_interested', 'wrong_person', 'opted_out', 'sold'
);
create type campaign_status as enum ('draft', 'active', 'paused', 'completed');
create type message_direction as enum ('inbound', 'outbound');
create type message_sender as enum ('contact', 'ai', 'human', 'system');

-- ---------------------------------------------------------------------
-- Clients (the businesses you run campaigns for, e.g. a dealership)
-- ---------------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- What the business is and does. Fed to the AI.
  business_description text not null default '',
  -- Extra rules for the AI: tone, offer details, things to never say.
  ai_instructions text not null default '',
  -- Name the AI signs off as, e.g. "Sarah from Central Motors"
  agent_name text not null default '',
  booking_url text,
  -- UK mobile number in E.164 (+447...) bought in Twilio for this client
  twilio_number text unique,
  notify_email text,
  timezone text not null default 'Europe/London',
  send_window_start smallint not null default 9 check (send_window_start between 0 and 23),
  send_window_end smallint not null default 20 check (send_window_end between 1 and 24),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Profiles: one per auth user. Admins see everything; client users see
-- only their own client.
-- ---------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role user_role not null default 'client',
  client_id uuid references clients(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  first_name text,
  last_name text,
  phone text not null,               -- E.164, e.g. +447700900123
  email text,
  -- Where consent to message came from, e.g. "past customer 2023", "web enquiry"
  consent_source text,
  notes text,
  status contact_status not null default 'new',
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, phone)
);
create index contacts_client_status_idx on contacts (client_id, status);

-- ---------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  status campaign_status not null default 'draft',
  -- Supports {first_name}, {business_name}, {agent_name}
  opening_message text not null,
  -- [{ "delay_hours": 48, "message": "..." }, ...]
  followups jsonb not null default '[]'::jsonb,
  daily_send_limit integer not null default 200 check (daily_send_limit > 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  -- 0 = opening message not sent yet; n = n messages sent
  stage integer not null default 0,
  next_send_at timestamptz,
  completed boolean not null default false,
  completed_reason text,             -- 'replied' | 'sequence_done' | 'opted_out' | 'failed'
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index campaign_contacts_due_idx
  on campaign_contacts (next_send_at) where completed = false;

-- ---------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  ai_enabled boolean not null default true,
  needs_attention boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  unique (client_id, contact_id)
);
create index conversations_client_recent_idx on conversations (client_id, last_message_at desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  direction message_direction not null,
  sender message_sender not null,
  body text not null,
  twilio_sid text unique,
  status text,                       -- queued/sent/delivered/failed/received
  error text,
  ai_intent text,                    -- classification of an inbound message
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_campaign_day_idx on messages (campaign_id, created_at) where direction = 'outbound';

-- ---------------------------------------------------------------------
-- Sales: logged by the client, used for performance billing
-- ---------------------------------------------------------------------
create table sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  amount numeric(12,2) not null default 0,
  description text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Auth helpers
-- =====================================================================
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function can_access_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and (role = 'admin' or client_id = cid)
  );
$$;

-- New sign-ups get a profile. The very first user becomes admin.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when (select count(*) from profiles) = 0 then 'admin'::user_role else 'client'::user_role end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table clients           enable row level security;
alter table profiles          enable row level security;
alter table contacts          enable row level security;
alter table campaigns         enable row level security;
alter table campaign_contacts enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table sales             enable row level security;

-- clients: admins manage; client users can read and edit their own
create policy clients_select on clients for select using (can_access_client(id));
create policy clients_insert on clients for insert with check (is_admin());
create policy clients_update on clients for update using (can_access_client(id));
create policy clients_delete on clients for delete using (is_admin());

-- profiles: see yourself; admins see and manage everyone
create policy profiles_select on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update on profiles for update using (is_admin());

-- everything else is scoped by client_id
create policy contacts_all on contacts for all
  using (can_access_client(client_id)) with check (can_access_client(client_id));
create policy campaigns_all on campaigns for all
  using (can_access_client(client_id)) with check (can_access_client(client_id));
create policy campaign_contacts_all on campaign_contacts for all
  using (can_access_client(client_id)) with check (can_access_client(client_id));
create policy conversations_all on conversations for all
  using (can_access_client(client_id)) with check (can_access_client(client_id));
create policy messages_select on messages for select using (can_access_client(client_id));
create policy sales_all on sales for all
  using (can_access_client(client_id)) with check (can_access_client(client_id));
-- Note: messages are only ever inserted by Edge Functions (service role),
-- so the only way to send a text from the dashboard is the send-message function.

-- Client users must not change their own Twilio number or active flag.
create or replace function guard_client_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and auth.uid() is not null then
    new.twilio_number := old.twilio_number;
    new.active := old.active;
  end if;
  return new;
end $$;
create trigger clients_guard before update on clients
  for each row execute function guard_client_update();

-- =====================================================================
-- RPCs used by the dashboard
-- =====================================================================

-- Enrol contacts in a campaign and switch it on.
-- statuses: which contact statuses to include (default: never-contacted only)
create or replace function launch_campaign(p_campaign_id uuid, p_statuses contact_status[] default array['new']::contact_status[])
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  v_client uuid;
  v_count integer;
begin
  select client_id into v_client from campaigns where id = p_campaign_id;
  if v_client is null then raise exception 'Campaign not found'; end if;

  insert into campaign_contacts (campaign_id, contact_id, client_id, stage, next_send_at)
  select p_campaign_id, c.id, c.client_id, 0, now()
  from contacts c
  where c.client_id = v_client
    and c.opted_out = false
    and c.status = any(p_statuses)
  on conflict (campaign_id, contact_id) do nothing;
  get diagnostics v_count = row_count;

  update campaigns
     set status = 'active', started_at = coalesce(started_at, now())
   where id = p_campaign_id;

  return v_count;
end $$;

-- Headline numbers for a client (optionally one campaign)
create or replace function client_stats(p_client_id uuid, p_campaign_id uuid default null)
returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'contacts',       (select count(*) from contacts where client_id = p_client_id),
    'enrolled',       (select count(*) from campaign_contacts where client_id = p_client_id
                         and (p_campaign_id is null or campaign_id = p_campaign_id)),
    'sent',           (select count(*) from messages where client_id = p_client_id and direction = 'outbound'
                         and (p_campaign_id is null or campaign_id = p_campaign_id)),
    'replied',        (select count(distinct m.conversation_id) from messages m where m.client_id = p_client_id
                         and m.direction = 'inbound' and (p_campaign_id is null or m.campaign_id = p_campaign_id)),
    'interested',     (select count(*) from contacts c where c.client_id = p_client_id and c.status in ('interested','booked','sold')
                         and (p_campaign_id is null or exists (select 1 from campaign_contacts cc where cc.contact_id = c.id and cc.campaign_id = p_campaign_id))),
    'booked',         (select count(*) from contacts c where c.client_id = p_client_id and c.status in ('booked','sold')
                         and (p_campaign_id is null or exists (select 1 from campaign_contacts cc where cc.contact_id = c.id and cc.campaign_id = p_campaign_id))),
    'sold',           (select count(*) from contacts c where c.client_id = p_client_id and c.status = 'sold'
                         and (p_campaign_id is null or exists (select 1 from campaign_contacts cc where cc.contact_id = c.id and cc.campaign_id = p_campaign_id))),
    'opted_out',      (select count(*) from contacts where client_id = p_client_id and opted_out),
    'revenue',        (select coalesce(sum(amount),0) from sales where client_id = p_client_id
                         and (p_campaign_id is null or campaign_id = p_campaign_id))
  );
$$;

-- Log a sale against a contact (marks them sold)
create or replace function record_sale(p_contact_id uuid, p_amount numeric, p_description text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_client uuid; v_campaign uuid; v_id uuid;
begin
  select client_id into v_client from contacts where id = p_contact_id;
  if v_client is null then raise exception 'Contact not found'; end if;
  select campaign_id into v_campaign from conversations where contact_id = p_contact_id;
  insert into sales (client_id, contact_id, campaign_id, amount, description)
  values (v_client, p_contact_id, v_campaign, p_amount, p_description) returning id into v_id;
  update contacts set status = 'sold' where id = p_contact_id;
  return v_id;
end $$;

-- =====================================================================
-- Realtime: the inbox listens for new messages and conversation changes
-- =====================================================================
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
