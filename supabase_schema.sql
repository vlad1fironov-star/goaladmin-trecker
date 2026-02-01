-- GoalAdmin & Tracker (простая синхронизация через одну таблицу)
-- Выполни это в Supabase -> SQL Editor

create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

create policy "app_state_owner" on app_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
