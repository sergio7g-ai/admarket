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
function partir(linha) {
  const t = linha.replace(/[€|\[\]]/g, ' ').replace(/(\d) ,(\d)/g, '$1,$2').trim().split(/\s+/)
    .map(x => /^[\dOolI.,%]+$/.test(x) && /[\d]|^[Oo]$/.test(x) ? x.replace(/[Oo]/g, '0').replace(/[lI]/g, '1') : x); // erros típicos de OCR
  const nums = [];
  while (t.length && (NUM.test(t[t.length - 1].replace('%', '')) || /^(un|uni|kg|cx|lt|l|emb)$/i.test(t[t.length - 1]))) {
    const v = t.pop();
    if (!/^[a-z]+$/i.test(v)) nums.unshift(v);
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
      const q = v[iq], p = v[ip], tot = v[it];
      if (!(q > 0 && p > 0)) continue;
      for (let id = 0; id < it; id++) {
        if (id === iq || id === ip) continue;
        const d = v[id];
        if (d >= 0 && d < 100 && !IVAS.includes(d) && perto(q * p * (1 - d / 100), tot)) return pos(iq, ip, id, it, v);
      }
      if (perto(q * p, tot)) return pos(iq, ip, -1, it, v);
    }
  }
  return null;
}
function pos(iq, ip, id, it, v) {
  const ii = v.findIndex((x, k) => ![iq, ip, id, it].includes(k) && IVAS.includes(x));
  return { iq, ip, id, ii, it, n: v.length };
}

function linhaCom(m, p) {
  const v = p.nums.map(num);
  if (v.length !== m.n) return null;
  const q = v[m.iq], pr = v[m.ip], d = m.id >= 0 ? v[m.id] : 0, tot = v[m.it];
  if (!(q > 0 && pr > 0) || !perto(q * pr * (1 - d / 100), tot)) return null;
  return { ean: p.ean, descricao: p.desc, quantidade: q, preco_unit: pr, desconto_pct: d,
           iva_pct: m.ii >= 0 ? v[m.ii] : null, total: tot };
}

// texto -> { linhas, modelo, metodo, confianca }
export function lerLinhas(texto, modelo) {
  const partes = texto.split(/\r?\n/).map(partir).filter(p => p.desc.length > 2 && p.nums.length >= 3);
  let usado = modelo, metodo = 'modelo';
  if (!usado) {
    const votos = {};
    for (const p of partes) { const g = adivinhar(p.nums); if (g) { const k = JSON.stringify(g); votos[k] = (votos[k] || 0) + 1; } }
    const top = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    if (!top) return { linhas: [], modelo: null, metodo: 'regras', confianca: 0 };
    usado = JSON.parse(top[0]); metodo = 'regras';
  }
  const linhas = partes.map(p => linhaCom(usado, p)).filter(Boolean);
  return { linhas, modelo: usado, metodo, confianca: partes.length ? linhas.length / partes.length : 0 };
}

// valida com o QR: soma das linhas sem IVA + IVA ≈ total
export function bate(linhas, qr) {
  if (!qr || !qr.total) return null;
  const base = linhas.reduce((s, l) => s + l.total, 0);
  const iva = qr.totalIva ?? linhas.reduce((s, l) => s + l.total * (l.iva_pct || 0) / 100, 0);
  return perto(base + iva, qr.total) || perto(base, qr.total);
}
