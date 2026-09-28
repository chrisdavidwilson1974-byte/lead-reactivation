-- =====================================================================
-- Scheduler: calls the campaign-dispatcher function every 5 minutes.
--
-- Run this AFTER deploying the Edge Functions. Replace the two
-- placeholders first:
--   YOUR_PROJECT_REF   -> the ref in your Supabase URL (xxxx.supabase.co)
--   YOUR_CRON_SECRET   -> the same value you set as the CRON_SECRET
--                         Edge Function secret
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'revive-dispatcher',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To pause everything:   select cron.unschedule('revive-dispatcher');
-- To see recent runs:    select * from cron.job_run_details order by start_time desc limit 20;
