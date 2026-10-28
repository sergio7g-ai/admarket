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

// Verifica o separador Folheto: gera o folheto, vira todas as páginas e confirma que nada sai da página nem fica cortado.
// Uso: node testes/folheto.cjs [pasta-para-capturas]
(async () => {
  const b = await chromium.launch(); let falhas = 0;
  for (const [nome, vp] of [['computador', { width: 1280, height: 1400 }], ['telemovel', { width: 390, height: 1000 }]]) {
    const pg = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const erros = []; pg.on('pageerror', e => erros.push(e.message));
    await pg.route(/supabase-js/, r => r.fulfill({ body: STUB, contentType: 'application/javascript' }));
    await pg.route(/^https?:\/\/(?!.*supabase-js).*/, r => r.abort());
    await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(400);
    await pg.evaluate(() => { const b = document.querySelector('[data-act="reset"]'); b && b.click(); });
    await pg.waitForTimeout(300);
    await pg.evaluate(L => { for (const k of Object.keys(localStorage)) { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.v === 6) {
      o.tab = 'folheto'; o.view = 'owner'; o.folheto = null; o.products = o.products.concat(L.filter(x => !o.products.some(p => p.id === x.id)));
      const extra = [['Arroz Agulha Cigala','1 kg','Mercearia',1.1,1.79],['Massa Esparguete Milaneza','500 g','Mercearia',0.6,0.99],['Café Moído Delta Lote Chávena','250 g','Mercearia',2.2,3.69],['Atum em Óleo Bom Petisco','3 × 85 g','Mercearia',2.1,3.49],['Cerveja Super Bock Mini Pack 10','10 × 25 cl','Bebidas',4.1,6.49],['Sumo Compal Laranja','1 L','Bebidas',0.9,1.49],['Vinho Tinto Monte Velho','75 cl','Bebidas',3.2,4.99],['Iogurte Natural Danone','4 × 120 g','Frescos',1.2,1.99],['Manteiga Mimosa com Sal','250 g','Frescos',1.6,2.59],['Fiambre da Perna Nobre','200 g','Frescos',1.5,2.49],['Papel Higiénico Renova 12 Rolos','12 un.','Higiene',3.3,5.29],['Champô Pantene Repair','400 ml','Higiene',2.4,3.99],['Lixívia Neoblanc','2 L','Higiene',0.8,1.39]];
      extra.forEach((e, i) => { if (!o.products.some(p => p.id === 'x' + i)) o.products.push({ id: 'x' + i, name: e[0], size: e[1], cat: e[2], cost: e[3], comp: { pingo: e[4] }, brand: e[0].split(' ').slice(-1)[0] }); });
      o.store.name = 'Supermercado Nossa Senhora da Conceição'; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} } }, LONGOS);
    await pg.reload(); await pg.waitForTimeout(800);
    const n = await pg.evaluate(() => document.querySelectorAll('[data-fol-sel]').length);
    for (let k = 0; k < 10; k++) { const b2 = await pg.$('xpath=//button[@data-act="fol-todos" and normalize-space()="Escolher todos"]'); if (!b2) break; await b2.click(); await pg.waitForTimeout(80); }
    await pg.click('[data-act="gerar-folheto"]'); await pg.waitForTimeout(900);
    const info = await pg.evaluate(() => {
      const probs = []; const pages = [...document.querySelectorAll('#fb-prev .fp')];
      pages.forEach((p, i) => { const P = p.getBoundingClientRect();
        for (const c of p.querySelectorAll('.fp-tile,.fp-foot')) { const r = c.getBoundingClientRect(); if (r.left < P.left - 1 || r.right > P.right + 1 || r.top < P.top - 1 || r.bottom > P.bottom + 1) probs.push(`pág ${i + 1}: ${c.className} sai da página`); }
        const cs = [...p.querySelectorAll('.fp-tile')].map(c => c.getBoundingClientRect());
        for (let a = 0; a < cs.length; a++) for (let z = a + 1; z < cs.length; z++) { const w = Math.min(cs[a].right, cs[z].right) - Math.max(cs[a].left, cs[z].left), h = Math.min(cs[a].bottom, cs[z].bottom) - Math.max(cs[a].top, cs[z].top); if (w > 1 && h > 1) probs.push(`pág ${i + 1}: cartões sobrepostos`); }
        const foot = p.querySelector('.fp-foot')?.getBoundingClientRect(); if (foot) for (const r of cs) if (r.bottom > foot.top + 1 && r.top < foot.bottom) probs.push(`pág ${i + 1}: cartão por cima do rodapé`);
        for (const c of p.querySelectorAll('.fp-tile')) if (c.dataset.encaixe === 'falha') probs.push(`pág ${i + 1}: texto não cabe no cartão (${c.querySelector('.fp-nome')?.textContent})`);
        for (const t of p.querySelectorAll('.fp-tag')) { const r = t.getBoundingClientRect(), T = t.closest('.fp-tile,.fp').getBoundingClientRect(); if (r.left < T.left - 1 || r.right > T.right + 1) probs.push(`pág ${i + 1}: preço cortado`); }
      });
      const nomes = pages.flatMap(p => [...p.querySelectorAll('.fp-nome')].map(n => n.textContent));
      return { produtos: nomes.length, paginas: pages.length, folhas: document.querySelectorAll('#fb-prev .fb-sheet').length, probs };
    });
    // virar todas as páginas
    let viradas = 0; for (let k = 0; k < 40; k++) { const dis = await pg.$eval('[data-fb="seg"]', b => b.disabled); if (dis) break; await pg.click('[data-fb="seg"]'); viradas++; await pg.waitForTimeout(120); }
    if (SAIDA) { await pg.click('[data-fb="ant"]').catch(() => {}); for (let k = 0; k < viradas; k++) await pg.click('[data-fb="ant"]').catch(() => {}); await pg.waitForTimeout(900); await pg.evaluate(() => { const e = document.getElementById('fb-prev'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 130); }); await pg.waitForTimeout(100); await (await pg.$('#fb-prev')).screenshot({ path: path.join(SAIDA, `folheto-${nome}-capa.png`) });
      await pg.click('[data-fb="seg"]'); await pg.waitForTimeout(900); await pg.evaluate(() => { const e = document.getElementById('fb-prev'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 130); }); await pg.waitForTimeout(100); await (await pg.$('#fb-prev')).screenshot({ path: path.join(SAIDA, `folheto-${nome}-p2.png`) });
      await pg.click('[data-fb="seg"]'); await pg.waitForTimeout(900); await pg.evaluate(() => { const e = document.getElementById('fb-prev'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 130); }); await pg.waitForTimeout(100); await (await pg.$('#fb-prev')).screenshot({ path: path.join(SAIDA, `folheto-${nome}-p3.png`) }); }
    console.log(`${nome}: ${n} produtos possíveis · ${info.produtos} no folheto · ${info.paginas} páginas em ${info.folhas} folhas · ${viradas} viragens · ${info.probs.length} problemas${erros.length ? ' · ERROS JS: ' + erros.join(' | ') : ''}`);
    for (const x of info.probs) console.log('   ✗', x);
    falhas += info.probs.length + erros.length + (info.paginas < 2 ? 1 : 0) + (info.produtos !== n ? 1 : 0);
    await pg.close();
  }
  await b.close();
  console.log(falhas ? `FALHOU: ${falhas}` : 'OK: folheto bem enquadrado em computador e telemóvel');
  process.exit(falhas ? 1 : 0);
})();
