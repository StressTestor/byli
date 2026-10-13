
create table public.trending_topics (
  id serial primary key,
  name text not null,
  query text not null,
  rank integer not null,
  post_count text,
  fetched_at timestamptz not null default now()
);

alter table public.trending_topics enable row level security;

create policy "Anyone can read trending topics"
  on public.trending_topics
  for select
  using (true);
