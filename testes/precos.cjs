// Verifica preços com IVA e embalagens: o preço de venda é sempre com IVA (como nas grandes cadeias),
// a margem conta-se sem IVA, e um pack compara-se com o custo do pack inteiro (não com uma unidade).
// Uso: node testes/precos.cjs   (sai com código 1 se falhar)
const { chromium } = require('playwright');
const path = require('path');
const STUB = `window.supabase={createClient(){const q=t=>{const o={};['select','order','limit','eq','in','insert','update','delete','lt','is','gte','gt','or'].forEach(m=>o[m]=()=>o);o.single=o.maybeSingle=()=>o;o.then=ok=>ok({data:t==='lojas'?[{id:'L1',nome:'Loja'}]:[],error:null});return o};
 return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signInAnonymously:async()=>({data:{session:{user:{id:'u1'}}}})},from:q,rpc:async()=>({data:[],error:null}),storage:{from:()=>({upload:async()=>({})})},functions:{invoke:async()=>({data:null,error:null})}}}};`;
// casos tirados das faturas reais carregadas na app (29/10)
const P = [
  // fatura: garrafa de 25 cl (caixas de 24); produto confirmado: emb. 30 x 25 cl (guardado como «7,5 L»)
  { id: 't-cerveja', name: 'Cerveja Super Bock Mini', size: '7,5 L', qty: '7,5 L', desc: 'CERVEJA SUPER BOCK MINI 25CL', brand: 'Super Bock', prod: 'Cerveja Mini', cat: 'Bebidas', cost: 0.5586, iva: 23, comp: { continente: 14.95 } },
  // fatura: o próprio pack de 4 é a unidade → vende-se 1
  { id: 't-iog', name: 'Iogurte Grego Natural Oikos', size: '440 g', qty: '440 g', desc: 'Iogurte Grego Natural Oikos 4x110g', brand: 'Oikos Danone', prod: 'Iogurte Grego', cat: 'Frescos', cost: 1.6856, iva: 6, comp: { pingo: 2.59 } },
  { id: 't-arroz', name: 'Arroz Carolino Cigala', size: '1 kg', qty: '1 kg', desc: 'ARROZ CAROLINO CIGALA 1KG', brand: 'Cigala', prod: 'Arroz Carolino', cat: 'Mercearia', cost: 0.9423, iva: 6, comp: { pingo: 1.69 } },
  // a peso: custo ao kg, produto de 220 g
  { id: 't-fiambre', name: 'Fiambre da Perna Extra Nobre', size: '220 g', qty: '220 g', desc: 'Fiambre da Perna Extra Nobre (peso variável)', brand: 'Nobre', prod: 'Fiambre', cat: 'Frescos', cost: 7.791, iva: 6, comp: { continente: 2.99 } },
  // fatura de 12 rolos, produto confirmado de 9 → tamanho diferente, a confirmar
  { id: 't-papel', name: 'Papel Higiénico Renova', size: '9 un', qty: '9 un', desc: 'PAPEL HIG. RENOVA 12 ROLOS', brand: 'Renova', prod: 'Papel Higiénico', cat: 'Higiene', cost: 3.9, iva: 23, comp: { continente: 4.99 } },
  // sem descrição da fatura e margem absurda → a confirmar
  { id: 't-sumo', name: 'Sumo Compal Pêssego', size: 'pack 6 garrafas', qty: 'pack 6 garrafas', brand: 'Compal', prod: 'Sumo', cat: 'Bebidas', cost: 0.45, comp: { continente: 7.49 } },
];
// [nome, unidades da fatura por embalagem vendida, custo da embalagem s/ IVA, preço da concorrência para a mesma quantidade, tamanho mostrado]
const ESP = [['Cerveja Super Bock Mini', 30, 16.758, 14.95, '30 × 25 cl'], ['Iogurte Grego Natural Oikos', 1, 1.6856, 2.59, '440 g'],
  ['Arroz Carolino Cigala', 1, 0.9423, 1.69, '1 kg'], ['Fiambre da Perna Extra Nobre', 0.22, 1.714, 2.99, '220 g']];
const n = t => parseFloat(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1280, height: 1600 } });
  const erros = []; pg.on('pageerror', e => erros.push(e.message));
  await pg.route(/supabase-js/, r => r.fulfill({ body: STUB, contentType: 'application/javascript' }));
  await pg.route(/^https?:\/\/(?!.*supabase-js).*/, r => r.abort());
  await pg.goto('file://' + path.resolve(__dirname, '../index.html') + '?admin'); await pg.waitForTimeout(400);
  const por = async (tab, manter) => { await pg.evaluate(([L, tab, manter]) => { for (const k of Object.keys(localStorage)) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.v === 6) {
    o.teste = false; o.view = 'owner'; o.tab = tab; o.store.plan = 'Crescer'; if (!manter) { o.products = L; o.promos = {}; } o.promoTab = 'pending'; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} } }, [P, tab, !!manter]);
    await pg.reload(); await pg.waitForTimeout(900); };
  const prob = [];
  await pg.evaluate(() => document.querySelector('[data-act="reset"]')?.click()); await pg.waitForTimeout(300);
  await por('compare');
  if (process.env.DBG) console.log((await pg.evaluate(() => document.body.innerText)).slice(0, 600));
  const rows = await pg.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim())));
  if (process.env.DBG) console.log(JSON.stringify(rows), erros);
  const linha = nm => rows.find(r => r[0].includes(nm));
  for (const [nm, un, custo, conc, tam] of ESP) {
    const r = linha(nm), p = P.find(x => x.name === nm), iva = p.iva / 100; if (!r) { prob.push(nm + ': não aparece nos preços'); continue; }
    const m = n(r[5].split(' ').slice(2).join(' ')) / 100;
    if (!r[0].includes(tam)) prob.push(`${nm}: tamanho «${r[0]}» devia mostrar ${tam}`);
    if (Math.abs(n(r[1].split('€')[0]) - custo) > 0.011) prob.push(`${nm}: custo ${r[1]} em vez de ${custo.toFixed(2)} (${un} × ${p.cost})`);
    const cc = r.slice(2, 5).map(x => n(x.split('€')[0])).filter(x => x > 0);
    if (Math.abs(Math.min(...cc) - conc) > 0.011) prob.push(`${nm}: concorrência ${cc} em vez de ${conc}`);
    const min = custo / (1 - m) * (1 + iva);
    if (Math.abs(n(r[5].split('€')[0]) - min) > 0.011) prob.push(`${nm}: mínimo ${r[5]} em vez de ${min.toFixed(2)} com IVA`);
    const pr = n(r[6].split('€')[0]), liq = pr / (1 + iva), marg = (liq - custo) / liq;
    if (pr < min - 0.001) prob.push(`${nm}: sugestão ${pr} abaixo do mínimo com IVA ${min.toFixed(2)}`);
    if (marg > 0.6) prob.push(`${nm}: margem ${Math.round(marg * 100)}% (absurda)`);
    console.log(`  ${nm}: ${un} un → custo ${custo.toFixed(2)} s/ IVA · concorrência ${conc} → ${pr.toFixed(2)} c/ IVA · margem ${(marg * 100).toFixed(1)}%`);
  }
  const papel = linha('Papel Higiénico'); if (!papel || !/confirme a embalagem/.test(papel[6])) prob.push('Papel: tamanho diferente da fatura, devia pedir para confirmar');
  const sumo = linha('Sumo Compal'); if (!sumo || !/confirme a embalagem/.test(sumo[6])) prob.push('Sumo: devia pedir para confirmar a embalagem');
  await por('promos');
  const txt = await pg.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText);
  if (process.env.DBG) console.log(txt.slice(0,1500));
  if (!/Confirme a embalagem/.test(txt)) prob.push('Promoções: falta o cartão «Confirme a embalagem»');
  const filas = await pg.evaluate(() => [...document.querySelectorAll('.prow2 h3')].map(h => h.textContent));
  if (filas.filter(t => /Papel/.test(t)).length !== 1) prob.push('Papel: devia aparecer só no cartão de confirmação');
  if (filas.filter(t => /Sumo/.test(t)).length !== 1) prob.push('Sumo: devia aparecer só no cartão de confirmação, não nas promoções');
  if (!/c\/ IVA/.test(txt)) prob.push('Promoções: o preço não diz «c/ IVA»');
  // depois de o dono dizer que vende o pack de 6, a margem fica normal e entra nas promoções
  await pg.fill('[data-venda="t-sumo"]', '6'); await pg.dispatchEvent('[data-venda="t-sumo"]', 'change'); await pg.waitForTimeout(300);
  const t2 = await pg.evaluate(() => document.body.innerText);
  await por('compare', true);
  await pg.evaluate(() => { const d = document.querySelector('[data-venda="t-cerveja"]'); d.closest('details').open = true; });
  await pg.fill('[data-venda="t-cerveja"]', '24'); await pg.dispatchEvent('[data-venda="t-cerveja"]', 'change'); await pg.waitForTimeout(300);
  await por('compare', true);
  const cv = (await pg.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim())))).find(r => r[0].includes('Cerveja'));
  if (!cv || !cv[0].includes('24 × 25 cl') || Math.abs(n(cv[1].split('€')[0]) - 13.41) > 0.011 || Math.abs(n(cv[2].split('€')[0]) - 11.96) > 0.011) prob.push('Cerveja em caixa de 24: ' + JSON.stringify(cv));
  if (await pg.evaluate(() => !!document.querySelector('[data-act="emb-ok"][data-id="t-sumo"]'))) prob.push('Sumo: depois de confirmar a embalagem continua a pedir confirmação');
  if (erros.length) prob.push('erros JS: ' + erros.join(' | '));
  await b.close();
  for (const p of prob) console.log('  ✗ ' + p);
  console.log(prob.length ? `FALHOU: ${prob.length} problemas` : 'OK: preços com IVA e embalagens certos');
  process.exit(prob.length ? 1 : 0);
})();
