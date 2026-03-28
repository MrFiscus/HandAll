-- Run this in your Supabase SQL Editor to create the calendar_events table

create table if not exists calendar_events (
  id text primary key,
  title text not null,
  start timestamptz not null,
  "end" timestamptz not null,
  type text not null default 'external',
  description text,
  completed boolean default false,
  xp_value integer default 0,
  source_url text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table calendar_events enable row level security;

-- Allow all access with anon key (for hackathon simplicity)
create policy "Allow all access" on calendar_events
  for all
  using (true)
  with check (true);
