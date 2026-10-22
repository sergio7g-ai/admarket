create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.minhas_lojas() set schema private;
