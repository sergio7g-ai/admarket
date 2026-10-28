-- O dono confirma uma vez "é este produto" e fica aprendido para todas as lojas (mesma descrição do mesmo fornecedor)
create table public.correspondencias (
  desc_norm text not null,          -- descrição da linha da fatura, normalizada
  nif text not null default '',     -- NIF do fornecedor ('' = qualquer)
  marca text,
  produto text,
  tamanho text,
  imagem text,
  confirmacoes int not null default 0,
  rejeicoes int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (desc_norm, nif)
);
-- candidatos já procurados nos sites (para não pagar duas vezes a mesma descrição)
create table public.candidatos_cache (
  desc_norm text primary key,
  candidatos jsonb not null,
  criado_em timestamptz not null default now()
);
alter table public.correspondencias enable row level security;
alter table public.candidatos_cache enable row level security;
create policy "ler correspondencias" on public.correspondencias for select to authenticated using (true);

create or replace function public.confirmar_produto(p_desc text, p_nif text, p_marca text, p_produto text, p_tamanho text, p_imagem text, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare d text := left(lower(trim(p_desc)), 200);
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  if coalesce(d, '') = '' then return; end if;
  if p_ok then
    insert into public.correspondencias as c (desc_norm, nif, marca, produto, tamanho, imagem, confirmacoes)
    values (d, coalesce(p_nif, ''), left(p_marca, 80), left(p_produto, 160), left(p_tamanho, 40), left(p_imagem, 500), 1)
    on conflict (desc_norm, nif) do update set
      confirmacoes = case when c.produto is distinct from excluded.produto then 1 else c.confirmacoes + 1 end,
      rejeicoes = case when c.produto is distinct from excluded.produto then 0 else c.rejeicoes end,
      marca = excluded.marca, produto = excluded.produto, tamanho = excluded.tamanho, imagem = excluded.imagem, atualizado_em = now();
  else
    update public.correspondencias set rejeicoes = rejeicoes + 1, atualizado_em = now()
    where desc_norm = d and nif = coalesce(p_nif, '') and produto is not distinct from p_produto;
  end if;
end $$;
revoke all on function public.confirmar_produto(text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.confirmar_produto(text, text, text, text, text, text, boolean) to authenticated;
