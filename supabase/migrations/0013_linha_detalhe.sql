-- Detalhe da leitura de cada linha (para o dono perceber a conta): venda à caixa/fardo (n.º de embalagens, unidades
-- por embalagem e preço da embalagem), unidades oferecidas, desconto financeiro repartido, código interno do fornecedor.
alter table public.linhas_fatura add column if not exists detalhe jsonb;
