alter table public.faturas drop constraint faturas_metodo_check;
alter table public.faturas add constraint faturas_metodo_check check (metodo in ('modelo','regras','ocr','ia'));
