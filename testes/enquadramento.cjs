// Verifica o enquadramento de todas as publicações (posts, carrossel, reels) em computador e telemóvel.
// Uso: node testes/enquadramento.cjs [pasta-para-capturas]
// Falha (código 1) se alguma publicação tiver texto fora da imagem, sobreposto ou a transbordar.
const { chromium } = require('playwright');
const path = require('path');
const SAIDA = process.argv[2] || null;
const STUB = `window.supabase={createClient(){const q=t=>{const o={};['select','order','limit','eq','in','insert','update','delete','lt','is','gte','gt','or'].forEach(m=>o[m]=()=>o);o.single=o.maybeSingle=()=>o;o.then=ok=>ok({data:t==='lojas'?[{id:'L1',nome:'Loja'}]:[],error:null});return o};
 return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signInAnonymously:async()=>({data:{session:{user:{id:'u1'}}}})},from:q,rpc:async()=>({data:[],error:null}),storage:{from:()=>({upload:async()=>({})})},functions:{invoke:async()=>({data:null,error:null})}}}};`;
const LONGOS = [
  { id: 'l1', name: 'Detergente Máquina Roupa Líquido Concentrado Super Perfumado Skip', size: 'Pack Poupança · 2 × 3,2 L', brand: 'Skip', cat: 'Higiene', cost: 14.9, comp: { continente: 24.99 }, prod: 'Detergente', qty: '6,4 L' },
  { id: 'l2', name: 'Queijo Flamengo Fatiado Extra Cremoso Barra', size: '500 g', brand: 'Limiano', cat: 'Frescos', cost: 3.1, comp: { pingo: 5.49 }, prod: 'Queijo', qty: '500 g' },
  { id: 'l3', name: 'Água', size: '1,5 L', brand: 'Luso', cat: 'Bebidas', cost: 0.3, comp: { auchan: 0.59 }, prod: 'Água', qty: '1,5 L' },
  { id: 'l5', name: 'Azeite Virgem Extra Oliveira da Serra Selecção Gourmet', size: '750 ml', brand: 'Oliveira da Serra', cat: 'Mercearia', cost: 5.2, comp: { pingo: 8.99 }, prod: 'Azeite', qty: '750 ml' },
  { id: 'l6', name: 'Iogurte Grego Natural Sem Lactose Pack 4', size: '4 × 115 g', brand: 'Terra Nostra', cat: 'Frescos', cost: 1.4, comp: { pingo: 2.79 }, prod: 'Iogurte', qty: '460 g' },
  { id: 'l4', name: 'Bolachas Maria Cuétara', size: '800 g', brand: 'Cuétara', cat: 'Mercearia', cost: 1.55, comp: { pingo: 2.44 }, prod: 'Bolacha', qty: '800 g', img: 'https://exemplo.invalid/x.png' },
];
(async () => {
  const b = await chromium.launch(); let falhas = 0, total = 0, ajustadas = 0;
  for (const [nome, vp, plano] of [['computador', { width: 1280, height: 1800 }, 'Completo'], ['telemovel', { width: 390, height: 1800 }, 'Completo'], ['telemovel-essencial', { width: 390, height: 1800 }, 'Essencial']]) {
    const pg = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const erros = []; pg.on('pageerror', e => erros.push(e.message));
    await pg.route(/supabase-js/, r => r.fulfill({ body: STUB, contentType: 'application/javascript' }));
    await pg.route(/^https?:\/\/(?!.*supabase-js).*/, r => r.abort());
    await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(400);
    await pg.evaluate(L => { for (const k of Object.keys(localStorage)) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.v === 6) {
      o.teste = false; o.tab = 'posts'; o.view = 'owner';
      const demo = ['bananas','detergente','azeite','cafe','agua','bolachas','leite','arroz'];
      o.products = (o.products || []).filter(p => demo.includes(p.id)).concat(L);
      o.promos = {}; for (const p of o.products) o.promos[p.id] = { status: 'approved', at: new Date().toISOString(), choice: null, sched: null, clients: 0 };
      o.store.name = 'Supermercado Nossa Senhora da Conceição'; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} } }, LONGOS);
    // repor a demonstração primeiro para ter os produtos de exemplo e depois aplicar o estado de teste
    await pg.evaluate(() => { const b = document.querySelector('[data-act="reset"]'); b && b.click(); });
    await pg.waitForTimeout(300);
    await pg.evaluate(([L, plano]) => { for (const k of Object.keys(localStorage)) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.v === 6) {
      o.store.plan = plano; o.tab = 'posts'; o.view = 'owner'; o.products = o.products.concat(L.filter(x => !o.products.some(p => p.id === x.id)));
      o.promos = {}; for (const p of o.products) o.promos[p.id] = { status: 'approved', at: new Date().toISOString(), choice: null, sched: null, clients: 0 };
      o.store.name = 'Supermercado Nossa Senhora da Conceição'; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} } }, [LONGOS, plano]);
    await pg.reload(); await pg.waitForTimeout(1200);
    const r = await pg.evaluate(() => [...document.querySelectorAll('.post,.reel .scene')].map((p, i) => ({ i, e: p.dataset.enquadrado || 'sem-zonas', t: (p.innerText || '').replace(/\s+/g, ' ').slice(0, 60) })));
    // a marca nunca pode faltar no nome usado nas publicações
    const semMarca = await pg.evaluate(L => { const n = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
      const out = []; for (const sec of document.querySelectorAll('section.card')) { const h = sec.querySelector('h2'); if (!h) continue;
        const p = L.find(x => n(h.textContent).startsWith(n(x.name) + ' a ')); if (!p) continue;
        for (const nm of sec.querySelectorAll('.post .p-name')) if (!n(nm.textContent).includes(n(p.brand))) out.push(p.name + ' → ' + nm.textContent.trim()); }
      return out; }, LONGOS);
    for (const x of semMarca) console.log('   ✗ sem marca:', x);
    falhas += semMarca.length;
    // as publicações nunca falam da concorrência
    const proibidas = await pg.evaluate(() => [...document.querySelectorAll('.post,.reel .scene')].map(p => p.innerText || '').filter(t => /grandes (cadeias|superf)|mais barat|concorr|continente|pingo doce|auchan|lidl|intermarch/i.test(t)).map(t => t.replace(/\s+/g, ' ').slice(0, 80)));
    for (const x of proibidas) console.log('   ✗ fala da concorrência:', x);
    falhas += proibidas.length;
    if (plano === 'Essencial') { const ex = await pg.evaluate(() => ({ carrossel: !!document.querySelector('.ctrack'), reel: !!document.querySelector('.reel') })); if (ex.carrossel || ex.reel) { console.log('   ✗ Essencial mostra carrossel/reels'); falhas++; } }
    const f = r.filter(x => x.e === 'falha');
    total += r.length; falhas += f.length; ajustadas += r.filter(x => x.e === 'ajustado').length;
    console.log(`${nome}: ${r.length} publicações · ${r.filter(x => x.e === 'ok').length} ok · ${r.filter(x => x.e === 'ajustado').length} ajustadas · ${f.length} com problema${erros.length ? ' · ERROS JS: ' + erros.join(' | ') : ''}`);
    for (const x of f) console.log('   ✗', x.t);
    if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, `publicacoes-${nome}.png`), fullPage: true });
    if (erros.length) falhas++;
    await pg.close();
  }
  await b.close();
  console.log(falhas ? `FALHOU: ${falhas}` : `OK: ${total} publicações bem enquadradas (${ajustadas} com texto reduzido para caber)`);
  process.exit(falhas ? 1 : 0);
})();
