// Edge function: ler-fatura
// Entrada (JSON): { loja_id, origem: 'pdf'|'foto', texto?, qr?, imagem_b64?, media_type?, ficheiro? }
//  - PDF: o browser extrai o texto (pdf.js) e o QR -> aqui só regras, 0 tokens.
//  - Foto: o browser tenta ler o QR (jsQR). Se o fornecedor tiver modelo e houver texto OCR, 0 tokens.
//    Só em último caso vai à IA (Haiku), com resposta mínima em JSON.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { lerQR, lerLinhas, bate } from './parser.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT = 'Fatura de fornecedor PT. Responde só JSON: {"nif":"","num":"","data":"AAAA-MM-DD","total":0,"l":[["ean","descrição",qtd,preço_unit,desc_pct,iva_pct]]}. Sem texto extra.';

async function haiku(b64: string, mt: string) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 1500, temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
        { type: 'text', text: PROMPT },
      ] }, { role: 'assistant', content: '{' }],
    }),
  });
  if (!r.ok) throw new Error('IA ' + r.status);
  const j = await r.json();
  const o = JSON.parse('{' + j.content[0].text);
  return {
    cab: { nifFornecedor: o.nif, numero: o.num, data: o.data, total: o.total },
    linhas: (o.l || []).map((x: any[]) => ({ ean: x[0] || null, descricao: x[1], quantidade: +x[2] || 1, preco_unit: +x[3], desconto_pct: +x[4] || 0, iva_pct: x[5] ?? null })),
    tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ erro: 'sem sessão' }, 401);

  const b = await req.json();
  const qr = lerQR(b.qr);
  let nif = qr?.nifFornecedor ?? null;

  // fornecedor e modelo aprendido
  let forn: any = null;
  if (nif) {
    const { data } = await sb.from('fornecedores').select('id,modelo').eq('loja_id', b.loja_id).eq('nif', nif).maybeSingle();
    forn = data;
  }

  let linhas: any[] = [], metodo = 'regras', tokens = 0, modelo = null, cab: any = qr || {};
  if (b.texto) {
    let r = forn?.modelo ? lerLinhas(b.texto, forn.modelo) : null;
    if (!r || r.confianca < 0.8 || bate(r.linhas, qr) === false) r = lerLinhas(b.texto, null);
    const ok = bate(r.linhas, qr);
    if (r.linhas.length && (ok === true || (r.confianca >= 0.8 && ok !== false))) {
      linhas = r.linhas; metodo = r.metodo; modelo = r.modelo;
    }
  }
  if (!linhas.length && b.imagem_b64) {
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ erro: 'leitura de fotos ainda não ativada (falta a chave da IA)' }, 503);
    let r;
    try { r = await haiku(b.imagem_b64, b.media_type || 'image/jpeg'); }
    catch (e) { return json({ erro: 'não consegui ler a foto: ' + (e as Error).message }, 502); }
    linhas = r.linhas; tokens = r.tokens; metodo = 'ia';
    cab = { ...r.cab, ...(qr || {}) };          // o QR manda sempre
    nif = cab.nifFornecedor;
  }
  if (!linhas.length) return json({ erro: 'não consegui ler as linhas', precisa: b.imagem_b64 ? null : 'foto' }, 422);

  // fornecedor: criar ou guardar modelo
  if (nif && !forn) {
    const { data } = await sb.from('fornecedores').insert({ loja_id: b.loja_id, nif, modelo }).select('id').single();
    forn = data;
  } else if (forn && modelo && !forn.modelo) {
    await sb.from('fornecedores').update({ modelo }).eq('id', forn.id);
  }

  const { data: fat, error } = await sb.from('faturas').insert({
    loja_id: b.loja_id, fornecedor_id: forn?.id, numero: cab.numero, atcud: cab.atcud, data: cab.data,
    total: cab.total, origem: b.origem, metodo, tokens, ficheiro: b.ficheiro,
  }).select('id').single();
  if (error) return json({ erro: error.code === '23505' ? 'fatura já registada' : error.message }, 409);

  // associar produtos sem IA: EAN -> alias do fornecedor
  const eans = linhas.map(l => l.ean).filter(Boolean);
  const { data: porEan } = eans.length ? await sb.from('produtos').select('id,ean').eq('loja_id', b.loja_id).in('ean', eans) : { data: [] };
  const { data: als } = forn ? await sb.from('aliases_produto').select('texto,produto_id').eq('fornecedor_id', forn.id) : { data: [] };
  const mapE = new Map((porEan || []).map((p: any) => [p.ean, p.id]));
  const mapA = new Map((als || []).map((a: any) => [a.texto, a.produto_id]));

  const rows = linhas.map(l => ({
    fatura_id: fat.id, loja_id: b.loja_id, ean: l.ean, descricao: l.descricao, quantidade: l.quantidade,
    preco_unit: l.preco_unit, desconto_pct: l.desconto_pct, iva_pct: l.iva_pct,
    produto_id: (l.ean && mapE.get(l.ean)) || mapA.get(l.descricao.toLowerCase()) || null,
  }));
  const { data: ins } = await sb.from('linhas_fatura').insert(rows).select('id,ean,descricao,quantidade,custo_unit,produto_id');

  return json({ fatura_id: fat.id, metodo, tokens, cabecalho: cab, linhas: ins, validada_qr: bate(linhas, qr) });
});
