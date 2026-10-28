// sugerir-produtos: para cada linha de fatura devolve o produto já confirmado (por qualquer loja) ou até 3 candidatos
// encontrados nos sites das grandes cadeias, com foto, para o dono escolher com um toque. 0 tokens de IA.
// Cada descrição nova é procurada uma única vez (fica em cache para todas as lojas).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
};
const ACTOR = 'trovevault~portugal-supermarket-prices';
const MAX_LINHAS = 40, PARALELO = 4;   // o plano grátis do Apify limita corridas em simultâneo

export const descNorm = (d: string) => String(d || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
const norm = (t: unknown) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// abreviaturas frequentes nas faturas de fornecedores → palavras que os sites usam
const ABREV: Record<string, string> = {
  az: 'azeite', azt: 'azeite', azeit: 'azeite', oliv: 'oliveira', ve: 'virgem extra', vext: 'virgem extra', 'v.extra': 'virgem extra',
  lt: 'leite', leit: 'leite', mg: 'meio gordo', 'm.gordo': 'meio gordo', mgordo: 'meio gordo', mag: 'magro', iog: 'iogurte', nat: 'natural',
  caf: 'cafe', moid: 'moido', bol: 'bolachas', bolach: 'bolachas', arr: 'arroz', agul: 'agulha', det: 'detergente', deterg: 'detergente',
  liq: 'liquido', mass: 'massa', esparg: 'esparguete', cerv: 'cerveja', refr: 'refrigerante', ag: 'agua', choc: 'chocolate', qj: 'queijo',
  fiamb: 'fiambre', mant: 'manteiga', acuc: 'acucar', far: 'farinha', sard: 'sardinha', cons: 'conserva', hig: 'higienico', amac: 'amaciador',
  lix: 'lixivia', sab: 'sabonete', champ: 'champo', dent: 'dentes', cong: 'congelado', ref: '', cx: '', emb: '', un: '', und: '', uni: '',
};
export function palavrasChave(desc: string) {
  const t = norm(desc).replace(/s\/\s?gas/g, 'sem gas').replace(/c\/\s?gas/g, 'com gas').replace(/m\/\s?gordo/g, 'meio gordo');
  const out: string[] = [];
  for (let w of t.split(/[^a-z0-9./]+/)) {
    w = w.replace(/^[./]+|[./]+$/g, '');
    if (!w || /\d/.test(w)) continue;                  // tamanhos e códigos ficam de fora da pesquisa
    const e = ABREV[w] ?? w;
    if (e.length < 2) continue;
    for (const x of e.split(' ')) if (x && !out.includes(x)) out.push(x);
  }
  return out.slice(0, 6).join(' ');
}
function medida(t: string) {
  t = norm(t).replace(/(\d),(\d)/g, '$1.$2');
  let m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|lt|l)\b/), n: number, u: string;
  if (m) { n = +m[1] * +m[2]; u = m[3]; }
  else { m = t.match(/(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|lt|l)\b/); if (!m) return null; n = +m[1]; u = m[2]; }
  const f: Record<string, number> = { kg: 1000, gr: 1, g: 1, l: 1000, lt: 1000, cl: 10, ml: 1 };
  return { v: n * f[u], d: (u === 'kg' || u === 'g' || u === 'gr') ? 'g' : 'ml' };
}
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'ao', 'em', 'para', 'pack', 'emb', 'und', 'uni', 'gr', 'kg', 'cl', 'ml', 'lt']);
// pontuação de um candidato (formato {produto, marca, tamanho}) para a descrição da fatura:
// +2 por cada palavra da fatura que aparece, -1 por cada palavra a mais no candidato ("oro", "picante", "sem lactose"), ±tamanho
function pontua(c: any, desc: string, kw: string) {
  const marca = norm(c.marca), nome = norm(c.produto + ' ' + (c.marca || ''));
  const alvo = norm(desc) + ' ' + kw;
  const ws = kw.split(' ').filter(w => w.length > 2);
  let s = 2 * ws.filter(w => nome.includes(w.slice(0, 5))).length;
  const extra = norm(c.produto).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/\d/.test(w) && !VAZIAS.has(w) && !marca.includes(w) && !alvo.includes(w.slice(0, 5)));
  s -= extra.length;
  const sd = medida(desc), si = medida(c.tamanho || c.produto);
  if (sd && si) { if (sd.d !== si.d || Math.abs(sd.v - si.v) / sd.v > 0.05) s -= 4; else s += 3; }
  return s;
}
const melhores = (cands: any[], desc: string) => {
  const kw = palavrasChave(desc);
  return cands.map(c => ({ c, s: pontua(c, desc, kw) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.c);
};

async function procurar(token: string, desc: string) {
  const kw = palavrasChave(desc);
  if (kw.split(' ').length < 1 || kw.length < 3) return [];
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=256&timeout=90&maxTotalChargeUsd=0.03`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supermarkets: ['continente', 'pingo_doce'], keyword: kw, maxProductsPerSupermarket: 5 }) });
  if (!r.ok) throw new Error(`Apify HTTP ${r.status}`);
  const itens = await r.json() as any[];
  const vistos = new Set<string>(), out: any[] = [];
  for (const x of itens || []) {
    const k = norm(x.productName) + '|' + norm(x.packageSize);
    if (vistos.has(k)) continue; vistos.add(k);
    out.push({ marca: x.brand || null, produto: x.productName, tamanho: x.packageSize || null, imagem: x.imageUrl || null, preco: x.discountPrice || x.price || null, loja: x.supermarket });
  }
  return out;   // guardam-se todos (até 10); a ordenação faz-se à saída
}

async function procurarComRetry(token: string, desc: string) {
  try { return await procurar(token, desc); }
  catch (e) { if (/HTTP (402|429)/.test(String(e))) { await new Promise(r => setTimeout(r, 2500)); return await procurar(token, desc); } throw e; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const bruto = (Deno.env.get('APIFY_TOKEN') || Deno.env.get('Apify') || '').trim();
  const token = bruto.match(/apify_api_[A-Za-z0-9]+/)?.[0] || bruto;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch (_) { /* */ }
  const linhas = (Array.isArray(body.linhas) ? body.linhas : []).slice(0, MAX_LINHAS);
  const res: any[] = new Array(linhas.length);
  for (let i = 0; i < linhas.length; i += PARALELO) {
    await Promise.all(linhas.slice(i, i + PARALELO).map(async (l: any, j: number) => {
      const idx = i + j, d = descNorm(l.descricao), nif = String(l.nif || '');
      try {
        // 1) já confirmado por alguma loja (do mesmo fornecedor, ou de qualquer um)
        const { data: cs } = await sb.from('correspondencias').select('*').eq('desc_norm', d).in('nif', [nif, '']).order('confirmacoes', { ascending: false });
        const ok = (cs || []).find((c: any) => c.confirmacoes > c.rejeicoes);
        if (ok) { res[idx] = { conhecido: true, produto: { marca: ok.marca, produto: ok.produto, tamanho: ok.tamanho, imagem: ok.imagem } }; return; }
        // 2) candidatos já procurados
        const { data: cache } = await sb.from('candidatos_cache').select('candidatos').eq('desc_norm', d).maybeSingle();
        if (cache) { res[idx] = { candidatos: melhores(cache.candidatos, l.descricao) }; return; }
        if (!token) { res[idx] = { candidatos: [] }; return; }
        // 3) procurar nos sites (uma vez por descrição, para todas as lojas)
        const cand = await procurarComRetry(token, l.descricao);
        await sb.from('candidatos_cache').upsert({ desc_norm: d, candidatos: cand });
        res[idx] = { candidatos: melhores(cand, l.descricao) };
      } catch (e) { res[idx] = { candidatos: [], erro: String((e as Error).message || e).slice(0, 120) }; }
    }));
  }
  return json({ ok: true, linhas: res });
});
