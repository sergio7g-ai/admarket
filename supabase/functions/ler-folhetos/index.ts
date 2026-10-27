// ler-folhetos: lê os folhetos semanais das grandes cadeias e guarda as promoções (0 tokens de IA).
// Corre todos os dias de manhã (pg_cron). Um folheto já lido nas últimas 20 h não é lido outra vez.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as F from './folhetos.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
};
const H = { 'User-Agent': 'Mozilla/5.0 (compatible; admarket/1.0; +https://sergio7g-ai.github.io/admarket/)', 'Accept-Language': 'pt-PT' };

async function texto(url: string) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return await r.text();
}

type Fonte = { cadeia: string; lista: string; descobrir: (h: string) => string[] };
const FONTES: Fonte[] = [
  { cadeia: 'continente', lista: 'https://www.continente.pt/folhetos/', descobrir: F.folhetosContinente },
  { cadeia: 'pingo', lista: 'https://www.pingodoce.pt/folhetos/', descobrir: F.folhetosPingoDoce },
];

async function lerFolheto(cadeia: string, url: string) {
  const html = await texto(url);
  const textos = F.lerJSONArray(html, 'pageTexts') || [];
  const ano = +(url.match(/\/(20\d\d)\//)?.[1] || new Date().getFullYear());
  let datas = F.lerDatas(textos, ano), aprox = false;
  if (!datas) {
    const s = url.match(/\/S(\d{1,2})\//i) || url.match(/semanal-(\d{1,2})-/);
    if (s) { datas = F.datasSemana(ano, +s[1]); aprox = true; }
  }
  let promos: any[] = [];
  if (cadeia === 'continente') promos = F.promosContinente(textos);
  else {
    const listas = await Promise.all(F.enrichmentUrls(html).map(u => fetch(u, { headers: H }).then(r => r.ok ? r.json() : { enrichments: [] }).catch(() => ({ enrichments: [] }))));
    promos = F.promosEnrichment(listas);
  }
  const titulo = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || null;
  return { titulo, inicio: datas?.inicio || null, fim: datas?.fim || null, aprox, promos };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const forcar = new URL(req.url).searchParams.get('forcar') === '1';
  const resumo: any[] = [];
  for (const f of FONTES) {
    try {
      const urls = f.descobrir(await texto(f.lista));
      if (!urls.length) { resumo.push({ cadeia: f.cadeia, erro: 'nenhum folheto encontrado na página' }); continue; }
      for (const url of urls) {
        const { data: ja } = await sb.from('folhetos').select('lido_em').eq('url', url).maybeSingle();
        if (!forcar && ja && Date.now() - new Date(ja.lido_em).getTime() < 20 * 3600e3) { resumo.push({ cadeia: f.cadeia, url, saltado: true }); continue; }
        const r = await lerFolheto(f.cadeia, url);
        if (!r.promos.length) { resumo.push({ cadeia: f.cadeia, url, erro: 'folheto sem promoções legíveis' }); continue; }
        await sb.from('folhetos').upsert({ url, cadeia: f.cadeia, titulo: r.titulo, inicio: r.inicio, fim: r.fim, datas_aprox: r.aprox, n_promos: r.promos.length, lido_em: new Date().toISOString() });
        await sb.from('folheto_promos').delete().eq('folheto', url);
        const linhas = r.promos.map(p => ({ ...p, folheto: url, cadeia: f.cadeia, inicio: r.inicio, fim: r.fim }));
        for (let i = 0; i < linhas.length; i += 500) {
          const { error } = await sb.from('folheto_promos').insert(linhas.slice(i, i + 500));
          if (error) throw error;
        }
        resumo.push({ cadeia: f.cadeia, url, promos: linhas.length, inicio: r.inicio, fim: r.fim, aprox: r.aprox });
      }
    } catch (e) {
      resumo.push({ cadeia: f.cadeia, erro: String((e as Error).message || e) });
    }
  }
  // limpar folhetos com mais de 60 dias
  const corte = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  await sb.from('folhetos').delete().lt('fim', corte);
  return new Response(JSON.stringify({ ok: true, resumo }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
