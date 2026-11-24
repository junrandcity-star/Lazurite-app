-- オーナーが清掃1回ごとの清掃料を変更できるようにする(緊急対応の割増など)
-- 試験用 Lazurite Test に適用済み(2026-11-24)
alter table public.cleaning_assignments
  add column fee_override integer check (fee_override is null or fee_override >= 0),
  add column fee_note text;
