/* admarket · folheto da loja em formato flipbook.
   Usado pela app (pré-visualização) e pela página pública folheto.html (o link que vai para as redes).
   Folheto.paginas(dados) → páginas em HTML; Folheto.livro(el, dados) → monta o flipbook com virar de página.
   dados = {loja:{nome,cidade,morada,logo,c1,c2,ig,fb}, ini:'AAAA-MM-DD', fim:'AAAA-MM-DD', itens:[{nome,tamanho,preco,cat,img,arte}], inscrever:'url'}
   Os itens vêm já ordenados do mais forte para o mais fraco (melhor promoção / maior margem): os primeiros ganham destaque. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  const dd = s => { const d = new Date(s + 'T00:00'); return d.getDate() + '/' + (d.getMonth() + 1); };
  const ink = hex => { const h = String(hex || '#1E40AF').replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)); return (.2126 * r + .7152 * g + .0722 * b) > .45 ? '#0F172A' : '#FFFFFF'; };
  const iniciais = n => String(n || '').split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'AM';
  const ORDEM_CAT = ['Frescos', 'Mercearia', 'Bebidas', 'Higiene', 'Limpeza'];

  const CSS = `
.fb{--fbh:"Plus Jakarta Sans","Inter",system-ui,sans-serif;--fbu:"Inter",system-ui,sans-serif;position:relative;user-select:none;-webkit-user-select:none}
.fb-stage{position:relative;margin:0 auto;perspective:2600px}
.fb-move{position:absolute;inset:0;transition:transform .6s cubic-bezier(.3,.7,.3,1)}
.fb-sheet{position:absolute;top:0;height:100%;transform-origin:left center;transform-style:preserve-3d;transition:transform .75s cubic-bezier(.35,.65,.25,1)}
.fb-sheet.virada{transform:rotateY(-180deg)}
.fb-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;background:#fff;box-shadow:0 10px 30px -12px rgba(15,23,42,.35)}
.fb-face.costas{transform:rotateY(180deg)}
.fb-face::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.10),rgba(0,0,0,0) 7%)}
.fb-face.costas::after{background:linear-gradient(270deg,rgba(0,0,0,.10),rgba(0,0,0,0) 7%)}
.fb-face.vazia{background:#F1F5F9}
.fb-nav{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px;font:600 14px var(--fbu);color:#334155}
.fb-nav button{border:1px solid rgba(15,23,42,.12);background:#fff;border-radius:999px;width:42px;height:42px;font-size:18px;cursor:pointer;color:#0F172A}
.fb-nav button:disabled{opacity:.35;cursor:default}
.fp{position:absolute;inset:0;container-type:inline-size;font-family:var(--fbu);color:#0F172A;background:#fff}
.fp *{box-sizing:border-box}
.fp-band{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:3cqw;padding:0 6cqw}
.fp-logo{width:11cqw;height:11cqw;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;font:800 4.4cqw var(--fbh)}
.fp-loja{font:800 4.6cqw/1.15 var(--fbh);letter-spacing:-.01em}
.fp-cidade{font:500 3.2cqw var(--fbu);opacity:.85}
.fp-foot{position:absolute;left:6cqw;right:6cqw;bottom:3.5cqw;font:500 2.7cqw/1.3 var(--fbu);color:#64748B;display:flex;justify-content:space-between;gap:3cqw}
.fp-card{position:absolute;background:#fff;border-radius:3cqw;box-shadow:0 .6cqw 2.4cqw rgba(15,23,42,.12);overflow:hidden;display:flex}
.fp-ph{display:grid;place-items:center;overflow:hidden}
.fp-ph img{max-width:100%;max-height:100%;object-fit:contain}
.fp-ph svg{width:100%;height:100%}
.fp-ph .fp-letra{height:80%;max-width:80%;aspect-ratio:1;border-radius:3cqw;display:grid;place-items:center;font:800 9cqw var(--fbh);opacity:.9}
.fp-nome{font:800 3.6cqw/1.12 var(--fbh);letter-spacing:-.015em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fp-tam{font:500 2.6cqw var(--fbu);color:#64748B;margin-top:.6cqw}
.fp-preco{font:800 6.4cqw/1 var(--fbh);letter-spacing:-.03em}
.fp-selo{position:absolute;border-radius:50%;display:grid;place-items:center;text-align:center;transform:rotate(-8deg);box-shadow:0 1cqw 2.5cqw rgba(0,0,0,.18)}
.fp-chip{display:inline-block;border-radius:99px;padding:.9cqw 2.6cqw;font:800 2.6cqw var(--fbu);letter-spacing:.06em;text-transform:uppercase}
`;
  function css() { if (document.getElementById('fb-css')) return; const s = document.createElement('style'); s.id = 'fb-css'; s.textContent = CSS; document.head.appendChild(s); }

  function foto(it, c1) {
    if (it.img) return `<img src="${esc(it.img)}" alt="" loading="lazy">`;
    if (it.arte) return it.arte;
    return `<span class="fp-letra" style="background:${c1}22;color:${c1}">${esc((it.nome || '?')[0])}</span>`;
  }
  function logoHTML(l, fundo, cor) {
    return l.logo ? `<img class="fp-logo" src="${esc(l.logo)}" alt="" style="background:#fff">` : `<span class="fp-logo" style="background:${fundo};color:${cor}">${esc(iniciais(l.nome))}</span>`;
  }
  // cartão pequeno (2 por linha): foto em cima, nome, tamanho e preço
  function cartao(it, x, y, w, h, c) {
    // a foto ocupa o espaço que sobra do texto (o texto nunca é sacrificado pela foto)
    return `<div class="fp-card" style="left:${x}cqw;top:${y}cqw;width:${w}cqw;height:${h}cqw;flex-direction:column">
      <div class="fp-ph" style="flex:1 1 auto;min-height:0;padding:2cqw 2cqw 0">${foto(it, c.c1)}</div>
      <div class="fp-txt" style="flex:none;display:flex;flex-direction:column;gap:1.2cqw;padding:1.2cqw 2.6cqw 2cqw">
        <div><div class="fp-nome">${esc(it.nome)}</div>${it.tamanho ? `<div class="fp-tam">${esc(it.tamanho)}</div>` : ''}</div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:1cqw"><span class="fp-chip" style="background:${c.c2};color:${c.i2};font-size:2.1cqw;padding:.7cqw 1.8cqw">Promo</span><span class="fp-preco" style="color:${c.pc}">${eur(it.preco)}</span></div>
      </div></div>`;
  }
  // cartão de destaque (largura toda): foto à esquerda com a etiqueta, nome grande e preço em grande
  function destaque(it, x, y, w, h, c, grande) {
    const s = grande ? 1.25 : 1;
    return `<div class="fp-card" style="left:${x}cqw;top:${y}cqw;width:${w}cqw;height:${h}cqw;align-items:stretch">
      <div class="fp-ph" style="width:44%;padding:3cqw;position:relative">${foto(it, c.c1)}<span class="fp-chip" style="position:absolute;left:3cqw;top:3cqw;background:${c.c1};color:${c.i1}">Destaque</span></div>
      <div class="fp-txt" style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:2.5cqw 4cqw 2.5cqw 1cqw;min-width:0;min-height:0;overflow:hidden">
        <div class="fp-nome" style="font-size:${4.8 * s}cqw;-webkit-line-clamp:3">${esc(it.nome)}</div>
        ${it.tamanho ? `<div class="fp-tam" style="font-size:${3 * s}cqw">${esc(it.tamanho)}</div>` : ''}
        <div class="fp-preco" style="color:${c.pc};font-size:${9 * s}cqw;margin-top:2.5cqw">${eur(it.preco)}</div>
      </div></div>`;
  }

  function paginas(d) {
    const l = d.loja || {}, c1 = l.c1 || '#1E40AF', c2 = l.c2 || '#F97316', i1 = ink(c1), i2 = ink(c2);
    const c = { c1, c2, i1, i2, pc: i1 === '#FFFFFF' ? c1 : '#0F172A' };
    const per = `${dd(d.ini)} a ${dd(d.fim)}`, itens = (d.itens || []).slice();
    const rodape = n => `<div class="fp-foot"><span>Válido de ${per} · limitado ao stock existente</span><span>${n}</span></div>`;
    const pags = [];
    // capa: o produto mais forte em grande e os dois seguintes
    const capa = itens.slice(0, 3);
    pags.push(`<div class="fp" style="background:${c1}">
      <div class="fp-band" style="top:6cqw;color:${i1}">${logoHTML(l, i1, c1)}<div><div class="fp-loja">${esc(l.nome)}</div>${l.cidade ? `<div class="fp-cidade">${esc(l.cidade)}</div>` : ''}</div></div>
      <div style="position:absolute;left:6cqw;right:6cqw;top:22cqw;color:${i1}"><span class="fp-chip" style="background:${c2};color:${i2};font-size:3.2cqw">${per}</span>
        <div style="font:800 13cqw/.95 var(--fbh);letter-spacing:-.04em;margin-top:2.5cqw">Promoções</div><div style="font:600 4.6cqw var(--fbu);opacity:.9;margin-top:1cqw">da semana</div></div>
      ${capa[0] ? destaque(capa[0], 6, 52, 88, 44, c, true) : ''}
      ${capa[1] ? cartao(capa[1], 6, 99, 42.5, 34, c) : ''}${capa[2] ? cartao(capa[2], 51.5, 99, 42.5, 34, c) : ''}
      <div class="fp-foot" style="color:${i1};opacity:.85"><span>Válido de ${per} · limitado ao stock existente</span></div></div>`);
    // por gama, em fluxo contínuo: cada gama tem um título; se tiver 3 ou mais produtos abre com o mais forte em destaque.
    // Várias gamas pequenas partilham a mesma página para não haver páginas meio vazias.
    const resto = itens.slice(3), cats = [];
    for (const it of resto) { const k = it.cat || 'Outros'; let g = cats.find(x => x.k === k); if (!g) cats.push(g = { k, its: [] }); g.its.push(it); }
    const ord = k => { const i = ORDEM_CAT.indexOf(k); return i < 0 ? 99 : i; };
    cats.sort((a, b) => ord(a.k) - ord(b.k));
    const TOPO = 18, FUNDO = 129, TIT = 8, LIN = 33, DEST = 37;
    let corpo = '', y = TOPO;
    const fecha = () => { if (!corpo) return; const n = pags.length + 1;
      pags.push(`<div class="fp" style="background:#F8FAFC">
        <div class="fp-band" style="height:13cqw;background:${c1};color:${i1}">${logoHTML(l, i1, c1).replace('fp-logo"', 'fp-logo" style="width:8cqw;height:8cqw;font-size:3.2cqw"')}<div class="fp-loja" style="font-size:4cqw">${esc(l.nome)}</div><span style="margin-left:auto;font:700 3cqw var(--fbu);opacity:.9;white-space:nowrap">${per}</span></div>
        ${corpo}${rodape(n)}</div>`); corpo = ''; y = TOPO; };
    const titulo = k => `<div style="position:absolute;left:6cqw;right:6cqw;top:${y}cqw;height:${TIT - 2}cqw;display:flex;align-items:center;gap:2.5cqw;font:800 4.6cqw var(--fbh);color:${c.pc};letter-spacing:-.02em"><span style="width:1.4cqw;height:5cqw;border-radius:1cqw;background:${c2}"></span>${esc(k)}<span style="flex:1;height:.3cqw;background:rgba(15,23,42,.08)"></span></div>`;
    for (const g of cats) {
      const its = g.its.slice();
      // a gama começa numa página nova se não couber o título e pelo menos uma linha
      if (y + TIT + LIN - 3 > FUNDO) fecha();
      corpo += titulo(g.k); y += TIT;
      if (its.length >= 3 && y + DEST - 3 <= FUNDO) { corpo += destaque(its.shift(), 6, y, 88, DEST - 3, c, false); y += DEST; }
      while (its.length) {
        if (y + LIN - 3 > FUNDO) { fecha(); corpo += titulo(g.k + ' (cont.)'); y += TIT; }
        const a = its.shift(), b = its.shift();
        corpo += cartao(a, 6, y, 42.5, LIN - 3, c); if (b) corpo += cartao(b, 51.5, y, 42.5, LIN - 3, c);
        y += LIN;
      }
      y += 1;
    }
    fecha();
    // contracapa: a loja e o convite para receber o folheto no WhatsApp
    pags.push(`<div class="fp" style="background:${c2};color:${i2}">
      <div style="position:absolute;left:8cqw;right:8cqw;top:16cqw"><div style="font:800 12cqw/1 var(--fbh);letter-spacing:-.04em">Até já!</div>
        <div style="font:500 4.2cqw/1.4 var(--fbu);margin-top:4cqw">Promoções válidas de ${per}, limitadas ao stock existente. Imagens meramente ilustrativas.</div></div>
      <div style="position:absolute;left:8cqw;right:8cqw;top:62cqw;background:#fff;color:#0F172A;border-radius:4cqw;padding:5cqw;box-shadow:0 2cqw 5cqw rgba(0,0,0,.15)">
        <div style="font:800 5.4cqw/1.15 var(--fbh)">Receba o folheto no WhatsApp</div>
        <div style="font:500 3.4cqw/1.4 var(--fbu);color:#475569;margin-top:2cqw">${d.inscrever ? 'Abra o link do folheto nas nossas redes e toque em «Receber no WhatsApp». Só enviamos o folheto da semana e pode cancelar quando quiser.' : 'Peça na caixa para receber o folheto da semana.'}</div></div>
      <div style="position:absolute;left:8cqw;right:8cqw;bottom:12cqw;display:flex;align-items:center;gap:4cqw">${logoHTML(l, c1, i1)}<div><div class="fp-loja">${esc(l.nome)}</div><div class="fp-cidade">${esc([l.morada, l.cidade].filter(Boolean).join(' · '))}${l.ig ? ' · ' + esc(l.ig) : ''}</div></div></div></div>`);
    return pags;
  }

  // encaixe: se um nome ficar cortado ou o texto não couber no cartão, nome e preço encolhem aos poucos
  function encaixar(root) {
    for (const card of root.querySelectorAll('.fp-card')) {
      const txt = card.querySelector('.fp-txt'), nome = card.querySelector('.fp-nome'), preco = card.querySelector('.fp-preco');
      if (!txt || !nome) continue;
      const ph = card.querySelector('.fp-ph'), alto = card.style.flexDirection === 'column';
      const mal = () => nome.scrollHeight > nome.clientHeight + 1 || txt.scrollHeight > txt.clientHeight + 1 || (alto && ph && ph.getBoundingClientRect().height < card.getBoundingClientRect().height * 0.3) || (preco && preco.scrollWidth > preco.clientWidth + 1) || (preco && preco.getBoundingClientRect().right > card.getBoundingClientRect().right + 1);
      for (let k = 0; k < 14 && mal(); k++) for (const t of [nome, preco].filter(Boolean)) t.style.fontSize = (parseFloat(getComputedStyle(t).fontSize) * 0.93) + 'px';
      card.dataset.encaixe = mal() ? 'falha' : 'ok';
    }
  }
  // flipbook: em ecrãs largos abre em duas páginas (capa sozinha à direita); em telemóvel vira uma página de cada vez
  function livro(el, d, op = {}) {
    css();
    const pags = paginas(d);
    let estado = { i: 0 };
    function montar() {
      const W = el.clientWidth || 360, dupla = W >= 640 && !op.simples;
      const pw = Math.min(dupla ? W / 2 : W, op.max || 520), ph = pw * 1.414;
      const folhas = [];
      if (dupla) for (let k = 0; k < pags.length; k += 2) folhas.push([pags[k], pags[k + 1] ?? null]);
      else for (const p of pags) folhas.push([p, null]);
      el.innerHTML = `<div class="fb"><div class="fb-stage" style="width:${dupla ? pw * 2 : pw}px;height:${ph}px"><div class="fb-move">
        ${folhas.map((f, k) => `<div class="fb-sheet" data-k="${k}" style="left:${dupla ? pw : 0}px;width:${pw}px"><div class="fb-face">${f[0]}</div><div class="fb-face costas${f[1] == null ? ' vazia' : ''}">${f[1] ?? ''}</div></div>`).join('')}
        </div></div><div class="fb-nav"><button data-fb="ant" aria-label="Página anterior">‹</button><span class="fb-pg"></span><button data-fb="seg" aria-label="Página seguinte">›</button></div></div>`;
      const sheets = [...el.querySelectorAll('.fb-sheet')], move = el.querySelector('.fb-move'), N = sheets.length;
      const pos = () => {
        const i = estado.i = Math.max(0, Math.min(estado.i, N));
        sheets.forEach((s, k) => { s.classList.toggle('virada', k < i); s.style.zIndex = k < i ? k + 1 : N * 2 - k; });
        if (dupla) move.style.transform = i === 0 ? `translateX(-${pw / 2}px)` : (i === N && folhas[N - 1][1] != null ? `translateX(${pw / 2}px)` : 'none');
        else move.style.transform = 'none';
        const tot = pags.length;
        el.querySelector('.fb-pg').textContent = dupla ? (i === 0 ? `Capa · ${tot} páginas` : i === N ? `Fim · ${tot} páginas` : `Páginas ${i * 2}–${Math.min(i * 2 + 1, tot)} de ${tot}`) : `Página ${Math.min(i + 1, tot)} de ${tot}`;
        el.querySelector('[data-fb="ant"]').disabled = i === 0;
        el.querySelector('[data-fb="seg"]').disabled = dupla ? i === N : i >= N - 1;
      };
      const ir = n => { estado.i += n; pos(); };
      el.querySelector('[data-fb="ant"]').onclick = () => ir(-1);
      el.querySelector('[data-fb="seg"]').onclick = () => ir(1);
      const stage = el.querySelector('.fb-stage');
      let x0 = null;
      stage.onpointerdown = e => { x0 = e.clientX; };
      stage.onpointerup = e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 30) return ir(dx < 0 ? 1 : -1); const r = stage.getBoundingClientRect(); ir(e.clientX > r.left + r.width / 2 ? 1 : -1); };
      el.tabIndex = 0; el.onkeydown = e => { if (e.key === 'ArrowRight') ir(1); if (e.key === 'ArrowLeft') ir(-1); };
      pos();
      encaixar(el); document.fonts?.ready?.then(() => encaixar(el));
      return { dupla };
    }
    let atual = montar();
    let lw = el.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - lw) > 40) { lw = el.clientWidth; atual = montar(); } });
    ro.observe(el);
    return { paginas: pags.length, parar: () => ro.disconnect() };
  }

  window.Folheto = { paginas, livro, css, encaixar };
})();
