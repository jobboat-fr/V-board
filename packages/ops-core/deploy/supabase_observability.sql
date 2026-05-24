-- VBOARD Ops Core observability table.
-- Run this once in the Supabase SQL editor for project slcyxhdwijchhxauodivn.
-- The service_role key bypasses RLS server-side. Do not add public read policies.

create extension if not exists pgcrypto;

create table if not exists public.vboard_api_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  server_name text,
  event_type text not null,
  level text not null default 'info',
  request_id text,
  method text,
  path text,
  status integer,
  duration_ms integer,
  key_id text,
  key_name text,
  route text,
  department text,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.vboard_api_events enable row level security;

create index if not exists vboard_api_events_created_at_idx
  on public.vboard_api_events (created_at desc);

create index if not exists vboard_api_events_server_created_idx
  on public.vboard_api_events (server_name, created_at desc);

create index if not exists vboard_api_events_status_idx
  on public.vboard_api_events (status);

comment on table public.vboard_api_events is
  'VBOARD Ops Core server-side API observability events. Service-role writes only; no public RLS policy.';
