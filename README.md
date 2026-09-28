# Revive: AI SMS lead reactivation

A multi-client platform for running **database reactivation** campaigns: text a
business's past customers and old enquiries, let an AI handle the replies, and
book interested people in. Built on Supabase, Twilio, Claude and React.

- **Campaigns:** opening text plus timed follow-ups, sent in batches, only within
  each client's sending hours, with a daily cap.
- **AI replies:** Claude reads each reply, answers from the client's own info,
  sends the booking link to interested people, and flags anything it shouldn't handle.
- **Opt-outs in code:** STOP/UNSUBSCRIBE etc. are caught before the AI and
  suppress the contact permanently (until they text START).
- **Inbox:** live conversations, take over from the AI at any time, log sales.
- **Multi-client:** you (admin) see every client; each client's staff only see their own.
- **Reporting:** reply rate, interested, booked, sold and revenue, per client and campaign.

```
supabase/
  migrations/0001_init.sql   database, security rules, reporting functions
  setup/schedule.sql         5-minute scheduler (run once, by hand)
  functions/
    twilio-inbound/          every incoming text -> opt-out check -> AI -> reply
    campaign-dispatcher/     sends due opening texts and follow-ups
    send-message/            your manual replies from the inbox
    twilio-status/           delivery receipts
    cal-webhook/             marks contacts "booked" when they book on Cal.com
    ai-preview/              "Test the AI" panel in Settings
    _shared/                 Twilio, AI prompt, phone/opt-out/template logic
  tests/                     unit tests
web/                         React dashboard (deploys to Vercel)
.github/workflows/           deploys the backend to Supabase from GitHub
```

---

## Setup (no terminal needed)

Everything runs in the browser: GitHub, Supabase, Vercel, Twilio. Allow about an
hour, plus a few days' wait for Twilio to approve a UK number.

### 1. Start the Twilio number approval (do this first)

1. Create an account at twilio.com and upgrade it (trial accounts can only text numbers you've verified).
2. **Phone Numbers → Regulatory Compliance → Bundles → Create bundle** for a
   *United Kingdom, Mobile, Business* number. You'll need your business details
   and ID. Approval usually takes 1–3 working days.
3. Once approved: **Phone Numbers → Buy a number**, choose United Kingdom,
   tick **SMS**, and buy a **mobile** (07…) number. Buy one number per client.
4. From the Twilio console home page, copy your **Account SID** and **Auth Token**.

### 2. Create the Supabase project

1. supabase.com → **New project**. Pick the London region and write down the
   database password.
2. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
3. **Authentication → URL Configuration**: set **Site URL** to your Vercel URL
   (you'll get it in step 5; come back and update it).

### 3. Deploy the backend from GitHub

1. Create an access token at supabase.com/dashboard/account/tokens.
2. In this GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, and add:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1
   - `SUPABASE_PROJECT_REF`: the `xxxx` in `https://xxxx.supabase.co`
   - `SUPABASE_DB_PASSWORD`: your database password
3. **Actions → Deploy backend to Supabase → Run workflow**. When it goes green,
   the database and all Edge Functions are live.

### 4. Add the backend secrets

Supabase → **Edge Functions → Secrets**, and add:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | from Twilio |
| `TWILIO_AUTH_TOKEN` | from Twilio |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `CRON_SECRET` | any long random string (you'll use it again in step 6) |
| `APP_URL` | your Vercel URL, e.g. `https://revive.vercel.app` (for links in alert emails) |
| `RESEND_API_KEY` | *optional*: from resend.com, to email alerts |
| `NOTIFY_FROM_EMAIL` | *optional*: e.g. `Revive <alerts@yourdomain.co.uk>` (domain verified in Resend) |
| `CAL_WEBHOOK_SECRET` | *optional*: if you use Cal.com booking webhooks |
| `AI_MODEL` | *optional*: defaults to `claude-haiku-4-5-20251001` (fast, cheap). Use `claude-sonnet-5` for smarter replies |
| `TWILIO_DRY_RUN` | *optional*: set to `true` to log texts instead of sending them while you test |

### 5. Deploy the dashboard to Vercel

1. vercel.com → **Add New → Project** → import this GitHub repo.
2. Set **Root Directory** to `web`. The framework is detected as Vite.
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (from step 2), then **Deploy**.
4. Put the Vercel URL into Supabase's **Site URL** (step 2.3) and the `APP_URL` secret (step 4).

### 6. Switch on the scheduler

Supabase → **SQL Editor**. Paste in `supabase/setup/schedule.sql`, replace
`YOUR_PROJECT_REF` and `YOUR_CRON_SECRET`, and run it. Campaigns now send every 5 minutes.

### 7. First login and first client

1. Open the dashboard and **Create an account**. The first account created becomes the admin.
2. **New client**, then fill in Settings: business description, who the AI texts as,
   instructions and current offer, booking link, alert email, and the client's Twilio number.
3. Use **Test the AI** in Settings to chat with it as a customer before anything goes out.
4. Copy the **Twilio webhook URL** shown in Settings. In Twilio: **Phone Numbers →
   Active numbers → (the number) → Messaging → A message comes in** → Webhook,
   paste the URL, choose **HTTP POST**, and save.
5. Text the number from your own phone. You should get an AI reply and see the
   conversation appear in the Inbox.

### Testing before your Twilio number is live

You can test the whole system without a phone number:

- **Test the AI** (client Settings): chat with the AI to tune its replies.
- **Simulate a reply** (Inbox): use *Test: simulate a text from someone*, or the
  *Test: text as them* tab on any conversation. The message runs through the real
  pipeline (opt-out check, AI reply, status changes, alert emails). Nothing is
  sent by SMS, and messages are tagged "test".
- **Dry-run campaigns:** add the Edge Function secret `TWILIO_DRY_RUN` = `true`.
  Campaigns and manual replies are logged instead of sent, even for a client with
  no Twilio number yet. Remove the secret when you go live.

### 8. Run a campaign

1. **Contacts → Import CSV**: map the columns, say where the contacts came from, and confirm consent.
2. **Campaigns → New campaign**: write the opening text and follow-ups, then **Launch**.
3. Replies show up in the **Inbox**. Interested people trigger an alert email.
   Log sales on a conversation to track revenue.

### Giving a client access

Ask them to create an account on the login page. Then, as admin, go to **Users**
and link their account to their business. They'll only ever see that business.

### Optional: Cal.com bookings

In Cal.com → **Settings → Developer → Webhooks**, add the **Cal.com webhook URL**
shown in the client's Settings, with the *Booking Created* event and a secret
matching `CAL_WEBHOOK_SECRET`. Add a phone-number question to the event type so
bookings can be matched to contacts.

---

## Compliance (UK)

- Only import people who are existing customers or who enquired with the business
  (the PECR "soft opt-in"), or who gave explicit consent. The import screen records
  the source on every contact.
- Every opening text ends with "Reply STOP to opt out". Opt-outs are permanent and
  enforced in code. Opted-out contacts can't be texted from the inbox, and are
  never re-enrolled in a campaign.
- Sending is limited to each client's sending hours (default 9am–8pm).
- The AI tells people it's an automated assistant if they ask.

## Costs (roughly)

Twilio UK texts cost a few pence per message part, and a UK number costs around £1 a
month. Check current rates on Twilio's UK pricing page. A Claude reply with Haiku costs
a fraction of a penny. Supabase and Vercel free tiers cover early use.

## Tests

The GitHub Actions **Tests** workflow type-checks the backend, runs the unit tests
(phone parsing, opt-out detection, sending hours incl. BST, follow-up timing,
Twilio signature checks) and builds the dashboard on every push.
