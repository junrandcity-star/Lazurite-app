-- イレギュラー対応(2026-11-26 オーナーと決めた内容)
-- ① 施設ごとの清掃にかかる時間(選べる開始時間は「チェックイン − この時間」まで)
-- ② 清掃料は完了したときの施設の単価で固定する
-- ③ 清掃員の休止(削除すると記録が消えるため)
-- ④ 清掃員からの報告(メモ+写真。写真は30日後に自動で消す)
-- ⑤ 見守り(10分ごと):返事のない当日・翌日の依頼/予定+30分で未開始/開始+3時間で未完了 → オーナーに LINE
-- ⑥ 前日 18:00 に OK 済みの清掃員へ「明日の清掃」
-- ⑦ 依頼を送る日数に 14日・21日を選べるようにする(画面側)

-- ① ---------------------------------------------------------------
alter table public.property_cleaning add column if not exists duration_min integer not null default 120
  check (duration_min between 30 and 600);

-- ② ---------------------------------------------------------------
alter table public.cleaning_assignments add column if not exists rate_at_done integer;
create or replace function public.cleaning_fix_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and new.rate_at_done is null then
    select pc.rate into new.rate_at_done
    from public.reservations r join public.property_cleaning pc on pc.property_id = r.property_id
    where r.id = new.reservation_id;
  elsif new.status <> 'done' then
    new.rate_at_done := null; -- back to not finished: take the rate again when it is finished
  end if;
  return new;
end $$;
drop trigger if exists cleaning_fix_rate on public.cleaning_assignments;
create trigger cleaning_fix_rate before insert or update of status, rate_at_done on public.cleaning_assignments
  for each row execute function public.cleaning_fix_rate();
-- cleanings already finished: the rate of today
update public.cleaning_assignments a set rate_at_done = pc.rate
from public.reservations r join public.property_cleaning pc on pc.property_id = r.property_id
where r.id = a.reservation_id and a.status = 'done' and a.rate_at_done is null;

-- ④ ---------------------------------------------------------------
create table if not exists public.cleaning_reports (
  id uuid primary key default gen_random_uuid(),
  reservation_id bigint not null,
  cleaner_id uuid not null references public.cleaners(id),
  body text not null default '',
  photos text[] not null default '{}',
  photos_removed boolean not null default false, -- the photos were deleted after 30 days
  created_at timestamptz not null default now()
);
create index if not exists cleaning_reports_res on public.cleaning_reports(reservation_id);
alter table public.cleaning_reports enable row level security;
drop policy if exists "members all" on public.cleaning_reports;
create policy "members all" on public.cleaning_reports for all to authenticated using (true) with check (true);

-- ⑤ ---------------------------------------------------------------
create or replace function public.cleaning_watch()
returns integer language plpgsql security definer set search_path = public as $$
declare
  now_jst timestamp := now() at time zone 'Asia/Tokyo';
  today date := now_jst::date;
  n1 int := 0; n2 int := 0; n3 int := 0;
begin
  -- the cleaning is today or tomorrow and the cleaner has not replied (8:00-21:00 only, once per request)
  if extract(hour from now_jst) between 8 and 20 then
    with ins as (
      insert into public.cleaning_messages(audience, cleaner_id, reservation_id, kind, body)
      select 'owner', a.cleaner_id, a.reservation_id, 'norep',
        '【返事なし】' || c.name || ' さん ' || to_char(a.job_date, 'FMMM/FMDD') || ' ' || p.name || ' の依頼に、まだ返事がありません(清掃日が' ||
        case when a.job_date = today then '今日' else '明日' end || 'です)。'
      from public.cleaning_assignments a
      join public.cleaners c on c.id = a.cleaner_id
      join public.reservations r on r.id = a.reservation_id
      join public.properties p on p.id = r.property_id
      where a.status = 'wait' and a.job_date between today and today + 1
        and not exists (select 1 from public.cleaning_messages m where m.kind = 'norep' and m.reservation_id = a.reservation_id
                        and m.cleaner_id = a.cleaner_id and m.created_at > now() - interval '2 days')
      returning 1)
    select count(*) into n1 from ins;
  end if;

  -- 30 minutes after the planned time and "start" has not been pressed
  with ins as (
    insert into public.cleaning_messages(audience, cleaner_id, reservation_id, kind, body)
    select 'owner', a.cleaner_id, a.reservation_id, 'nostart',
      '【未開始】' || c.name || ' さん ' || to_char(a.job_date, 'FMMM/FMDD') || ' ' || p.name || ':予定の ' || a.plan_time || ' を30分過ぎても「清掃を始める」が押されていません。'
    from public.cleaning_assignments a
    join public.cleaners c on c.id = a.cleaner_id
    join public.reservations r on r.id = a.reservation_id
    join public.properties p on p.id = r.property_id
    where a.status = 'ok' and a.job_date = today and a.plan_time ~ '^\d{2}:\d{2}$'
      and now_jst >= today + a.plan_time::time + interval '30 minutes'
      and not exists (select 1 from public.cleaning_messages m where m.kind = 'nostart' and m.reservation_id = a.reservation_id
                      and m.cleaner_id = a.cleaner_id and m.created_at > now() - interval '20 hours')
    returning 1)
  select count(*) into n2 from ins;

  -- 3 hours after "start" and "finished" has not been pressed
  with ins as (
    insert into public.cleaning_messages(audience, cleaner_id, reservation_id, kind, body)
    select 'owner', a.cleaner_id, a.reservation_id, 'nodone',
      '【未完了】' || c.name || ' さん ' || to_char(a.job_date, 'FMMM/FMDD') || ' ' || p.name || ':' || a.start_time || ' の開始から3時間たっても「清掃が終わった」が押されていません。'
    from public.cleaning_assignments a
    join public.cleaners c on c.id = a.cleaner_id
    join public.reservations r on r.id = a.reservation_id
    join public.properties p on p.id = r.property_id
    where a.status = 'work' and a.start_time ~ '^\d{2}:\d{2}$' and a.job_date >= today - 1
      and now_jst >= a.job_date + a.start_time::time + interval '3 hours'
      and not exists (select 1 from public.cleaning_messages m where m.kind = 'nodone' and m.reservation_id = a.reservation_id
                      and m.cleaner_id = a.cleaner_id and m.created_at > now() - interval '20 hours')
    returning 1)
  select count(*) into n3 from ins;
  return n1 + n2 + n3;
end $$;

-- ⑥ ---------------------------------------------------------------
create or replace function public.cleaning_evening()
returns integer language plpgsql security definer set search_path = public as $$
declare tomorrow date := (now() at time zone 'Asia/Tokyo')::date + 1; n integer;
begin
  with ins as (
    insert into public.cleaning_messages(audience, cleaner_id, reservation_id, kind, body)
    select 'cleaner', a.cleaner_id, a.reservation_id, 'tomorrow', to_char(a.job_date, 'FMMM/FMDD') || ' ' || p.name || ' 明日の清掃'
    from public.cleaning_assignments a
    join public.reservations r on r.id = a.reservation_id
    join public.properties p on p.id = r.property_id
    where a.job_date = tomorrow and a.status = 'ok'
      and not exists (select 1 from public.cleaning_messages m where m.kind = 'tomorrow' and m.reservation_id = a.reservation_id
                      and m.cleaner_id = a.cleaner_id and m.created_at > now() - interval '20 hours')
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;

-- ④ cleanup: the Edge Function cleaning-cleanup deletes report photos older than 30 days
alter table public.cleaning_dispatch add column if not exists cleanup_url text;
-- 例: update public.cleaning_dispatch set cleanup_url = 'https://<project>.supabase.co/functions/v1/cleaning-cleanup' where id = 1;
create or replace function public.cleaning_cleanup_call()
returns void language plpgsql security definer set search_path = public as $$
declare d public.cleaning_dispatch;
begin
  select * into d from public.cleaning_dispatch where id = 1;
  if d.cleanup_url is not null then
    perform net.http_post(url := d.cleanup_url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', d.key), timeout_milliseconds := 60000);
  end if;
end $$;

-- schedules (UTC): every 10 minutes / 18:00 JST / 03:30 JST
select cron.unschedule(jobname) from cron.job where jobname in ('cleaning-watch', 'cleaning-evening', 'cleaning-cleanup');
select cron.schedule('cleaning-watch', '*/10 * * * *', 'select public.cleaning_watch()');
select cron.schedule('cleaning-evening', '0 9 * * *', 'select public.cleaning_evening()');
select cron.schedule('cleaning-cleanup', '30 18 * * *', 'select public.cleaning_cleanup_call()');

revoke execute on function public.cleaning_watch(), public.cleaning_evening(), public.cleaning_cleanup_call() from public, anon, authenticated;
