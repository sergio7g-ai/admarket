create table public.erros_app (id bigint generated always as identity primary key, user_id uuid default auth.uid() references auth.users(id) on delete cascade, msg text not null, contexto jsonb, criado_em timestamptz not null default now());
alter table public.erros_app enable row level security;
create policy "registar os meus erros" on public.erros_app for insert to authenticated with check (user_id = (select auth.uid()));
create index on public.erros_app (user_id);
