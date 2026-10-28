// GERADO a partir de supabase/functions/ler-fatura/{index.ts,parser.js} — não editar à mão
// Edge function: ler-fatura
// Entrada (JSON): { loja_id, origem: 'pdf'|'foto', texto?, qr?, imagem_b64?, media_type?, ficheiro? }
//  - PDF: o browser extrai o texto (pdf.js) e o QR -> aqui só regras, 0 tokens.
//  - Foto: o browser lê o QR (jsQR); a imagem (reduzida) vai à IA -> JSON mínimo, validado com o QR.
//    IA: Gemini Flash (GEMINI_API_KEY, plano grátis) ou Claude Haiku (ANTHROPIC_API_KEY).
//    Sem IA: OCR.space (OCR_Key) -> regras.
import { createClient } from 'npm:@supabase/supabase-js@2';
// ---- parser.js (embutido no deploy; fonte: supabase/functions/ler-fatura/parser.js) ----
// Leitor de faturas sem IA. Corre no browser e na edge function.
// 1) QR ATCUD (obrigatório em PT) -> NIF, número, data, total, IVA.
// 2) Linhas: regra numérica (qtd × preço × (1-desc) ≈ total da linha).
// 3) Modelo do fornecedor: posições das colunas aprendidas na 1.ª fatura.

function lerQR(txt) {
  if (!txt || !txt.includes('A:') || !txt.includes('*')) return null;
  const c = {};
  for (const p of txt.split('*')) { const i = p.indexOf(':'); if (i > 0) c[p.slice(0, i)] = p.slice(i + 1); }
  if (!c.A || !c.O) return null;
  return {
    nifFornecedor: c.A, nifCliente: c.B, tipo: c.D, numero: c.G, atcud: c.H,
    data: c.F && `${c.F.slice(0, 4)}-${c.F.slice(4, 6)}-${c.F.slice(6, 8)}`,
    totalIva: num(c.N), total: num(c.O),
  };
}

const NUM = /^-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^-?\d+(?:[.,]\d+)?$/;
function num(s) {
  if (s == null) return null;
  s = String(s).trim().replace('%', '');
  if (/,\d+$/.test(s)) s = s.replace(/[.\s]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const perto = (a, b) => Math.abs(a - b) <= Math.max(0.02, b * 0.006);

// separa a linha em descrição + números finais
function partir(linha) {
  const t = linha.replace(/[€|\[\]]/g, ' ').replace(/(\d)(un|uni|cx|emb)\b/gi, '$1 $2').replace(/^(\d{11,13}) (\d{1,2}) /, '$1$2 ').replace(/(\d) ,(\d)/g, '$1,$2').replace(/(\s\d{1,4}) (\d{2})\s*$/, '$1,$2').trim().split(/\s+/)
    .map(x => /^[OQDo]{1,2}$/.test(x) ? '0' : /^[DOQ]\d{2,}$/.test(x) ? '0' + x.slice(1)
      : /^[\dOolI.,%]+$/.test(x) && /\d/.test(x) ? x.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') : x); // erros típicos de OCR
  if (t.length) { const d = t[0].replace(/\D/g, ''); if (d.length >= 8 && d.length / t[0].length > 0.75) t[0] = d; }
  // números do fim da linha; ignora lixo curto do OCR no meio (ex.: "un" lido como "มก", "23-")
  const nums = []; let lixo = 0;
  while (t.length) {
    const x = t[t.length - 1], limpo = x.replace(/^[-–.:]+|[-–.:]+$/g, '').replace('%', '');
    if (NUM.test(limpo)) { t.pop(); nums.unshift(limpo); lixo = 0; continue; }
    const unidade = /^(un|uni|kg|cx|lt|l|emb|u)$/i.test(x);
    const curto = !/[a-zà-ú]{3,}/i.test(x) && !/\d/.test(x) && x.length <= 4;   // sem letras latinas reais nem dígitos
    if ((unidade || curto) && lixo < 2 && nums.length) { t.pop(); lixo++; continue; }
    break;
  }
  let ean = null;
  if (t.length && /^\d{8,14}$/.test(t[0])) ean = t.shift();
  else { const k = t.findIndex(x => /^\d{8,14}$/.test(x)); if (k >= 0 && k < 2) { ean = t[k]; t.splice(0, k + 1); } }
  return { ean, desc: t.join(' '), nums };
}

const IVAS = [6, 13, 23];

// tenta descobrir qtd, preço, desconto, iva e total pelos números
function adivinhar(nums) {
  const v = nums.map(num);
  const n = v.length;
  if (n < 3) return null;
  for (let it = n - 1; it >= 2; it--) {           // total da linha
    for (let iq = 0; iq < it; iq++) for (let ip = 0; ip < it; ip++) {
      if (iq === ip) continue;
      const q = v[iq], tot = v[it]; let p = v[ip];
      if (!(q > 0 && p > 0)) continue;
      if (Number.isInteger(p) && p >= 100 && !perto(q * p, tot) && perto(q * p / 100, tot)) p = p / 100;   // vírgula perdida no OCR
      for (let id = 0; id < it; id++) {
        if (id === iq || id === ip) continue;
        const d = v[id];
        if (d >= 0 && d < 100 && !IVAS.includes(d) && perto(q * p * (1 - d / 100), tot)) return pos(iq, ip, id, it, v);
      }
      if (perto(q * p, tot)) return pos(iq, ip, -2, it, v);   // sem coluna de desconto (ou desconto 0)
    }
  }
  // a coluna do desconto não foi lida (OCR): deduz o desconto se der um valor redondo
  for (let it = n - 1; it >= 2; it--) for (let iq = 0; iq < it; iq++) for (let ip = 0; ip < it; ip++) {
    if (iq !== ip && descDeduzido(v[iq], v[ip], v[it]) != null) return pos(iq, ip, -2, it, v);
  }
  return null;
}
function descDeduzido(q, p, tot) {
  if (!(q > 0 && p > 0 && tot > 0) || tot > q * p + 0.02) return null;
  const d = (1 - tot / (q * p)) * 100, r = Math.round(d * 2) / 2;
  return r > 0 && r <= 50 && perto(q * p * (1 - r / 100), tot) ? r : null;
}
function pos(iq, ip, id, it, v) {
  const ii = v.findIndex((x, k) => ![iq, ip, id, it].includes(k) && IVAS.includes(x));
  return { iq, ip, id, ii, it, n: v.length };
}

function linhaCom(m, p, deduzir = true) {
  let v = p.nums.map(num);
  if (v.length > m.n) {                       // números a mais no início fazem parte da descrição (ex.: "120 g")
    const extra = p.nums.slice(0, v.length - m.n);
    p = { ...p, desc: (p.desc + ' ' + extra.join(' ')).trim() }; v = v.slice(v.length - m.n);
  }
  if (v.length !== m.n) return null;
  const q = v[m.iq], tot = v[m.it]; let pr = v[m.ip];
  if (Number.isInteger(pr) && pr >= 100 && perto(q * pr / 100, tot)) pr = pr / 100;
  let d = m.id >= 0 ? v[m.id] : 0;
  if (m.id === -2 && !perto(q * pr, tot)) { if (!deduzir) return null; d = descDeduzido(q, pr, tot); if (d == null) return null; }
  if (!(q > 0 && pr > 0) || !perto(q * pr * (1 - d / 100), tot)) return null;
  return { ean: p.ean, descricao: p.desc, quantidade: q, preco_unit: pr, desconto_pct: d,
           iva_pct: m.ii >= 0 ? v[m.ii] : null, total: tot };
}

// Resolve uma linha sem inventar: o total da linha é o último número; procura qtd × preço × (1 − desconto) = total,
// em que o desconto é 0 ou um número que está mesmo na linha (nunca uma taxa de IVA). Prefere qtd inteira e preço com cêntimos.
function resolver(p) {
  const v = p.nums.map(num);
  const n = v.length; if (n < 2) return null;
  const tot = v[n - 1]; if (!(tot > 0)) return null;
  // quantidade que o OCR colou ao fim da descrição ("... 250g 20")
  const mq = p.desc.match(/\s(\d{1,3})$/);
  const qExtra = mq && !/\d\s*(g|kg|l|ml|cl)$/i.test(p.desc.slice(0, -mq[0].length)) ? +mq[1] : null;
  const qs = v.slice(0, n - 1).map((x, i) => ({ x, i })).filter(o => o.x > 0);
  if (qExtra) qs.push({ x: qExtra, i: -1 });
  let melhor = null;
  for (const Q of qs) for (let ip = 0; ip < n - 1; ip++) {
    if (ip === Q.i) continue;
    const brutos = [v[ip]]; if (Number.isInteger(v[ip]) && v[ip] >= 10) brutos.push(v[ip] / 100);   // vírgula perdida
    for (const pr of brutos) {
      if (!(pr > 0)) continue;
      const resto = v.slice(0, n - 1).map((x, i) => ({ x, i })).filter(o => o.i !== Q.i && o.i !== ip);
      const ds = [{ d: 0, explicito: resto.some(o => o.x === 0) }];
      for (const o of resto) if (o.x > 0 && o.x < 100 && !IVAS.includes(o.x)) ds.push({ d: o.x, explicito: true, i: o.i });
      for (const D of ds) {
        if (!perto(Q.x * pr * (1 - D.d / 100), tot)) continue;
        let sc = 0;
        if (Number.isInteger(Q.x)) sc += 3;
        if (!Number.isInteger(pr)) sc += 2;
        if (pr !== v[ip]) sc -= 1;                        // usou a correção da vírgula
        if (Q.i >= 0 && Q.i < ip) sc += 1;                // a quantidade vem antes do preço
        if (Q.i === -1) sc -= 1;
        if (D.explicito) sc += 1;
        if (resto.some(o => IVAS.includes(o.x))) sc += 1; // sobra uma taxa de IVA: colunas coerentes
        if (!melhor || sc > melhor.sc) melhor = { sc, q: Q.x, pr, d: D.d, qExtra: Q.i === -1 };
      }
    }
  }
  if (!melhor && p.ean) {             // só em linhas de produto (com código de barras)
    // o OCR trocou um algarismo do preço (0,95 → 0,90): se total ÷ qtd dá cêntimos certos, é esse o custo (é o que interessa)
    for (const Q of qs) {
      if (!Number.isInteger(Q.x) || Q.x < 1 || Q.x > 999 || IVAS.includes(Q.x) && qs.length > 1 && Q.i > 0) continue;
      const pr = tot / Q.x;
      if (pr > 0 && Math.abs(pr * 100 - Math.round(pr * 100)) < 1e-6) { melhor = { q: Q.x, pr: Math.round(pr * 100) / 100, d: 0, qExtra: Q.i === -1, calculado: true }; break; }
    }
    if (!melhor) return null;
  }
  if (!melhor) return null;
  const iva = v.slice(0, n - 1).find(x => IVAS.includes(x)) ?? null;
  return { ean: p.ean, descricao: melhor.qExtra ? p.desc.slice(0, -mq[0].length).trim() : p.desc, quantidade: melhor.q, preco_unit: melhor.pr,
           desconto_pct: melhor.d, iva_pct: iva, total: tot, ...(melhor.calculado ? { calculado: true } : {}) };
}

// texto -> { linhas, modelo, metodo, confianca }
function lerLinhas(texto, modelo, qr = null) {
  const partes = texto.split(/\r?\n/).map(partir).filter(p => p.desc.length > 2 && (p.nums.length >= 3 || (p.ean && p.nums.length >= 2)));
  let usado = modelo, metodo = 'modelo';
  if (!usado) {
    const votos = {};
    for (const p of partes) { const g = adivinhar(p.nums); if (g) { const k = JSON.stringify(g); votos[k] = (votos[k] || 0) + 1; } }
    const top = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    usado = top ? JSON.parse(top[0]) : null; metodo = 'regras';
  }
  // cada linha usa o padrão da maioria; se falhar (o OCR perdeu ou juntou colunas), tenta o seu próprio padrão
  // 1.º resolve cada linha por si (total = último número, sem descontos inventados); 2.º o padrão do fornecedor/maioria, só se for coerente
  const res = partes.map(p => resolver(p) || (usado && linhaCom(usado, p, false)) || null);
  const linhas = res.filter(Boolean);
  // se só falhou uma linha e há QR, o total em falta é (total sem IVA do QR − soma das outras)
  const falhas = partes.filter((p, i) => !res[i] && /^\d{8,14}$/.test(p.ean || ''));
  if (qr && qr.total && qr.totalIva != null && falhas.length === 1 && bate(linhas, qr) === false) {
    const p = falhas[0], v = p.nums.map(num), q = v[0], pr = v[1];
    const falta = Math.round((qr.total - qr.totalIva - linhas.reduce((s, l) => s + l.total, 0)) * 100) / 100;
    const d = perto(q * pr, falta) ? 0 : descDeduzido(q, pr, falta);
    if (q > 0 && q === Math.round(q) && pr > 0 && d != null)
      linhas.splice(res.indexOf(null) >= 0 ? res.slice(0, partes.indexOf(p)).filter(Boolean).length : linhas.length, 0,
        { ean: p.ean, descricao: p.desc, quantidade: q, preco_unit: pr, desconto_pct: d, iva_pct: null, total: falta });
  }
  // produtos com código de barras que não bateram: entram como "a confirmar" com a melhor estimativa
  const vistos = new Set(linhas.map(l => l.ean).filter(Boolean));
  for (const p of texto.split(/\r?\n/).map(partir)) {
    if (!/^(\d{8}|\d{12,14})$/.test(p.ean || '') || vistos.has(p.ean) || !/[a-zà-ú]{3,}/i.test(p.desc)) continue;
    const v = p.nums.map(num).filter(x => x != null);
    const q = v.find(x => Number.isInteger(x) && x > 0 && x < 1000) ?? 1;
    const tot = v.length >= 2 && !Number.isInteger(v[v.length - 1]) ? v[v.length - 1] : null;
    const outro = v.slice(0, tot != null ? -1 : undefined).find(x => !Number.isInteger(x) && x > 0);
    const pr = outro ?? (tot != null && q > 0 ? Math.round(tot / q * 10000) / 10000 : 0);
    linhas.push({ ean: p.ean, descricao: p.desc, quantidade: q, preco_unit: pr, desconto_pct: 0, iva_pct: null, total: tot ?? Math.round(q * pr * 100) / 100, incerta: true });
    vistos.add(p.ean);
  }
  return { linhas, modelo: usado, metodo, confianca: partes.length ? linhas.filter(l => !l.incerta).length / partes.length : 0 };
}

// valida com o QR: soma das linhas sem IVA + IVA ≈ total
function bate(linhas, qr) {
  if (!qr || !qr.total) return null;
  const base = linhas.reduce((s, l) => s + l.total, 0);
  const iva = qr.totalIva ?? linhas.reduce((s, l) => s + l.total * (l.iva_pct || 0) / 100, 0);
  return perto(base + iva, qr.total) || perto(base, qr.total);
}

// junta palavras soltas (com caixas x0,y0,x1,y1) em linhas seguindo a inclinação local: aguenta fotos tortas
function juntarPalavras(words) {
  const W = words.filter(w => w.t && w.t.trim()).map(w => ({ t: w.t.trim(), x0: w.x0, x1: w.x1, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, used: 0 }));
  if (!W.length) return '';
  const medH = W.map(w => w.h).sort((a, b) => a - b)[W.length >> 1] || 20;
  W.sort((a, b) => a.x0 - b.x0);
  const out = [];
  for (const w of W) {
    if (w.used) continue; w.used = 1; const L = [w]; let cur = w, slope = 0;
    for (;;) {
      let best = null, bd = 1e9;
      for (const v of W) {
        if (v.used || v.x0 < cur.x1 - medH * 0.3) continue;
        const dx = v.x0 - cur.x1; if (dx > medH * 25) continue;
        const dy = Math.abs(v.cy - (cur.cy + slope * (v.x0 - cur.x0)));
        if (dy > medH * 0.55 || v.h > medH * 2.2) continue;
        const s = dx + dy * 8; if (s < bd) { bd = s; best = v; }
      }
      if (!best) break;
      best.used = 1;
      if (best.x0 - w.x0 > medH * 4) slope = Math.max(-0.1, Math.min(0.1, (best.cy - w.cy) / (best.x0 - w.x0)));
      L.push(best); cur = best;
    }
    out.push(L);
  }
  return out.sort((a, b) => a[0].cy - b[0].cy).map(L => L.map(w => w.t).join(' ')).join('\n');
}

// ---- fim do parser ----

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region' };   // o supabase-js envia x-client-info: sem isto o Safari bloqueia
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
  let r = forn?.modelo ? lerLinhas(texto, forn.modelo, qr) : null;
  if (!r || r.confianca < 0.8 || bate(r.linhas, qr) === false) r = lerLinhas(texto, null, qr);
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
    preco_unit: l.preco_unit, desconto_pct: l.desconto_pct, iva_pct: l.iva_pct, incerta: !!l.incerta,
    produto_id: (l.ean && mapE.get(l.ean)) || mapA.get(l.descricao.toLowerCase()) || null,
  }));
  const { data: ins } = await sb.from('linhas_fatura').insert(rows).select('id,ean,descricao,quantidade,custo_unit,produto_id,incerta');

  return json({ fatura_id: fat.id, metodo, tokens, cabecalho: cab, linhas: ins, validada_qr: bate(linhas, qr) });
});
