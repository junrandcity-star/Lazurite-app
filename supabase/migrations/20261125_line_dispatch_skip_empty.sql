-- お知らせが実際に記録されたときだけ送信用の関数を呼ぶ(0件の insert では呼ばない)。試験用 Lazurite Test に適用済み 2026-11-25
create or replace function public.cleaning_messages_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.cleaning_dispatch;
begin
  if not exists (select 1 from new_rows) then return null; end if;
  select * into d from public.cleaning_dispatch where id = 1;
  if d.url is not null then
    perform net.http_post(url := d.url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', d.key),
      timeout_milliseconds := 30000);
  end if;
  return null;
end $$;
drop trigger cleaning_messages_dispatch on public.cleaning_messages;
create trigger cleaning_messages_dispatch after insert on public.cleaning_messages
  referencing new table as new_rows
  for each statement execute function public.cleaning_messages_dispatch();
