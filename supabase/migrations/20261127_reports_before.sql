-- 清掃前(Before)の写真報告:before = 清掃を始める前の部屋の様子(写真10枚まで)、after = 清掃後の報告(30枚まで)
alter table public.cleaning_reports add column if not exists kind text not null default 'after' check (kind in ('before', 'after'));
