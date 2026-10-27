-- Promoções lidas dos folhetos das grandes cadeias (dados públicos, iguais para todas as lojas)
create table public.folhetos (
  url text primary key,
  cadeia text not null,
  titulo text,
  inicio date,
  fim date,
  datas_aprox boolean not null default false,
  n_promos int not null default 0,
  lido_em timestamptz not null default now()
);
create table public.folheto_promos (
  id bigint generated always as identity primary key,
  folheto text not null references public.folhetos(url) on delete cascade,
  cadeia text not null,
  pagina int,
  nome text not null,
  tamanho text,
  preco numeric(8,2) not null,
  preco_antes numeric(8,2),
  unidade text not null default 'un',
  cartao boolean not null default false,
  ref text,
  inicio date,
  fim date
);
create index on public.folheto_promos (fim);
create index on public.folheto_promos (folheto);
alter table public.folhetos enable row level security;
alter table public.folheto_promos enable row level security;
create policy "ler folhetos" on public.folhetos for select to authenticated using (true);
create policy "ler promos dos folhetos" on public.folheto_promos for select to authenticated using (true);

-- Devolve só as promoções em vigor ou a começar cujo nome contém alguma das marcas pedidas (poupa dados no telemóvel)
create or replace function public.folhetos_para(marcas text[])
returns setof public.folheto_promos
language sql stable security invoker set search_path = '' as $$
  select f.* from public.folheto_promos f
  where (f.fim is null or f.fim >= current_date)
    and exists (select 1 from unnest(marcas) m where length(m) >= 3 and f.nome ilike '%' || m || '%')
  order by f.preco
  limit 500;
$$;
grant execute on function public.folhetos_para(text[]) to authenticated;
