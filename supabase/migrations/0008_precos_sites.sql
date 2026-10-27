-- Pesquisa diária dos preços nos sites das grandes cadeias (Apify). Os produtos a pesquisar são partilhados por todas as lojas.
create table public.pesquisas_preco (
  chave text primary key,           -- marca|produto|tamanho normalizados (igual ao que a app calcula)
  marca text not null,
  palavras text not null,
  tamanho text,
  ultimo_uso timestamptz not null default now(),
  pesquisado_em timestamptz,        -- última vez que a pesquisa correu (encontrando ou não)
  criado_em timestamptz not null default now()
);
create table public.precos_concorrencia (
  chave text not null references public.pesquisas_preco(chave) on delete cascade,
  cadeia text not null,
  nome_site text,
  tamanho text,
  preco numeric(8,2),
  preco_promo numeric(8,2),
  url text,
  ref text,
  visto_em timestamptz not null default now(),
  primary key (chave, cadeia)
);
create table public.registo_pesquisas (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  pesquisados int not null default 0,
  encontrados int not null default 0,
  falhas int not null default 0,
  custo_usd numeric(8,4),
  detalhe jsonb
);
alter table public.pesquisas_preco enable row level security;
alter table public.precos_concorrencia enable row level security;
alter table public.registo_pesquisas enable row level security;
create policy "ler precos" on public.precos_concorrencia for select to authenticated using (true);
create policy "ler pesquisas" on public.pesquisas_preco for select to authenticated using (true);

-- a app regista os produtos que a loja vende; devolve as chaves nunca pesquisadas (para pesquisar já)
create or replace function public.registar_pesquisas(itens jsonb)
returns text[] language plpgsql security definer set search_path = '' as $$
declare novos text[];
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  insert into public.pesquisas_preco (chave, marca, palavras, tamanho)
  select distinct on (i->>'chave') left(i->>'chave',200), left(i->>'marca',80), left(i->>'palavras',160), left(i->>'tamanho',40)
  from jsonb_array_elements(itens) i
  where coalesce(i->>'chave','') <> '' and coalesce(i->>'marca','') <> ''
  limit 300
  on conflict (chave) do update set ultimo_uso = now();
  select coalesce(array_agg(p.chave), '{}') into novos
  from public.pesquisas_preco p
  where p.chave in (select i->>'chave' from jsonb_array_elements(itens) i)
    and p.pesquisado_em is null;
  return novos;
end $$;
revoke all on function public.registar_pesquisas(jsonb) from public, anon;
grant execute on function public.registar_pesquisas(jsonb) to authenticated;
