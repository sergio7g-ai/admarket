-- Ler os folhetos todos os dias às 06:17 UTC (a função salta os que já leu nas últimas 20 h)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ler-folhetos-diario', '17 6 * * *', $$
  select net.http_post(
    url := 'https://uoumdhwwsxpygobgxfdj.supabase.co/functions/v1/ler-folhetos',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvdW1kaHd3c3hweWdvYmd4ZmRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NTQ1ODEsImV4cCI6MjEwODIzMDU4MX0.5iahbftWPAG1Gb8DcKKGu9mCkQu45RZUzXr8yCfTz0I'),
    body := '{}'::jsonb)
$$);
