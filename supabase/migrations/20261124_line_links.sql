-- LINE 連携: 清掃員・オーナーの LINE をアプリとつなぐ(6桁のコードを公式アカウントに送ってもらう)
-- 試験用 Lazurite Test に適用済み(2026-11-24)
alter table public.cleaners
  add column line_user_id text unique,
  add column line_code text unique,
  add column line_linked_at timestamptz;

create table public.owner_line (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  line_user_id text unique,
  line_code text unique,
  line_linked_at timestamptz
);
alter table public.owner_line enable row level security;
create policy "own row" on public.owner_line for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
