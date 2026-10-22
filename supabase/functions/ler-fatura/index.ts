// Edge function: ler-fatura
// Entrada (JSON): { loja_id, origem: 'pdf'|'foto', texto?, qr?, imagem_b64?, media_type?, ficheiro? }
//  - PDF: o browser extrai o texto (pdf.js) e o QR -> aqui só regras, 0 tokens.
//  - Foto: o browser lê o QR (jsQR); a imagem (reduzida) vai à IA -> JSON mínimo, validado com o QR.
//    IA: Gemini Flash (GEMINI_API_KEY, plano grátis) ou Claude Haiku (ANTHROPIC_API_KEY).
//    Sem IA: OCR.space (OCR_Key) -> regras.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { lerQR, lerLinhas, bate, juntarPalavras } from './parser.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT = 'Fatura de fornecedor PT. Responde só JSON: {"nif":"","num":"","data":"AAAA-MM-DD","total":0,"l":[["ean","descrição",qtd,preço_unit,desc_pct,iva_pct]]}. Sem texto extra.';

// OCR.space: grátis até 25 000 pedidos/mês, imagem até 1 MB. Devolve textos candidatos:
// linhas refeitas a partir das caixas das palavras (aguenta fotos tortas) e o texto simples.
async function ocrSpace(b64: string, mt: string): Promise<string[]> {
  const key = Deno.env.get('OCR_Key') || Deno.env.get('OCR_KEY');
  if (!key) return [];
  const f = new FormData();
  f.append('base64Image', `data:${mt};base64,${b64}`);
  f.append('language', 'por'); f.append('isOverlayRequired', 'true'); f.append('scale', 'true');
  f.append('OCREngine', '2'); f.append('detectOrientation', 'true');
  try {
    const r = await fetch('https://api.ocr.space/parse/image', { method: 'POST', headers: { apikey: key }, body: f });
    const j = await r.json();
    if (j.IsErroredOnProcessing || !j.ParsedResults) { console.log('ocr.space', JSON.stringify(j.ErrorMessage || j).slice(0, 300)); return []; }
    const res = j.ParsedResults[0] || {};
    const words = (res.TextOverlay?.Lines || []).flatMap((L: any) => L.Words.map((w: any) => ({ t: w.WordText, x0: w.Left, y0: w.Top, x1: w.Left + w.Width, y1: w.Top + w.Height })));
    return [juntarPalavras(words), String(res.ParsedText || '').replace(/\t/g, ' ')].filter(Boolean);
  } catch (e) { console.log('ocr.space erro', String(e)); return []; }
}

function tentar(texto: string, forn: any, qr: any) {
  let r = forn?.modelo ? lerLinhas(texto, forn.modelo) : null;
  if (!r || r.confianca < 0.8 || bate(r.linhas, qr) === false) r = lerLinhas(texto, null);
  const ok = bate(r.linhas, qr);
  return { r, bom: r.linhas.length > 0 && (ok === true || (r.confianca >= 0.8 && ok !== false)) };
}

function linhasIA(o: any) {
  return (o.l || []).map((x: any[]) => {
    const q = +x[2] || 1, p = +x[3], d = +x[4] || 0;
    return { ean: x[0] ? String(x[0]).replace(/\D/g, '') || null : null, descricao: String(x[1] || '').trim(), quantidade: q, preco_unit: p,
             desconto_pct: d, iva_pct: x[5] ?? null, total: Math.round(q * p * (1 - d / 100) * 100) / 100 };
  }).filter((l: any) => l.descricao && l.preco_unit > 0);
}
function cabIA(o: any) { return { nifFornecedor: o.nif ? String(o.nif).replace(/\D/g, '') : null, numero: o.num, data: o.data, total: +o.total || null }; }

async function gemini(b64: string, mt: string) {
  const key = Deno.env.get('GEMINI_API_KEY');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mt, data: b64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 2500 },
    }),
  });
  if (!r.ok) throw new Error('Gemini ' + r.status);
  const j = await r.json();
  const o = JSON.parse(j.candidates[0].content.parts.map((p: any) => p.text || '').join(''));
  return { cab: cabIA(o), linhas: linhasIA(o), tokens: j.usageMetadata?.totalTokenCount || 0 };
}

async function ia(b64: string, mt: string) {
  if (Deno.env.get('GEMINI_API_KEY')) { try { return await gemini(b64, mt); } catch (_) { /* tenta o seguinte */ } }
  if (Deno.env.get('ANTHROPIC_API_KEY')) { try { return await haiku(b64, mt); } catch (_) { /* nada */ } }
  return null;
}

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
    cab: cabIA(o), linhas: linhasIA(o),
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

  let linhas: any[] = [], metodo = 'regras', tokens = 0, modelo = null, cab: any = qr || {}, parcial: any = null;
  // PDF (ou texto já extraído): regras, 0 tokens
  if (b.texto) {
    const { r, bom } = tentar(b.texto, forn, qr);
    if (bom) { linhas = r.linhas; metodo = r.metodo; modelo = r.modelo; }
    else if (r.linhas.length) parcial = r;
  }
  // foto: IA primeiro (lê tabelas tortas e mal iluminadas muito melhor que o OCR)
  if (!linhas.length && b.imagem_b64) {
    const r = await ia(b.imagem_b64, b.media_type || 'image/jpeg');
    if (r && r.linhas.length) {
      linhas = r.linhas; tokens = r.tokens; metodo = 'ia';
      cab = { ...r.cab, ...(qr || {}) };          // o QR manda sempre
      nif = cab.nifFornecedor;
      if (nif && !forn) { const { data } = await sb.from('fornecedores').select('id,modelo').eq('loja_id', b.loja_id).eq('nif', nif).maybeSingle(); forn = data; }
    }
  }
  // sem IA: OCR.space grátis -> regras
  if (!linhas.length && b.imagem_b64) {
    for (const t of await ocrSpace(b.imagem_b64, b.media_type || 'image/jpeg')) {
      const { r, bom } = tentar(t, forn, qr);
      if (bom) { linhas = r.linhas; metodo = 'ocr'; modelo = r.modelo; break; }
      if (r.linhas.length > (parcial?.linhas.length || 0)) parcial = r;
    }
  }
  // sem IA disponível: devolve o que as regras leram para o dono completar à mão
  if (!linhas.length && parcial) { linhas = parcial.linhas; metodo = 'regras'; }
  if (!linhas.length) return json({ erro: b.imagem_b64 ? 'não consegui ler a foto. Tente com mais luz, a fatura direita e a ocupar a imagem toda.' : 'não consegui ler as linhas deste PDF' }, 422);

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
