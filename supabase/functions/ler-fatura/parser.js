// Leitor de faturas sem IA. Corre no browser e na edge function.
// 1) QR ATCUD (obrigatório em PT) -> NIF, número, data, total, IVA.
// 2) Linhas: regra numérica (qtd × preço × (1-desc) ≈ total da linha).
// 3) Modelo do fornecedor: posições das colunas aprendidas na 1.ª fatura.

export function lerQR(txt) {
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
export function num(s) {
  if (s == null) return null;
  s = String(s).trim().replace('%', '');
  if (/,\d+$/.test(s)) s = s.replace(/[.\s]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const perto = (a, b) => Math.abs(a - b) <= Math.max(0.02, b * 0.006);

// separa a linha em descrição + números finais
const EMB = /^(cx|cxa|cxs|fd|fdo|emb|pk|pack|tab|sc|grf)\.?$/i;      // caixa, fardo, embalagem, pack, tabuleiro, saco, grade
const UNI = /^(un|uni|und|unid|kg|kgs|lt|l|u|g|gr)\.?$/i;
const limpaNum = x => x.replace(/^[-–.:]+|[-–.:]+$/g, '').replace('%', '');
function partir(linha) {
  const t = linha.replace(/[€|\[\]]/g, ' ').replace(/(\d)(un|uni|cx|emb)\b/gi, '$1 $2').replace(/^(\d{11,13}) (\d{1,2}) /, '$1$2 ').replace(/(\d) ,(\d)/g, '$1,$2')
    .replace(/(\s\d{1,4}), (\d{2})(?=\s|$)/g, '$1,$2')                     // "15, 60" (OCR separou os cêntimos)
    .replace(/(\s\d{1,4}) (\d{2})\s*$/, '$1,$2').trim().split(/\s+/)
    .map(x => /^[OQDo]{1,2}$/.test(x) ? '0' : /^[DOQ]\d{2,}$/.test(x) ? '0' + x.slice(1)
      : /^[\dOolI.,%]+$/.test(x) && /\d/.test(x) ? x.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') : x); // erros típicos de OCR
  if (t.length) { const d = t[0].replace(/\D/g, ''); if (d.length >= 8 && d.length / t[0].length > 0.75) t[0] = d; }
  // números do fim da linha; ignora unidades (UN, KG, CX…) e lixo curto do OCR entre números (ex.: "un" lido como "มก")
  const nums = []; let lixo = 0, emb = null;
  while (t.length) {
    const x = t[t.length - 1], limpo = limpaNum(x);
    if (NUM.test(limpo)) { t.pop(); nums.unshift(limpo); lixo = 0; continue; }
    const unidade = UNI.test(x) || EMB.test(x);
    // lixo só se estiver entre números (uma letra no fim da descrição, como "Cat. A", fica na descrição)
    const curto = !/[a-zà-ú]{3,}/i.test(x) && !/\d/.test(x) && x.length <= 4 && t.length >= 2 && NUM.test(limpaNum(t[t.length - 2]));
    if ((unidade || curto) && lixo < 2 && nums.length) { if (EMB.test(x)) emb = x.replace('.', '').toUpperCase(); t.pop(); lixo++; continue; }
    break;
  }
  let ean = null, ref = null;
  if (t.length && /^\d{8,14}$/.test(t[0])) ean = t.shift();
  else { const k = t.findIndex(x => /^\d{8,14}$/.test(x)); if (k >= 0 && k < 2) { if (k === 1) ref = t[0]; ean = t[k]; t.splice(0, k + 1); } }
  // código interno do fornecedor no início ("LB-10021", "102233"): sai da descrição, mas fica guardado
  if (!ref && t.length > 2 && (/^[A-Z]{1,4}[-./]?\d{3,8}$/i.test(t[0]) && /\d/.test(t[0]) && !/^\d+[a-z]+$/i.test(t[0]) || /^\d{4,7}$/.test(t[0]))) ref = t.shift();
  return { ean, ref, desc: t.join(' '), nums, emb };
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

// Resolve uma linha sem inventar: procura qtd × preço × (1 − d1)(1 − d2) = total da linha, em que os descontos são 0 ou números
// que estão mesmo na linha (nunca uma taxa de IVA). O total é o último número, ou o penúltimo quando a linha acaba na taxa de IVA.
// Prefere qtd inteira e preço com cêntimos. Se o OCR perdeu a quantidade, calcula-a (total ÷ preço) quando dá um número inteiro.
// Vendas à caixa/fardo: o número inteiro entre a quantidade e o preço é o n.º de unidades por embalagem → custo por unidade.
function resolver(p, ctx = {}) {
  const v = p.nums.map(num);
  const n = v.length; if (n < 2) return null;
  const mq = p.desc.match(/\s(\d{1,3})$/);
  const qExtra = mq && !/\d\s*(g|kg|l|ml|cl)$/i.test(p.desc.slice(0, -mq[0].length)) ? +mq[1] : null;
  const fimIva = n >= 3 && Number.isInteger(v[n - 1]) && IVAS.includes(v[n - 1]);
  if (v[n - 1] === 0 || (fimIva && v[n - 2] === 0)) return null;     // oferta (total 0,00): junta-se depois à linha paga
  const opcoes = [{ it: n - 1, iiva: -1 }];
  if (fimIva) opcoes.push({ it: n - 2, iiva: n - 1 });
  let melhor = null;
  const guarda = c => { if (!melhor || c.sc > melhor.sc) melhor = c; };
  const descontos = idx => {      // 0, um desconto ou dois em cascata, com os números que sobram
    const ds = [{ f: 1, ids: [], explicito: idx.some(i => v[i] === 0) }];
    const cand = idx.filter(i => v[i] > 0 && v[i] < 100 && !(Number.isInteger(v[i]) && IVAS.includes(v[i])));
    for (const i of cand) ds.push({ f: 1 - v[i] / 100, ids: [i], explicito: true });
    for (const i of cand) for (const j of cand) if (j > i) ds.push({ f: (1 - v[i] / 100) * (1 - v[j] / 100), ids: [i, j], explicito: true });
    return ds;
  };
  for (const { it, iiva } of opcoes) {
    const tot = v[it]; if (!(tot > 0)) continue;
    const antes = v.map((x, i) => i).filter(i => i < it && i !== iiva);
    const qs = antes.filter(i => v[i] > 0).map(i => ({ x: v[i], i }));
    if (qExtra) qs.push({ x: qExtra, i: -1 });
    for (const Q of qs) for (const ip of antes) {
      if (ip === Q.i) continue;
      const brutos = [v[ip]]; if (Number.isInteger(v[ip]) && v[ip] >= 10) brutos.push(v[ip] / 100);   // vírgula perdida
      for (const pr of brutos) {
        if (!(pr > 0)) continue;
        const resto = antes.filter(i => i !== Q.i && i !== ip);
        for (const D of descontos(resto)) {
          if (D.ids.length === 2 && !(D.ids[0] > ip)) continue;      // descontos em cascata vêm depois do preço
          if (!perto(Q.x * pr * D.f, tot)) continue;
          let sc = 0;
          if (Number.isInteger(Q.x)) sc += 3;
          if (!Number.isInteger(pr)) sc += 2;
          if (pr !== v[ip]) sc -= 1;
          if (Q.i >= 0 && Q.i < ip) sc += 1;
          if (Q.i === -1) sc -= 1;
          if (D.explicito) sc += 1;
          if (iiva >= 0 || resto.some(i => IVAS.includes(v[i]))) sc += 1;   // sobra uma taxa de IVA: colunas coerentes
          guarda({ sc, q: Q.x, iq: Q.i, ip, pr, f: D.f, ids: D.ids, it, iiva, qExtra: Q.i === -1 });
        }
      }
    }
  }
  // o OCR perdeu a quantidade (números de um só algarismo desaparecem): qtd = total ÷ (preço × descontos), se der inteiro
  if (!melhor) for (const { it, iiva } of opcoes) {
    const tot = v[it]; if (!(tot > 0)) continue;
    const antes = v.map((x, i) => i).filter(i => i < it && i !== iiva);
    for (const ip of antes) {
      const pr = v[ip]; if (!(pr > 0) || Number.isInteger(pr)) continue;
      for (const D of descontos(antes.filter(i => i !== ip))) {
        if (D.ids.some(i => i < ip)) continue;
        const q = Math.round(tot / (pr * D.f));
        if (q < 1 || q > 999 || !perto(q * pr * D.f, tot)) continue;
        guarda({ sc: (iiva >= 0 ? 1 : 0) + (D.ids.length ? 1 : 0) - (q === 1 ? 0.5 : 0), q, iq: -2, ip, pr, f: D.f, ids: D.ids, it, iiva, calculado: true });
      }
    }
  }
  if (!melhor && p.ean) {             // só em linhas de produto (com código de barras)
    // o OCR trocou um algarismo do preço (0,95 → 0,90): se total ÷ qtd dá cêntimos certos, é esse o custo (é o que interessa)
    const tot = v[n - 1];
    for (let i = 0; i < n - 1; i++) {
      const q = v[i];
      if (!Number.isInteger(q) || q < 1 || q > 999 || IVAS.includes(q) && i > 0) continue;
      const pr = tot / q;
      if (pr > 0 && Math.abs(pr * 100 - Math.round(pr * 100)) < 1e-6) { melhor = { q, iq: i, ip: -1, pr: Math.round(pr * 100) / 100, f: 1, ids: [], it: n - 1, iiva: -1, calculado: true }; break; }
    }
  }
  if (!melhor) return null;
  // unidades por embalagem: inteiro que sobra entre a quantidade e o preço, em linhas vendidas à caixa/fardo (ou com coluna Un/Emb)
  let un = 1, faltaUn = false;
  const usados = new Set([melhor.iq, melhor.ip, melhor.it, melhor.iiva, ...melhor.ids]);
  if (p.emb || ctx.unEmb) {
    const cand = v.map((x, i) => i).filter(i => !usados.has(i) && i < melhor.ip && Number.isInteger(v[i]) && v[i] >= 2 && v[i] <= 500);
    if (cand.length) un = v[cand[cand.length - 1]];
    else if (p.emb) faltaUn = true;     // à caixa, mas o n.º de unidades não foi lido: o dono confirma
  }
  const tot = v[melhor.it], d = Math.round((1 - melhor.f) * 1e6) / 1e4;
  const iva = melhor.iiva >= 0 ? v[melhor.iiva] : v.slice(0, melhor.it).find((x, i) => !usados.has(i) && IVAS.includes(x)) ?? null;
  const l = { ean: p.ean, ref: p.ref || null, descricao: melhor.qExtra ? p.desc.slice(0, -mq[0].length).trim() : p.desc,
    quantidade: melhor.q * un, preco_unit: Math.round(melhor.pr / un * 10000) / 10000, desconto_pct: d, iva_pct: iva, total: tot };
  if (un > 1 || p.emb) l.emb = { tipo: p.emb || 'EMB', qtd: melhor.q, un: faltaUn ? null : un, preco: melhor.pr };
  if (melhor.calculado) l.calculado = true;
  if (faltaUn) l.incerta = true;
  return fixarDesconto(l);
}
// a base de dados guarda o desconto com 2 casas: se o desconto combinado não cabe, entra no preço (o custo fica exato)
function fixarDesconto(l) {
  if (Math.abs(l.desconto_pct * 100 - Math.round(l.desconto_pct * 100)) > 1e-6) {
    l.preco_unit = Math.round(l.preco_unit * (1 - l.desconto_pct / 100) * 10000) / 10000; l.desconto_pct = 0;
  }
  return l;
}
const RESUMO = /^(iva|taxa|total|sub-?total|incid[eê]ncia|base|desconto|desc\.|portes|transporte|ecovalor|valor|resumo|n\.?º)\b/i;
// desconto no fim da fatura (financeiro, comercial, pronto pagamento, global) em percentagem
function descontoGlobal(texto) {
  const m = texto.match(/desc(?:onto|\.)?\s*(?:financeiro|comercial|global|de pronto pagamento|pronto pagamento|p\.\s*pagamento)\s*(?:de\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
  const d = m ? num(m[1]) : 0;
  return d > 0 && d < 30 ? d : 0;
}

// texto -> { linhas, modelo, metodo, confianca }
export function lerLinhas(texto, modelo, qr = null) {
  const ctx = { unEmb: /\bun(?:id)?\.?\s*\/\s*(?:emb|cx)\b|\buni\/emb\b|\bun\.?\s*emb\b/i.test(texto) };
  const todas = texto.split(/\r?\n/).map(partir).filter(p => !RESUMO.test(p.desc));
  const partes = todas.filter(p => p.desc.length > 2 && (p.nums.length >= 3 || (p.ean && p.nums.length >= 2)));
  let usado = modelo, metodo = 'modelo';
  if (!usado) {
    const votos = {};
    for (const p of partes) { const g = adivinhar(p.nums); if (g) { const k = JSON.stringify(g); votos[k] = (votos[k] || 0) + 1; } }
    const top = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    usado = top ? JSON.parse(top[0]) : null; metodo = 'regras';
  }
  // cada linha usa o padrão da maioria; se falhar (o OCR perdeu ou juntou colunas), tenta o seu próprio padrão
  // 1.º resolve cada linha por si (total = último número, sem descontos inventados); 2.º o padrão do fornecedor/maioria, só se for coerente
  const res = partes.map(p => resolver(p, ctx) || (usado && linhaCom(usado, p, false)) || null);
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
  // ofertas (linha a 0,00 do mesmo produto): as unidades oferecidas baixam o custo médio da linha paga
  for (const p of partes) {
    const v = p.nums.map(num);
    if (!p.ean || v[v.length - 1] !== 0 && !(v.length >= 2 && v[v.length - 2] === 0 && IVAS.includes(v[v.length - 1]))) continue;
    const l = linhas.find(x => x.ean === p.ean && x.total > 0); if (!l) continue;
    const q = v.find(x => Number.isInteger(x) && x > 0 && !IVAS.includes(x)) ?? v.find(x => Number.isInteger(x) && x > 0);
    if (!q) continue;
    const u = v.find((x, i) => i > v.indexOf(q) && Number.isInteger(x) && x >= 1 && x <= 500 && v[i + 1] === 0) ?? 1;
    const novo = l.quantidade + q * u;
    l.preco_unit = Math.round(l.preco_unit * l.quantidade / novo * 10000) / 10000; l.oferta = (l.oferta || 0) + q * u; l.quantidade = novo;
  }
  // desconto no fim da fatura: reparte-se por todas as linhas (confirmado pelo QR quando existe)
  const dg = descontoGlobal(texto);
  if (dg && linhas.length) {
    const com = linhas.map(l => fixarDesconto({ ...l, desconto_pct: Math.round((1 - (1 - l.desconto_pct / 100) * (1 - dg / 100)) * 1e6) / 1e4, total: Math.round(l.total * (1 - dg / 100) * 100) / 100, desconto_global: dg }));
    if (!qr || bate(com, qr) === true || bate(linhas, qr) !== true) linhas.splice(0, linhas.length, ...com);
  }
  // produtos com código de barras que não bateram: entram como "a confirmar" com a melhor estimativa
  const vistos = new Set(linhas.map(l => l.ean).filter(Boolean));
  for (const p of todas) {
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
export function bate(linhas, qr) {
  if (!qr || !qr.total) return null;
  const base = linhas.reduce((s, l) => s + l.total, 0);
  const iva = qr.totalIva ?? linhas.reduce((s, l) => s + l.total * (l.iva_pct || 0) / 100, 0);
  return perto(base + iva, qr.total) || perto(base, qr.total);
}

// junta palavras soltas (com caixas x0,y0,x1,y1) em linhas seguindo a inclinação local: aguenta fotos tortas
export function juntarPalavras(words) {
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
