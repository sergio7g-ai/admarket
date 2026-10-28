// Testa a leitura de faturas com três fornecedores de formatos diferentes, em PDF e em foto (texto do OCR guardado).
// Para cada produto confirma as unidades e o custo real por unidade (já com todos os descontos).
// Uso: node testes/faturas.mjs   (sai com código 1 se alguma linha falhar)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const { lerQR, lerLinhas, bate } = await import(path.join(aqui, '../supabase/functions/ler-fatura/parser.js'));
const F = p => path.join(aqui, 'faturas', p);
const pdf = n => JSON.parse(fs.readFileSync(F(n + '-pdf.json'), 'utf8'));
const esperado = JSON.parse(fs.readFileSync(path.join(aqui, '../exemplos/faturas-teste-esperado.json'), 'utf8'));

// [nome no teste, unidades, custo por unidade, opções]
const FT1307 = [['Atum', 24, 0.95], ['Esparguete', 30, 0.6175], ['Iogurte', 12, 1.25], ['Azeite', 12, 4.171], ['Café', 20, 2.90], ['Arroz', 40, 0.882], ['Leite', 48, 0.62], ['Bolachas', 18, 1.55]];
const LACT = esperado.A.linhas.map(l => [l.descricao.split(' ').slice(0, 3).join(' '), l.qtd, l.custo_unit_real]);
const CASH = esperado.B.linhas.filter(l => !/OFERTA/.test(l.descricao)).map(l => {
  // a oferta de 2 arrozes junta-se à linha do arroz: 52 unidades pelo preço de 50
  if (/ARROZ/.test(l.descricao)) return ['ARROZ CAROLINO', 52, Math.round(49 / 52 * 10000) / 10000];
  return [l.descricao.split(' ').slice(0, 2).join(' '), l.unidades, l.custo_unit_real];
});
// na foto o OCR perdeu alguns números de um só algarismo: onde perdeu as unidades por embalagem, a linha tem de ficar «a confirmar»
const CASH_FOTO = CASH.map(([n, u, c]) => /AGUA|VINHO|PAPEL/.test(n) ? [n, null, null, { confirmar: true }]
  : /ARROZ/.test(n) ? [n, 50, 0.98] : [n, u, c]);   // a quantidade da oferta perdeu-se na foto

const casos = [
  ['FT1307 · PDF', pdf('ft1307').texto, pdf('ft1307').qr, FT1307],
  ['Lactibeira · PDF', pdf('lactibeira').texto, pdf('lactibeira').qr, LACT],
  ['Lactibeira · foto', fs.readFileSync(F('lactibeira-foto.ocr.txt'), 'utf8'), esperado.A.qr, LACT],
  ['Cash & Carry · PDF', pdf('cashcarry').texto, pdf('cashcarry').qr, CASH],
  ['Cash & Carry · foto', fs.readFileSync(F('cashcarry-foto.ocr.txt'), 'utf8'), esperado.B.qr, CASH_FOTO],
];
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let falhas = 0;
for (const [nome, texto, qrTxt, esp] of casos) {
  const qr = lerQR(qrTxt), r = lerLinhas(texto, null, qr), ls = r.linhas;
  const prob = [];
  for (const [n, u, c, o = {}] of esp) {
    const todas = ls.filter(x => norm(x.descricao).includes(norm(n))), l = todas[0];
    if (todas.length > 1) prob.push(`${n}: aparece ${todas.length} vezes`);
    if (!l) { prob.push(`${n}: não lido`); continue; }
    const custo = l.preco_unit * (1 - l.desconto_pct / 100);
    if (o.confirmar) { if (!l.incerta) prob.push(`${n}: devia ficar a confirmar (faltam as unidades por embalagem)`); continue; }
    if (l.incerta) prob.push(`${n}: ficou a confirmar`);
    if (Math.abs(l.quantidade - u) > 1e-6) prob.push(`${n}: ${l.quantidade} unidades em vez de ${u}`);
    if (Math.abs(custo - c) > Math.max(0.002, c * 0.003)) prob.push(`${n}: custo ${custo.toFixed(4)} em vez de ${c.toFixed(4)}`);
  }
  const lixo = ls.filter(l => !esp.some(([n]) => norm(l.descricao).includes(norm(n))));
  for (const l of lixo) prob.push(`linha a mais: «${l.descricao}»`);
  const sujas = ls.filter(l => /^(LB-\d|\d{5,7}\s)/.test(l.descricao));
  for (const l of sujas) prob.push(`código interno na descrição: «${l.descricao}»`);
  const v = bate(ls, qr);
  console.log(`${prob.length ? '✗' : '✓'} ${nome}: ${ls.length} linhas · QR ${v === true ? 'confere' : v === false ? 'NÃO confere' : 'sem QR'}`);
  for (const p of prob) console.log('    ' + p);
  falhas += prob.length;
}
console.log(falhas ? `FALHOU: ${falhas} problemas` : 'OK: todas as faturas lidas certas');
process.exit(falhas ? 1 : 0);
