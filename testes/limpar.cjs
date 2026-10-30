// Botão «Limpar a app» (Configuração): 1.º toque pede confirmação, 2.º deixa a app como nova. Uso: node testes/limpar.cjs
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 390, height: 1400 } }), erros = [], prob = [];
  pg.on('pageerror', e => erros.push(e.message));
  await pg.route(/^https?:\/\/.*/, r => r.abort());
  await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(400);
  await pg.evaluate(() => { const k = 'admark-demo-v5', o = JSON.parse(localStorage.getItem(k)); o.view = 'owner'; o.tab = 'config'; o.teste = false;
    o.products = [{ id: 'x', name: 'Arroz', size: '1 kg', qty: '1 kg', brand: 'Cigala', cat: 'Mercearia', cost: 1, comp: {} }]; o.promos = { x: { status: 'approved' } }; o.porConfirmar = [{ desc: 'X' }];
    localStorage.setItem(k, JSON.stringify(o)); });
  await pg.reload(); await pg.waitForTimeout(600);
  await pg.click('[data-act="limpar-app"]'); await pg.waitForTimeout(150);
  if (!/Tem a certeza/.test(await pg.textContent('[data-act="limpar-app"]'))) prob.push('1.º toque devia pedir confirmação');
  let o = await pg.evaluate(() => JSON.parse(localStorage.getItem('admark-demo-v5')));
  if (!o.products.length) prob.push('1.º toque não pode apagar nada');
  await pg.click('[data-act="limpar-app"]'); await pg.waitForTimeout(400);
  o = await pg.evaluate(() => JSON.parse(localStorage.getItem('admark-demo-v5')));
  if (o.products.length || Object.keys(o.promos).length || (o.porConfirmar || []).length || o.invoices.length) prob.push('depois de confirmar devia ficar tudo vazio');
  await pg.reload(); await pg.waitForTimeout(500);
  o = await pg.evaluate(() => JSON.parse(localStorage.getItem('admark-demo-v5')));
  if (o.products.length) prob.push('ao recarregar voltaram produtos');
  if (erros.length) prob.push('erros JS: ' + erros.join(' | '));
  await b.close();
  for (const p of prob) console.log('  ✗ ' + p);
  console.log(prob.length ? `FALHOU: ${prob.length} problemas` : 'OK: limpar a app deixa tudo como novo');
  process.exit(prob.length ? 1 : 0);
})();
