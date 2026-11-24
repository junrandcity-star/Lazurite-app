-- LINE の実送信(試験用 Lazurite Test に適用済み 2026-11-25)
-- 本番に入れるときは cleaning_dispatch.url を本番のプロジェクトの line-send に変えること
alter table public.cleaning_messages add column send_status text, add column send_error text;
update public.cleaning_messages set delivered_at = now(), send_status = 'skipped_before_line' where delivered_at is null;

create table public.cleaning_dispatch (
  id integer primary key default 1 check (id = 1),
  key text not null default encode(gen_random_bytes(24), 'hex'),
  url text not null
);
alter table public.cleaning_dispatch enable row level security;
revoke all on public.cleaning_dispatch from anon, authenticated;
insert into public.cleaning_dispatch(url) values ('https://rthvrsyawbmetkrvcazi.supabase.co/functions/v1/line-send');

create or replace function public.cleaning_claim_messages(lim integer default 20)
returns setof public.cleaning_messages
language plpgsql security definer set search_path = public as $$
begin
  update public.cleaning_messages set delivered_at = now(), send_status = 'expired'
  where delivered_at is null and created_at < now() - interval '1 day';
  return query
  update public.cleaning_messages m set delivered_at = now(), send_status = 'sending'
  where m.id in (select id from public.cleaning_messages where delivered_at is null order by id limit lim for update skip locked)
  returning m.*;
end $$;
revoke all on function public.cleaning_claim_messages(integer) from public, anon, authenticated;
grant execute on function public.cleaning_claim_messages(integer) to service_role;

create or replace function public.cleaning_messages_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.cleaning_dispatch;
begin
  select * into d from public.cleaning_dispatch where id = 1;
  if d.url is not null then
    perform net.http_post(url := d.url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', d.key),
      timeout_milliseconds := 30000);
  end if;
  return null;
end $$;
revoke all on function public.cleaning_messages_dispatch() from public, anon, authenticated;
create trigger cleaning_messages_dispatch after insert on public.cleaning_messages
  for each statement execute function public.cleaning_messages_dispatch();

create or replace function public.cleaning_morning() returns integer
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Tokyo')::date; n integer;
begin
  with ins as (
    insert into public.cleaning_messages(audience, cleaner_id, reservation_id, kind, body)
    select 'cleaner', a.cleaner_id, a.reservation_id, 'today', to_char(a.job_date, 'FMMM/FMDD') || ' ' || p.name || ' 本日の清掃'
    from public.cleaning_assignments a
    join public.reservations r on r.id = a.reservation_id
    join public.properties p on p.id = r.property_id
    where a.job_date = today and a.status = 'ok'
      and not exists (select 1 from public.cleaning_messages m where m.kind = 'today' and m.reservation_id = a.reservation_id
                      and m.cleaner_id = a.cleaner_id and m.created_at > now() - interval '20 hours')
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.cleaning_morning() from public, anon, authenticated;
select cron.schedule('cleaning-morning', '55 22 * * *', $$select public.cleaning_morning()$$);
