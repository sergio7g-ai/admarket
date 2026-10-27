// pesquisar-precos: procura nos sites das grandes cadeias (Continente, Auchan, Pingo Doce) o preço de cada produto das lojas.
// Usa um actor do Apify (paga por resultado, ~0,001 $). Corre de madrugada em várias rondas (pg_cron) e também a pedido
// da app quando aparece um produto novo. 0 tokens de IA: a escolha do produto certo é feita por regras.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
};
const ACTOR = 'trovevault~portugal-supermarket-prices';
const CADEIA: Record<string, string> = { 'continente': 'continente', 'auchan': 'auchan', 'pingo doce': 'pingo' };
const POR_RONDA = 48, PARALELO = 6, POR_CADEIA = 4;

const norm = (t: unknown) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function medida(t: string) {
  t = norm(t).replace(/(\d),(\d)/g, '$1.$2');
  let m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|lt|l)\b/), n: number, u: string;
  if (m) { n = +m[1] * +m[2]; u = m[3]; }
  else { m = t.match(/(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|lt|l|un|unid|doses|capsulas|rolos)\b/); if (!m) return null; n = +m[1]; u = m[2]; }
  const f: Record<string, number> = { kg: 1000, gr: 1, g: 1, l: 1000, lt: 1000, cl: 10, ml: 1 };
  return f[u] ? { v: n * f[u], d: (u === 'kg' || u === 'g' || u === 'gr') ? 'g' : 'ml' } : { v: n, d: u.startsWith('un') ? 'un' : u };
}
const QUALIF = ['lactose', 'proteina', 'cacau', 'chocolate', 'bio', 'light', 'zero', 'descafeinado', 'soluvel', 'capsulas', 'pastilhas', 'grao', 'integral', 'acucar', 'spray', 'pack'];
const QUALIF_VAR = ['magro', 'gordo'];

// pontuação de um resultado do site para uma pesquisa (marca, palavras do produto, tamanho); -1 = não serve
function pontua(it: any, q: any) {
  const nome = norm(it.productName), marca = norm(q.marca), own = norm(q.palavras + ' ' + (q.tamanho || ''));
  if (!norm(it.brand + ' ' + it.productName).includes(marca)) return -1;
  if (QUALIF.some(w => nome.includes(w) && !own.includes(w))) return -1;
  if (QUALIF_VAR.some(w => nome.includes(w) && !own.includes(w))) return -1;
  const sq = medida(q.tamanho || ''), si = medida(it.packageSize || it.productName);
  if (sq && si && (sq.d !== si.d || Math.abs(sq.v - si.v) / sq.v > 0.05)) return -1;
  const pal = norm(q.palavras).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !marca.includes(w));
  const hits = pal.filter(w => nome.includes(w.slice(0, 5))).length;
  if (pal.length && !hits) return -1;
  return hits + (sq && si ? 2 : 0);
}

async function apify(token: string, input: unknown) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=256&timeout=90&maxTotalChargeUsd=0.05`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`Apify HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json() as any[];
}

async function pesquisa(token: string, q: any) {
  const kw = q.palavras.split(/\s+/).filter((w: string) => !norm(q.marca).includes(norm(w))).join(' ').trim() || q.palavras;
  const itens = await apify(token, { supermarkets: ['continente', 'auchan', 'pingo_doce'], keyword: kw, brand: q.marca, maxProductsPerSupermarket: POR_CADEIA });
  const melhor: Record<string, any> = {};
  for (const it of itens || []) {
    const cad = CADEIA[norm(it.supermarket)]; if (!cad || !(it.price > 0)) continue;
    const s = pontua(it, q); if (s < 0) continue;
    const ef = it.discountPrice > 0 && it.discountPrice < it.price ? it.discountPrice : it.price;
    const cur = melhor[cad];
    if (!cur || s > cur.s || (s === cur.s && ef < cur.ef)) melhor[cad] = { s, ef, it };
  }
  return { n: (itens || []).length, linhas: Object.entries(melhor).map(([cadeia, { it }]) => ({
    chave: q.chave, cadeia, nome_site: String(it.productName || '').slice(0, 200), tamanho: it.packageSize || null,
    preco: it.price, preco_promo: it.discountPrice > 0 && it.discountPrice < it.price ? it.discountPrice : null,
    url: it.url || null, ref: it.productId ? String(it.productId) : null, visto_em: new Date().toISOString(),
  })) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // limpa espaços, aspas ou "Bearer" que fiquem colados ao colar a chave
  const bruto = (Deno.env.get('APIFY_TOKEN') || Deno.env.get('Apify') || '').trim();
  const token = (bruto.match(/apify_api_[A-Za-z0-9]+/)?.[0]) || bruto.replace(/^bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!token) return json({ ok: false, erro: 'falta a chave do Apify nos Secrets' }, 500);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* sem corpo */ }

  let qs: any[] = [];
  if (Array.isArray(body.chaves) && body.chaves.length) {
    // pedido da app: só produtos nunca pesquisados (evita gastar com cliques repetidos)
    const { data } = await sb.from('pesquisas_preco').select('*').in('chave', body.chaves.slice(0, 15)).is('pesquisado_em', null);
    qs = data || [];
  } else {
    const corte = new Date(Date.now() - 20 * 3600e3).toISOString(), ativo = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data } = await sb.from('pesquisas_preco').select('*').gt('ultimo_uso', ativo)
      .or(`pesquisado_em.is.null,pesquisado_em.lt.${corte}`).order('pesquisado_em', { ascending: true, nullsFirst: true }).limit(POR_RONDA);
    qs = data || [];
  }
  if (!qs.length) return json({ ok: true, pesquisados: 0, nota: 'nada para pesquisar agora' });

  let encontrados = 0, falhas = 0, resultados = 0; const erros: string[] = [];
  for (let i = 0; i < qs.length; i += PARALELO) {
    await Promise.all(qs.slice(i, i + PARALELO).map(async (q) => {
      try {
        const r = await pesquisa(token, q); resultados += r.n;
        if (r.linhas.length) { const { error } = await sb.from('precos_concorrencia').upsert(r.linhas); if (error) throw error; encontrados += r.linhas.length; }
        await sb.from('pesquisas_preco').update({ pesquisado_em: new Date().toISOString() }).eq('chave', q.chave);
      } catch (e) { falhas++; erros.push(`${q.chave}: ${String((e as Error).message || e).slice(0, 160)}`); }
    }));
  }
  const custo = +(qs.length * 0.001 + resultados * 0.001).toFixed(4);
  await sb.from('registo_pesquisas').insert({ pesquisados: qs.length, encontrados, falhas, custo_usd: custo, detalhe: { erros: erros.slice(0, 20), pedido: !!body.chaves } });
  // diagnóstico sem revelar a chave: só o formato
  const chave_ok = /^apify_api_[A-Za-z0-9]{20,}$/.test(token);
  return json({ ok: falhas < qs.length, pesquisados: qs.length, encontrados, falhas, custo_usd: custo, erros: erros.slice(0, 5), chave_formato_ok: chave_ok, chave_tamanho: token.length, tem_prefixo: bruto.includes('apify_api_'), tem_espacos: /\s/.test(bruto), tem_igual: bruto.includes('=') });
});
