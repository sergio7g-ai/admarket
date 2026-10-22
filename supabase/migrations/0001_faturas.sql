-- admarket · fase 2 · faturas reais
-- Cada loja só vê os seus dados (RLS por membro da loja).

create table public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nif text,
  margens jsonb not null default '{"Frescos":30,"Mercearia":20,"Bebidas":25,"Higiene":25}',
  criado_em timestamptz not null default now()
);

create table public.membros_loja (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'dono' check (papel in ('dono','funcionario')),
  primary key (loja_id, user_id)
);
create index on public.membros_loja (user_id);

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  nif text not null,
  nome text,
  -- modelo aprendido: como ler as linhas deste fornecedor sem IA
  modelo jsonb,
  faturas_lidas int not null default 0,
  unique (loja_id, nif)
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  ean text,
  nome text not null,
  marca text,
  qtd text,
  categoria text not null default 'Mercearia',
  custo numeric(10,4),
  custo_atualizado_em timestamptz,
  foto_url text
);
create unique index on public.produtos (loja_id, ean) where ean is not null;
create index on public.produtos (loja_id);

-- nome que o fornecedor usa -> produto da loja (evita IA na 2.ª vez)
create table public.aliases_produto (
  loja_id uuid not null references public.lojas(id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores(id) on delete cascade,
  texto text not null,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  primary key (fornecedor_id, texto)
);
create index on public.aliases_produto (loja_id);
create index on public.aliases_produto (produto_id);

create table public.faturas (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  fornecedor_id uuid references public.fornecedores(id),
  numero text,
  atcud text,
  data date,
  total numeric(12,2),
  origem text not null check (origem in ('pdf','foto')),
  metodo text not null check (metodo in ('modelo','regras','ia')),
  tokens int not null default 0,
  estado text not null default 'por_confirmar' check (estado in ('por_confirmar','confirmada')),
  ficheiro text,
  criado_em timestamptz not null default now(),
  unique (loja_id, atcud)
);
create index on public.faturas (loja_id, criado_em desc);
create index on public.faturas (fornecedor_id);

create table public.linhas_fatura (
  id uuid primary key default gen_random_uuid(),
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  loja_id uuid not null references public.lojas(id) on delete cascade,
  ean text,
  descricao text not null,
  quantidade numeric(10,3) not null default 1,
  preco_unit numeric(10,4) not null,
  desconto_pct numeric(5,2) not null default 0,
  iva_pct numeric(4,1),
  custo_unit numeric(10,4) generated always as (preco_unit * (1 - desconto_pct/100)) stored,
  produto_id uuid references public.produtos(id)
);
create index on public.linhas_fatura (fatura_id);
create index on public.linhas_fatura (loja_id);
create index on public.linhas_fatura (produto_id);

-- ---------- RLS ----------
create or replace function public.minhas_lojas() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select loja_id from public.membros_loja where user_id = (select auth.uid())
$$;
revoke execute on function public.minhas_lojas() from anon, public;
grant execute on function public.minhas_lojas() to authenticated;

alter table public.lojas enable row level security;
alter table public.membros_loja enable row level security;
alter table public.fornecedores enable row level security;
alter table public.produtos enable row level security;
alter table public.aliases_produto enable row level security;
alter table public.faturas enable row level security;
alter table public.linhas_fatura enable row level security;

create policy "ver as minhas lojas" on public.lojas for all to authenticated
  using (id in (select public.minhas_lojas())) with check (id in (select public.minhas_lojas()));
create policy "ver a minha associação" on public.membros_loja for select to authenticated
  using (user_id = (select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['fornecedores','produtos','aliases_produto','faturas','linhas_fatura'] loop
    execute format('create policy "dados da loja" on public.%I for all to authenticated
      using (loja_id in (select public.minhas_lojas()))
      with check (loja_id in (select public.minhas_lojas()))', t);
  end loop;
end $$;

-- ---------- criar loja + dono numa só chamada ----------
create or replace function public.criar_loja(p_nome text, p_nif text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  insert into public.lojas(nome, nif) values (p_nome, p_nif) returning id into v;
  insert into public.membros_loja(loja_id, user_id) values (v, auth.uid());
  return v;
end $$;
revoke execute on function public.criar_loja(text,text) from anon, public;
grant execute on function public.criar_loja(text,text) to authenticated;

-- ---------- confirmar fatura: atualiza custos e aprende aliases ----------
create or replace function public.confirmar_fatura(p_fatura uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.produtos p set custo = l.custo_unit, custo_atualizado_em = now()
  from public.linhas_fatura l
  where l.fatura_id = p_fatura and l.produto_id = p.id;

  insert into public.aliases_produto(loja_id, fornecedor_id, texto, produto_id)
  select f.loja_id, f.fornecedor_id, lower(l.descricao), l.produto_id
  from public.linhas_fatura l join public.faturas f on f.id = l.fatura_id
  where f.id = p_fatura and l.produto_id is not null and f.fornecedor_id is not null
  on conflict (fornecedor_id, texto) do update set produto_id = excluded.produto_id;

  update public.fornecedores set faturas_lidas = faturas_lidas + 1
  where id = (select fornecedor_id from public.faturas where id = p_fatura);

  update public.faturas set estado = 'confirmada' where id = p_fatura;
end $$;
revoke execute on function public.confirmar_fatura(uuid) from anon, public;
grant execute on function public.confirmar_fatura(uuid) to authenticated;

-- ---------- ficheiros das faturas (privados, uma pasta por loja) ----------
insert into storage.buckets (id, name, public) values ('faturas', 'faturas', false)
on conflict do nothing;
create policy "faturas da loja" on storage.objects for all to authenticated
  using (bucket_id = 'faturas' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text))
  with check (bucket_id = 'faturas' and (storage.foldername(name))[1] in (select public.minhas_lojas()::text));
