// Verifica preços com IVA e embalagens: o preço de venda é sempre com IVA (como nas grandes cadeias),
// a margem conta-se sem IVA, e um pack compara-se com o custo do pack inteiro (não com uma unidade).
// Uso: node testes/precos.cjs   (sai com código 1 se falhar)
const { chromium } = require('playwright');
const path = require('path');
const STUB = `window.supabase={createClient(){const q=t=>{const o={};['select','order','limit','eq','in','insert','update','delete','lt','is','gte','gt','or'].forEach(m=>o[m]=()=>o);o.single=o.maybeSingle=()=>o;o.then=ok=>ok({data:t==='lojas'?[{id:'L1',nome:'Loja'}]:[],error:null});return o};
 return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signInAnonymously:async()=>({data:{session:{user:{id:'u1'}}}})},from:q,rpc:async()=>({data:[],error:null}),storage:{from:()=>({upload:async()=>({})})},functions:{invoke:async()=>({data:null,error:null})}}}};`;
const P = [
  // custo por garrafa da fatura (4 caixas × 24), mas o produto confirmado é a embalagem de 30
  { id: 't-cerveja', name: 'Cerveja Super Bock Mini', size: 'emb. 30 x 25 cl', qty: 'emb. 30 x 25 cl', brand: 'Super Bock', prod: 'Cerveja Mini', cat: 'Bebidas', cost: 0.5586, comp: { continente: 13.99 } },
  { id: 't-arroz', name: 'Arroz Carolino Cigala', size: '1 kg', qty: '1 kg', brand: 'Cigala', prod: 'Arroz Carolino', cat: 'Mercearia', cost: 0.98, iva: 6, comp: { pingo: 1.69 } },
  // pack sem «N x» no tamanho: a margem dá absurda → tem de ficar a confirmar e fora das promoções
  { id: 't-sumo', name: 'Sumo Compal Pêssego', size: 'pack 6 garrafas', qty: 'pack 6 garrafas', brand: 'Compal', prod: 'Sumo', cat: 'Bebidas', cost: 0.45, comp: { continente: 7.49 } },
];
const n = t => parseFloat(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1280, height: 1600 } });
  const erros = []; pg.on('pageerror', e => erros.push(e.message));
  await pg.route(/supabase-js/, r => r.fulfill({ body: STUB, contentType: 'application/javascript' }));
  await pg.route(/^https?:\/\/(?!.*supabase-js).*/, r => r.abort());
  await pg.goto('file://' + path.resolve(__dirname, '../index.html') + '?admin'); await pg.waitForTimeout(400);
  const por = async (tab) => { await pg.evaluate(([L, tab]) => { for (const k of Object.keys(localStorage)) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.v === 6) {
    o.teste = false; o.view = 'owner'; o.tab = tab; o.store.plan = 'Crescer'; o.products = L; o.promos = {}; o.promoTab = 'pending'; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} } }, [P, tab]);
    await pg.reload(); await pg.waitForTimeout(900); };
  const prob = [];
  await pg.evaluate(() => document.querySelector('[data-act="reset"]')?.click()); await pg.waitForTimeout(300);
  await por('compare');
  if (process.env.DBG) console.log((await pg.evaluate(() => document.body.innerText)).slice(0, 600));
  const rows = await pg.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim())));
  if (process.env.DBG) console.log(JSON.stringify(rows), erros);
  const linha = nm => rows.find(r => r[0].includes(nm));
  const mg = { Bebidas: null, Mercearia: null };
  for (const [nm, cat, iva, un] of [['Cerveja Super Bock Mini', 'Bebidas', 0.23, 30], ['Arroz Carolino Cigala', 'Mercearia', 0.06, 1]]) {
    const r = linha(nm); if (!r) { prob.push(nm + ': não aparece nos preços'); continue; }
    const p = P.find(x => x.name === nm), custo = p.cost * un, m = n(r[5].split(' ').slice(2).join(' ')) / 100;
    if (Math.abs(n(r[1].split('€')[0]) - custo) > 0.011) prob.push(`${nm}: custo ${r[1]} em vez de ${custo.toFixed(2)} (${un} un)`);
    const min = custo / (1 - m) * (1 + iva);
    if (Math.abs(n(r[5].split('€')[0]) - min) > 0.011) prob.push(`${nm}: mínimo ${r[5]} em vez de ${min.toFixed(2)} com IVA`);
    const pr = n(r[6].split('€')[0]), liq = pr / (1 + iva), marg = (liq - custo) / liq;
    if (pr < min - 0.001) prob.push(`${nm}: sugestão ${pr} abaixo do mínimo com IVA ${min.toFixed(2)}`);
    if (marg > 0.6) prob.push(`${nm}: margem ${Math.round(marg * 100)}% (absurda)`);
    console.log(`  ${nm}: custo ${custo.toFixed(2)} s/ IVA → ${pr.toFixed(2)} c/ IVA · margem ${(marg * 100).toFixed(1)}%`);
  }
  const sumo = linha('Sumo Compal'); if (!sumo || !/confirme a embalagem/.test(sumo[6])) prob.push('Sumo: devia pedir para confirmar a embalagem');
  await por('promos');
  const txt = await pg.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText);
  if (process.env.DBG) console.log(txt.slice(0,1500));
  if (!/Confirme a embalagem/.test(txt)) prob.push('Promoções: falta o cartão «Confirme a embalagem»');
  const filas = await pg.evaluate(() => [...document.querySelectorAll('.prow2 h3')].map(h => h.textContent));
  if (filas.filter(t => /Sumo/.test(t)).length !== 1) prob.push('Sumo: devia aparecer só no cartão de confirmação, não nas promoções');
  if (!/c\/ IVA/.test(txt)) prob.push('Promoções: o preço não diz «c/ IVA»');
  // depois de o dono dizer que vende o pack de 6, a margem fica normal e entra nas promoções
  await pg.fill('[data-venda="t-sumo"]', '6'); await pg.dispatchEvent('[data-venda="t-sumo"]', 'change'); await pg.waitForTimeout(300);
  const t2 = await pg.evaluate(() => document.body.innerText);
  if (/Confirme a embalagem/.test(t2)) prob.push('Sumo: depois de confirmar a embalagem continua a pedir confirmação');
  if (erros.length) prob.push('erros JS: ' + erros.join(' | '));
  await b.close();
  for (const p of prob) console.log('  ✗ ' + p);
  console.log(prob.length ? `FALHOU: ${prob.length} problemas` : 'OK: preços com IVA e embalagens certos');
  process.exit(prob.length ? 1 : 0);
})();
