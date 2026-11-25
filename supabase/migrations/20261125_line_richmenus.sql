-- 清掃スタッフ用 LINE メニュー(リッチメニュー)
-- - line_richmenus: 言語ごとのリッチメニュー id(line-setup {action:'richmenu'} が作り直すたびに入れ替える)
-- - cleaning_dispatch.setup_url: line-setup の URL(本番では本番の URL を入れる)
-- - 清掃員の LINE 連携や言語が変わったら、その人の言語のメニューにつなぎ直す
create table if not exists public.line_richmenus (
  lang text primary key,
  richmenu_id text not null,
  created_at timestamptz not null default now()
);
alter table public.line_richmenus enable row level security; -- Edge Function(service key)だけが読み書きする

alter table public.cleaning_dispatch add column if not exists setup_url text;
-- 例: update public.cleaning_dispatch set setup_url = 'https://<project>.supabase.co/functions/v1/line-setup' where id = 1;

create or replace function public.cleaners_link_richmenu()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.cleaning_dispatch;
begin
  if new.line_user_id is null then return null; end if;
  select * into d from public.cleaning_dispatch where id = 1;
  if d.setup_url is not null then
    perform net.http_post(url := d.setup_url, body := jsonb_build_object('action', 'link', 'cleaner_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', d.key), timeout_milliseconds := 30000);
  end if;
  return null;
end $$;

drop trigger if exists cleaners_link_richmenu on public.cleaners;
create trigger cleaners_link_richmenu after update of line_user_id, lang on public.cleaners
  for each row when (new.line_user_id is distinct from old.line_user_id or new.lang is distinct from old.lang)
  execute function public.cleaners_link_richmenu();
