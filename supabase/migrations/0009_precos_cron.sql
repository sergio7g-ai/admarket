-- Pesquisa de preços nos sites: 6 rondas de madrugada (05:00–05:50 UTC), até 48 produtos por ronda
select cron.schedule('pesquisar-precos-madrugada', '*/10 5 * * *', $$
  select net.http_post(
    url := 'https://uoumdhwwsxpygobgxfdj.supabase.co/functions/v1/pesquisar-precos',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <chave anon pública da app>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
$$);
