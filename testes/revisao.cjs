// Revisão da fatura: os números aparecem como estão na folha (qtd, preço da caixa, desconto, total da linha), o custo por unidade
// só arredondado ao cêntimo, e a soma das linhas compara-se com o total da fatura. Uso: node testes/revisao.cjs [captura.png]
const { chromium } = require('playwright');
const path = require('path');
const E = (qtd, tipo, un, preco) => ({ emb: { qtd, tipo, un, preco } });
// linhas tal como vieram da fatura Cash & Carry carregada a 29/10 (a do Fairy já com o desconto bem lido)
const LS = [
  ['CERVEJA SUPER BOCK MINI 25CL', 96, 0.6, 6.9, 23, E(4, 'CX', 24, 14.4)], ['AGUA MINERAL LUSO 1,5L', 60, 0.39, 0, 6, E(10, 'FD', 6, 2.34)],
  ['OLEO ALIMENTAR FULA 1L', 24, 1.89, 4, 23, E(2, 'CX', 12, 22.68)], ['ARROZ CAROLINO CIGALA 1KG', 52, 0.9423, 0, 6, { ...E(5, 'FD', 10, 9.8), oferta: 2 }],
  ['VINHO TINTO MONTE VELHO 75CL', 12, 3.65, 0, 13, E(2, 'CX', 6, 21.9)], ['SUMO COMPAL LARANJA 1L', 36, 1.09, 3, 23, E(3, 'CX', 12, 13.08)],
  ['DETERG. LOICA FAIRY 1L', 12, 1.95, 10, 23, E(1, 'CX', 12, 23.4)], ['PAPEL HIG. RENOVA 12 ROLOS', 12, 3.9, 0, 23, E(3, 'FD', null, 15.6)],
].map(([descricao, quantidade, preco_unit, desconto_pct, iva_pct, detalhe], i) => ({ id: 'x' + i, descricao, quantidade, preco_unit, desconto_pct, iva_pct, detalhe,
  custo_unit: preco_unit * (1 - desconto_pct / 100), incerta: !detalhe.emb.un }));
const base = LS.reduce((s, l) => s + l.detalhe.emb.qtd * l.detalhe.emb.preco * (1 - l.desconto_pct / 100), 0), iva = LS.reduce((s, l) => s + l.detalhe.emb.qtd * l.detalhe.emb.preco * (1 - l.desconto_pct / 100) * l.iva_pct / 100, 0);
const TOTAL = Math.round((base + iva) * 100) / 100;
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 390, height: 2400 }, deviceScaleFactor: 2 });
  const erros = []; pg.on('pageerror', e => erros.push(e.message));
  await pg.route(/^https?:\/\/.*/, r => r.abort());
  await pg.goto('file://' + path.resolve(__dirname, '../index.html') + '?admin'); await pg.waitForTimeout(400);
  await pg.evaluate(([LS, TOTAL]) => { const k = 'admark-demo-v5', o = JSON.parse(localStorage.getItem(k)); o.view = 'owner'; o.tab = 'invoices';
    o.pending = { stage: 'real-review', real: true, kind: 'FOTO', name: 'fatura.jpg', res: { local: true, metodo: 'ocr', cabecalho: { numero: 'FT 2026/881', total: TOTAL }, linhas: LS, validada_qr: true } };
    localStorage.setItem(k, JSON.stringify(o)); }, [LS, TOTAL]);
  await pg.reload(); await pg.waitForTimeout(800);
  const prob = [], txt = () => pg.evaluate(() => document.body.innerText.replace(/\u00a0/g, ' '));
  let t = await txt();
  if (/\d,\d{3,} ?€/.test(t)) prob.push('aparecem preços com mais de 2 casas decimais: ' + t.match(/\d+,\d{3,} ?€/g));
  for (const v of ['53,63 €', '23,40 €', '0,56 €', '14.40']) if (!t.includes(v) && !(await pg.evaluate(v => [...document.querySelectorAll('input')].some(i => i.value === v), v))) prob.push('não aparece ' + v);
  if (!/bate certo/.test(t)) prob.push('a soma das linhas devia bater com o total: ' + (t.match(/Soma das linhas[^\n]*/) || [''])[0]);
  // o dono corrige o preço da cerveja como está na folha (14,40 → 15,40): total da linha e soma mudam logo
  await pg.fill('#rl-pr-0', '15.40'); await pg.waitForTimeout(150); t = await txt();
  if (!t.includes('57,35 €')) prob.push('total da linha não atualizou para 57,35 €');
  if (!/sobram/.test(t)) prob.push('a soma devia mostrar que agora sobra dinheiro face ao total');
  if (!/0,60 € cada/.test(t)) prob.push('custo por garrafa devia passar a 0,60 €');
  await pg.fill('#rl-pr-0', '14.40');
  // papel sem unidades por fardo → ao preencher 4 fica 12 rolos a 3,90 €
  await pg.fill('[data-rl-un="7"]', '4'); await pg.waitForTimeout(150); t = await txt();
  if (!/12 un a 3,90 € cada/.test(t)) prob.push('papel: devia ficar 12 un a 3,90 € cada');
  if (process.argv[2]) await pg.screenshot({ path: process.argv[2], fullPage: true });
  if (erros.length) prob.push('erros JS: ' + erros.join(' | '));
  await b.close();
  for (const p of prob) console.log('  ✗ ' + p);
  console.log(prob.length ? `FALHOU: ${prob.length} problemas` : 'OK: revisão da fatura com os números da folha');
  process.exit(prob.length ? 1 : 0);
})();
