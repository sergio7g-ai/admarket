-- Fotos dos produtos sem fundo (geradas a partir das fotos dos sites), guardadas uma vez e reutilizadas por todas as lojas
create table public.fotos_sem_fundo (
  origem text primary key,          -- endereço da foto original
  url text,                         -- foto sem fundo no Storage (null = não tinha fundo branco para tirar)
  criado_em timestamptz not null default now()
);
alter table public.fotos_sem_fundo enable row level security;
create policy "ler fotos sem fundo" on public.fotos_sem_fundo for select to authenticated using (true);
insert into storage.buckets (id, name, public) values ('fotos-produtos', 'fotos-produtos', true) on conflict (id) do nothing;
