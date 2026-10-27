// Leitura dos folhetos das grandes cadeias (iPaper). Só regras, sem IA: 0 tokens.
// Continente: o texto de cada página traz o preço da promoção ("PVPR 2,99 € 2 24 , € UNID. NOME EMB :250 G").
// Pingo Doce: os "enrichments" do iPaper já trazem nome + preço da promoção, estruturados.

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MES_RX = MESES.join('|');

export function lerJSONArray(src, chave) {
  const i = src.indexOf(`"${chave}":[`);
  if (i < 0) return null;
  let k = i + chave.length + 4, d = 0, s = false, e = false;
  for (let j = k - 1; j < src.length; j++) {
    const c = src[j];
    if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') s = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) return JSON.parse(src.slice(k - 1, j + 1)); }
  }
  return null;
}

export function enrichmentUrls(src) {
  const set = new Set();
  for (const m of src.matchAll(/"(https:\/\/cdn\.ipaper\.io\/iPaper\/Papers\/[^"]+Enrichments[^"]+\.json[^"]*)"/g)) set.add(m[1].replace(/\\u0026/g, '&'));
  return [...set];
}

function dataPT(d, mes, ano) {
  const m = MESES.indexOf(String(mes).toLowerCase());
  if (m < 0) return null;
  return `${ano}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "de 27 de outubro a 2 de novembro de 2026"; prefere a frase "preços são válidos"
export function lerDatas(textos, anoDef) {
  const rx = new RegExp(`(\\d{1,2})(?: de (${MES_RX}))? (?:a|até) (\\d{1,2}) de (${MES_RX})(?: de (\\d{4}))?`, 'gi');
  let melhor = null;
  for (const t of textos) {
    for (const m of t.matchAll(rx)) {
      const antes = t.slice(Math.max(0, m.index - 120), m.index);
      const ano = +(m[5] || anoDef), mf = m[4], mi = m[2] || mf;
      let ini = dataPT(m[1], mi, ano), fim = dataPT(m[3], mf, ano);
      if (ini && fim && ini > fim) ini = dataPT(m[1], mi, ano - 1);
      const cand = { inicio: ini, fim, peso: /v[aá]lid/i.test(antes) ? 2 : 1 };
      if (!melhor || cand.peso > melhor.peso) melhor = cand;
    }
  }
  return melhor;
}

// semana ISO (para quando o folheto não diz as datas)
export function datasSemana(ano, sem) {
  const j4 = new Date(Date.UTC(ano, 0, 4)), dia = (j4.getUTCDay() + 6) % 7;
  const seg = new Date(j4); seg.setUTCDate(j4.getUTCDate() - dia + (sem - 1) * 7);
  const dom = new Date(seg); dom.setUTCDate(seg.getUTCDate() + 6);
  return { inicio: seg.toISOString().slice(0, 10), fim: dom.toISOString().slice(0, 10) };
}

const STOP = new Set(['APENAS','DESDE','MAIS','ATÉ','POUPE','LEVE','PVPR','BALCÃO','DISPONÍVEL','NO','NA','NOS','NAS','NUMA','GARRAFA:']);
const TAM = '([0-9][0-9X,\\. ]*\\s?(?:KG|G|ML|CL|L|UNID|CÁPSULAS|ROLOS|DOSES|SAQUETAS)\\b)';

function limpaNome(nome) {
  let tamanho = null;
  const m = nome.match(new RegExp('EMB\\.?\\s?:\\s?' + TAM));
  if (m) { tamanho = m[1].trim(); nome = nome.slice(0, m.index); }
  const out = [];
  for (const w of nome.split(/\s+/).filter(Boolean)) {
    if (/[a-zà-ú]/.test(w) && w !== 'C/' && w !== 'S/') break;
    if (/^[\d,.%]+$/.test(w)) break;
    if (STOP.has(w) && out.length) break;
    out.push(w);
  }
  return { nome: out.join(' ').replace(/^[\s\-/]+|[\s\-/,]+$/g, ''), tamanho };
}

const PRECO = String.raw`(?:(\d{1,3}) (\d{2}) (?:(\d{1,3},\d{2}) € )?(?:, €|€ ,)|(\d{2}) € (\d{1,3}) ,)`;
const RX_CNT = new RegExp(String.raw`(?:(?:PVPR )?(\d{1,3},\d{2}) ?€ )?(?:Desde )?` + PRECO + String.raw` (UNID\.|KG|EMB\.)\s+(.+?)(?=\s+EMB ?:|\s\d+,\d{2} ?€\/|\s(?:PVPR )?\d{1,3},\d{2} ?€ |\s\d{1,3} \d{2} (?:\d{1,3},\d{2} € )?(?:, €|€ ,)|\s\d{2} € \d{1,3} ,|\s\d+ ?% |$)`, 'g');

export function promosContinente(textos) {
  const res = [];
  textos.forEach((s, pi) => {
    let last = 0;
    for (const m of s.matchAll(RX_CNT)) {
      let { nome, tamanho } = limpaNome(m[8]);
      if (!tamanho) {
        const e = s.slice(m.index + m[0].length).match(new RegExp('^\\s+EMB ?:\\s?' + TAM));
        if (e) tamanho = e[1].trim();
      }
      const ctx = s.slice(last, m.index); last = m.index + m[0].length;
      if (nome.length < 4) continue;
      const preco = m[2] ? +`${m[2]}.${m[3]}` : +`${m[6]}.${m[5]}`;
      const ant = m[1] || m[4], antes = ant ? +ant.replace(',', '.') : null;
      if (!(preco > 0) || (antes && antes <= preco)) continue;
      res.push({ pagina: pi + 1, nome, tamanho, preco, preco_antes: antes, unidade: m[7] === 'KG' ? 'kg' : 'un', cartao: /cart[ãa]o/i.test(ctx) });
    }
  });
  return dedupe(res);
}

export function promosEnrichment(listas) {
  const res = [];
  for (const l of listas) for (const x of (l.enrichments || [])) {
    if (x.type !== 13 || !x.name || !(x.price > 0)) continue;
    const t = x.name.match(/(\d+(?:[.,]\d+)?\s?(?:X\s?\d+\s?)?(?:KG|G|ML|CL|LT|L|UN|UNID)\b)\s*$/i);
    res.push({ pagina: (x.pageIndex ?? 0) + 1, nome: x.name.replace(/\s+/g, ' ').trim(), tamanho: t ? t[1] : null, preco: +x.price, preco_antes: null, unidade: 'un', cartao: false, ref: x.productId || null });
  }
  return dedupe(res);
}

function dedupe(a) {
  const m = new Map();
  for (const x of a) { const k = `${x.nome}|${x.tamanho || ''}|${x.preco}`; if (!m.has(k)) m.set(k, x); }
  return [...m.values()];
}

// descobrir os folhetos semanais em vigor (só continente: sem Madeira/Açores)
export function folhetosContinente(html) {
  const s = new Set();
  for (const m of html.matchAll(/https:\/\/folhetos\.continente\.pt\/\d{4}\/\d{2}\/semanal-\d+-[a-z0-9]+\//g)) {
    if (!/-(mad|cbd|acores|aco)-/.test(m[0])) s.add(m[0]);
  }
  return [...s];
}
export function folhetosPingoDoce(html) {
  return [...new Set([...html.matchAll(/https:\/\/folhetos\.pingodoce\.pt\/\d{4}\/poupe-esta-semana\/continental[^"'\s<>]*\/S\d+\//g)].map(m => m[0]))];
}
