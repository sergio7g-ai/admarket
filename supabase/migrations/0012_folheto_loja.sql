-- Folheto da loja (gerado na app, aberto por qualquer cliente com o link) e inscrições para o receber por WhatsApp.

create table public.folhetos_loja (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  ini date not null,
  fim date not null,
  dados jsonb not null,                 -- loja, datas e produtos já prontos a desenhar (sem custos nem margens)
  criado_em timestamptz not null default now()
);
create index on public.folhetos_loja (loja_id, criado_em desc);
alter table public.folhetos_loja enable row level security;
create policy "folhetos da loja" on public.folhetos_loja for all to authenticated
  using (loja_id in (select private.minhas_lojas())) with check (loja_id in (select private.minhas_lojas()));

-- leitura pública só por id (o link), sem permitir listar os folhetos de todas as lojas
create or replace function public.folheto_publico(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'loja_id', f.loja_id, 'ini', f.ini, 'fim', f.fim, 'dados', f.dados)
  from public.folhetos_loja f where f.id = p_id
$$;
grant execute on function public.folheto_publico(uuid) to anon, authenticated;

create table public.inscricoes_folheto (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas(id) on delete cascade,
  nome text,
  telemovel text not null,
  consentimento_em timestamptz not null default now(),   -- o cliente marcou a autorização para receber por WhatsApp
  texto_consentimento text not null,
  cancelado_em timestamptz,
  unique (loja_id, telemovel)
);
alter table public.inscricoes_folheto enable row level security;
create policy "inscrições da loja" on public.inscricoes_folheto for select to authenticated
  using (loja_id in (select private.minhas_lojas()));
create policy "cancelar inscrições da loja" on public.inscricoes_folheto for update to authenticated
  using (loja_id in (select private.minhas_lojas())) with check (loja_id in (select private.minhas_lojas()));

create or replace function public.inscrever_folheto(p_loja uuid, p_nome text, p_tel text, p_texto text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t text := regexp_replace(coalesce(p_tel, ''), '[^0-9+]', '', 'g');
begin
  if t ~ '^9[1236][0-9]{7}$' then t := '+351' || t; end if;          -- telemóvel português sem indicativo
  if t !~ '^\+[0-9]{9,15}$' then return false; end if;
  if not exists (select 1 from public.lojas where id = p_loja) then return false; end if;
  insert into public.inscricoes_folheto (loja_id, nome, telemovel, texto_consentimento)
  values (p_loja, left(nullif(trim(p_nome), ''), 80), t, left(coalesce(p_texto, ''), 400))
  on conflict (loja_id, telemovel) do update set cancelado_em = null, consentimento_em = now(), texto_consentimento = excluded.texto_consentimento;
  return true;
end $$;
grant execute on function public.inscrever_folheto(uuid, text, text, text) to anon, authenticated;
