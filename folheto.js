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
.fp{position:absolute;inset:0;container-type:inline-size;font-family:var(--fbu);color:#0F172A;background:#fff;overflow:hidden}
.fp *{box-sizing:border-box}
.fp-logo{width:10cqw;height:10cqw;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;font:800 4cqw var(--fbh)}
.fp-foot{position:absolute;left:3.5cqw;right:3.5cqw;bottom:2.4cqw;font:500 2.3cqw/1.3 var(--fbu);color:#64748B;display:flex;justify-content:space-between;gap:3cqw}
.fp-tile{position:absolute;display:flex;flex-direction:column;padding:2cqw 2.2cqw 2cqw;border-right:.25cqw solid #E5E7EB;border-bottom:.25cqw solid #E5E7EB;background:#fff}
.fp-ph{position:relative;flex:1 1 auto;min-height:0;display:grid;place-items:center;overflow:hidden}
.fp-ph>img{position:absolute;inset:0;margin:auto;max-width:var(--fs,100%);max-height:var(--fs,100%);object-fit:contain}
.fp-ph>svg{position:absolute;inset:0;margin:auto;width:var(--fs,100%);height:var(--fs,100%)}
.fp-ph>.fp-tag{position:absolute;right:.6cqw;bottom:1.6cqw}
.fp-ph .fp-letra{height:calc(var(--fs,100%)*.7);max-width:calc(var(--fs,100%)*.7);aspect-ratio:1;border-radius:3cqw;display:grid;place-items:center;font:800 9cqw var(--fbh)}
.fp-txt{flex:none;padding-top:1.2cqw}
.fp-nome{font:800 3.1cqw/1.12 var(--fbh);letter-spacing:-.01em;overflow-wrap:break-word}
.fp-tam{font:500 2.3cqw/1.2 var(--fbu);color:#64748B;margin-top:.5cqw}
.fp-tag{position:relative;display:inline-flex;align-items:flex-start;font-family:var(--fbh);font-weight:800;line-height:.82;letter-spacing:-.04em;padding:1.1cqw 1.4cqw 1cqw 1.6cqw;border-radius:1.2cqw;transform:rotate(-3deg);box-shadow:0 .5cqw 1.4cqw rgba(0,0,0,.22);white-space:nowrap}
.fp-pr{flex:none;display:flex;justify-content:flex-end;padding:1.4cqw .6cqw .4cqw 0}
.fp-tag .cw{display:flex;flex-direction:column;align-items:center;margin-left:.08em;letter-spacing:-.02em}
.fp-tag .c{font-size:.5em}
.fp-tag .eu{font-size:.36em;margin-top:.12em}
.fp-fita{position:absolute;left:0;top:2cqw;font:800 2.4cqw var(--fbu);letter-spacing:.08em;text-transform:uppercase;padding:.9cqw 2cqw .9cqw 2.2cqw;border-radius:0 99px 99px 0}
.fp-gama{position:absolute;left:3cqw;right:3cqw;display:flex;align-items:center;gap:2cqw;font:800 4.2cqw var(--fbh);letter-spacing:-.01em;text-transform:uppercase}
.fp-gama i{flex:1;height:.5cqw;border-radius:1cqw}
`;
  function css() { if (document.getElementById('fb-css')) return; const s = document.createElement('style'); s.id = 'fb-css'; s.textContent = CSS; document.head.appendChild(s); }

  function foto(it, c1) {
    if (it.img) return `<img src="${esc(it.img)}" alt="">`;
    if (it.arte) return it.arte;
    return `<span class="fp-letra" style="background:${c1}1f;color:${c1}">${esc((it.nome || '?')[0])}</span>`;
  }
  function logoHTML(l, fundo, cor) {
    return l.logo ? `<img class="fp-logo" src="${esc(l.logo)}" alt="" style="background:#fff">` : `<span class="fp-logo" style="background:${fundo};color:${cor}">${esc(iniciais(l.nome))}</span>`;
  }
  // etiqueta de preço como nos folhetos: euros grandes, cêntimos em cima e o € por baixo
  function etiqueta(v, tam, c) {
    const [e, ct] = (Math.round(v * 100) / 100).toFixed(2).split('.');
    return `<div class="fp-tag" style="font-size:${tam}cqw;background:${c.tag};color:${c.tagInk}"><span>${e}</span><span class="cw"><span class="c">,${ct}</span><span class="eu">€</span></span></div>`;
  }
  // produto numa grelha: foto grande com a etiqueta do preço por cima, nome e tamanho por baixo (nada é cortado: o texto encolhe se for preciso)
  function produto(it, x, y, w, h, c, o = {}) {
    // a etiqueta fica no canto da foto, em estilo de folheto, mas nunca por cima do produto nem da descrição
    const fita = o.fita ? `<span class="fp-fita" style="background:${c.c2};color:${c.i2}">${o.fita}</span>` : '';
    if (o.lado) return `<div class="fp-tile" data-lado style="left:${x}cqw;top:${y}cqw;width:${w}cqw;height:${h}cqw;flex-direction:row;gap:3cqw;align-items:stretch;padding:4cqw 3cqw 3cqw">
      <div class="fp-ph" style="flex:0 0 50%">${foto(it, c.c1)}</div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center">
        <div class="fp-txt"><div class="fp-nome" style="font-size:${o.nome || 5.4}cqw">${esc(it.nome)}</div>${it.tamanho ? `<div class="fp-tam" style="font-size:3.2cqw">${esc(it.tamanho)}</div>` : ''}</div>
        <div class="fp-pr" style="justify-content:flex-start;padding-top:4cqw">${etiqueta(it.preco, o.tag, c)}</div>
      </div>${fita}</div>`;
    return `<div class="fp-tile" style="left:${x}cqw;top:${y}cqw;width:${w}cqw;height:${h}cqw${o.fita ? ';padding-top:6.5cqw' : ''}">
      <div class="fp-ph">${foto(it, c.c1)}${etiqueta(it.preco, o.tag || 6.5, c)}</div>
      <div class="fp-txt"><div class="fp-nome" style="${o.nome ? `font-size:${o.nome}cqw` : ''}">${esc(it.nome)}</div>${it.tamanho ? `<div class="fp-tam">${esc(it.tamanho)}</div>` : ''}</div>${fita}</div>`;
  }

  function paginas(d) {
    const l = d.loja || {}, c1 = l.c1 || '#1E40AF', c2 = l.c2 || '#F97316', i1 = ink(c1), i2 = ink(c2);
    const c = { c1, c2, i1, i2, pc: i1 === '#FFFFFF' ? c1 : '#0F172A', tag: '#FFD60A', tagInk: i1 === '#FFFFFF' ? c1 : '#B91C1C' };
    const per = `${dd(d.ini)} a ${dd(d.fim)}`, itens = (d.itens || []).slice();
    const rodape = n => `<div class="fp-foot"><span>Válido de ${per} · limitado ao stock existente · imagens ilustrativas</span><span>${n}</span></div>`;
    const pags = [];
    // ---- capa: cabeçalho com a loja e as datas, o produto mais forte em grande e mais três ----
    const capa = itens.splice(0, Math.min(4, itens.length));
    const W3 = 94 / 3;
    pags.push(`<div class="fp">
      <div style="position:absolute;left:0;right:0;top:0;height:46cqw;background:${c1}"></div>
      <div style="position:absolute;right:-12cqw;top:-10cqw;width:52cqw;height:52cqw;border-radius:50%;background:${c2};opacity:.95"></div>
      <div style="position:absolute;left:5cqw;right:5cqw;top:5cqw;display:flex;align-items:center;gap:3cqw;color:${i1}">${logoHTML(l, i1, c1)}<div style="min-width:0"><div style="font:800 4.4cqw/1.12 var(--fbh)">${esc(l.nome)}</div>${l.cidade ? `<div style="font:500 3cqw var(--fbu);opacity:.85">${esc(l.cidade)}</div>` : ''}</div></div>
      <div style="position:absolute;left:5cqw;top:20cqw;color:${i1};font:800 15cqw/.9 var(--fbh);letter-spacing:-.05em;text-transform:uppercase">Promoções</div>
      <div style="position:absolute;left:5cqw;top:35cqw;background:${c.tag};color:${c.tagInk};font:800 4cqw var(--fbh);padding:1.2cqw 3cqw;border-radius:1.2cqw;transform:rotate(-2deg);text-transform:uppercase">De ${per}</div>
      ${capa[0] ? produto(capa[0], 3, 47, 94, 50, c, { lado: true, tag: 15, nome: 6, fita: 'Destaque' }).replace('border-right:.25cqw solid #E5E7EB;', '') : ''}
      ${capa.slice(1).map((it, k) => produto(it, 3 + k * W3, 98, W3, 36, c, { tag: 5.6 })).join('')}
      ${rodape(1)}</div>`);
    // ---- interior: por gama, grelha de 3 colunas; a gama com 4+ produtos abre com o mais forte em 2×2 ----
    const cats = [];
    for (const it of itens) { const k = it.cat || 'Outros'; let g = cats.find(x => x.k === k); if (!g) cats.push(g = { k, its: [] }); g.its.push(it); }
    const ord = k => { const i = ORDEM_CAT.indexOf(k); return i < 0 ? 99 : i; };
    cats.sort((a, b) => ord(a.k) - ord(b.k));
    const TOPO = 15, FUNDO = 135.5, TIT = 7, R = 37;
    let corpo = '', y = TOPO;
    const fecha = () => { if (!corpo) return; const n = pags.length + 1;
      pags.push(`<div class="fp">
        <div style="position:absolute;left:0;right:0;top:0;height:12cqw;background:${c1};color:${i1};display:flex;align-items:center;gap:2.5cqw;padding:0 3.5cqw">${logoHTML(l, i1, c1).replace('class="fp-logo"', 'class="fp-logo" style="width:7.5cqw;height:7.5cqw;font-size:3cqw"')}<div style="font:800 3.6cqw/1.1 var(--fbh);min-width:0">${esc(l.nome)}</div>
          <span style="margin-left:auto;background:${c.tag};color:${c.tagInk};font:800 3cqw var(--fbh);padding:1cqw 2.2cqw;border-radius:1cqw;white-space:nowrap;text-transform:uppercase">De ${per}</span></div>
        ${corpo}${rodape(n)}</div>`); corpo = ''; y = TOPO; };
    const titulo = k => { corpo += `<div class="fp-gama" style="top:${y}cqw;height:${TIT - 1}cqw;color:${c.pc}">${esc(k)}<i style="background:${c2}"></i></div>`; y += TIT; };
    for (const g of cats) {
      const its = g.its.slice();
      if (y + TIT + R > FUNDO) fecha();
      titulo(g.k);
      if (its.length >= 4 && y + 2 * R <= FUNDO) {
        corpo += produto(its.shift(), 3, y, 2 * W3, 2 * R, c, { tag: 11, nome: 4.6, fita: 'Destaque' });
        for (let k = 0; k < 2 && its.length; k++) corpo += produto(its.shift(), 3 + 2 * W3, y + k * R, W3, R, c, {});
        y += 2 * R;
      }
      while (its.length) {
        if (y + R > FUNDO) { fecha(); titulo(g.k + ' (cont.)'); }
        its.splice(0, 3).forEach((it, k) => { corpo += produto(it, 3 + k * W3, y, W3, R, c, {}); });
        y += R;
      }
      y += 1.5;
    }
    fecha();
    // ---- contracapa ----
    pags.push(`<div class="fp" style="background:${c1};color:${i1}">
      <div style="position:absolute;left:-14cqw;bottom:-16cqw;width:70cqw;height:70cqw;border-radius:50%;background:${c2};opacity:.95"></div>
      <div style="position:absolute;left:7cqw;right:7cqw;top:12cqw"><div style="font:800 13cqw/.95 var(--fbh);letter-spacing:-.05em;text-transform:uppercase">Até já!</div>
        <div style="font:500 4cqw/1.4 var(--fbu);margin-top:4cqw;opacity:.92">Promoções válidas de ${per}, limitadas ao stock existente. Imagens meramente ilustrativas.</div></div>
      <div style="position:absolute;left:7cqw;right:7cqw;top:62cqw;background:#fff;color:#0F172A;border-radius:3cqw;padding:5cqw;box-shadow:0 2cqw 5cqw rgba(0,0,0,.18)">
        <div style="font:800 5.2cqw/1.15 var(--fbh)">${d.inscrever ? 'Receba o folheto no WhatsApp' : d.canal ? 'Siga a loja no WhatsApp' : 'O folheto todas as semanas'}</div>
        <div style="font:500 3.3cqw/1.45 var(--fbu);color:#475569;margin-top:2cqw">${d.inscrever ? 'Abra o link do folheto nas nossas redes e toque em «Quero receber». Só enviamos o folheto da semana e pode cancelar quando quiser.' : d.canal ? 'Siga o canal da loja no WhatsApp e veja o folheto novo todas as semanas. É grátis.' : 'Siga a loja nas redes sociais e veja o folheto novo todas as semanas.'}</div></div>
      <div style="position:absolute;left:7cqw;right:7cqw;bottom:9cqw;display:flex;align-items:center;gap:3cqw;color:${i2}">${logoHTML(l, '#fff', c1)}<div><div style="font:800 4.4cqw/1.15 var(--fbh)">${esc(l.nome)}</div><div style="font:500 3cqw var(--fbu);opacity:.9">${esc([l.morada, l.cidade].filter(Boolean).join(' · '))}${l.ig ? ' · ' + esc(l.ig) : ''}</div></div></div></div>`);
    return pags;
  }

  // encaixe: nenhum nome fica cortado; se o texto não couber, o nome encolhe; a foto nunca fica com menos de 40% do produto
  function encaixar(root) {
    const cruza = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (const t of root.querySelectorAll('.fp-tile')) {
      const nome = t.querySelector('.fp-nome'), tam = t.querySelector('.fp-tam'), ph = t.querySelector('.fp-ph'), tag = t.querySelector('.fp-tag'), txt = t.querySelector('.fp-txt');
      if (!nome || !ph) continue;
      const lado = t.hasAttribute('data-lado');
      // foto que não carregou: esconde-se; ainda a carregar: volta-se a verificar quando chegar
      const fotoDe = () => { const e = ph.querySelector(':scope > img, :scope > svg, :scope > .fp-letra'); if (e && e.tagName === 'IMG') { if (e.complete && !e.naturalWidth) { e.style.display = 'none'; return null; } if (!e.complete) return null; } return e; };
      const im = fotoDe();
      // recomeçar (pode correr outra vez quando uma foto carrega)
      if (!lado && tag && tag.parentElement !== ph) { const pr = tag.parentElement; ph.appendChild(tag); if (pr.classList.contains('fp-pr')) pr.remove(); }
      ph.style.removeProperty('--fs'); if (im) { im.style.right = ''; im.style.removeProperty('width'); }
      // 1) o texto cabe: nome inteiro, nada sai do produto, a foto fica com pelo menos 36% da altura
      const textoMal = () => { const T = t.getBoundingClientRect(), P = ph.getBoundingClientRect(), G = tag?.getBoundingClientRect(), X = txt.getBoundingClientRect();
        return t.scrollHeight > t.clientHeight + 1 || nome.scrollWidth > nome.clientWidth + 1
          || (!lado && P.height < T.height * 0.36)
          || (G && (G.left < T.left - 1 || G.right > T.right + 1 || G.bottom > T.bottom + 1))
          || cruza(P, X) || cruza(G, X) || (tag && tag.parentElement !== ph && !lado && cruza(G, P)); };
      const encolher = () => { for (let k = 0; k < 18 && textoMal(); k++) {
        for (const e of [nome, tam].filter(Boolean)) e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 0.93) + 'px';
        if (k > 4 && tag) tag.style.fontSize = (parseFloat(getComputedStyle(tag).fontSize) * 0.93) + 'px'; } };
      encolher();
      // 2) a etiqueta no canto da foto não pode tapar o produto: a foto encosta à esquerda e, se preciso, encolhe até metade
      const tapa = () => !!(im && tag && tag.parentElement === ph && cruza(im.getBoundingClientRect(), tag.getBoundingClientRect()));
      if (tapa()) { im.style.right = 'auto'; if (im.tagName !== 'IMG') im.style.setProperty('width', '62%'); }
      for (let f = 94; f >= 50 && tapa(); f -= 6) ph.style.setProperty('--fs', f + '%');
      // 3) não chegou: a etiqueta passa para baixo da descrição, e o texto volta a ser verificado
      if (tapa()) { ph.style.removeProperty('--fs'); im.style.right = ''; im.style.removeProperty('width');
        const pr = document.createElement('div'); pr.className = 'fp-pr'; pr.appendChild(tag); t.insertBefore(pr, txt.nextSibling); encolher(); }
      t.dataset.encaixe = (textoMal() || tapa()) ? 'falha' : 'ok';
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
      // as fotos reais chegam depois: quando cada uma carrega, volta a verificar que a etiqueta não tapa o produto
      el.querySelectorAll('.fp-ph > img').forEach(i => { if (!i.complete) { i.addEventListener('load', () => encaixar(el), { once: true }); i.addEventListener('error', () => encaixar(el), { once: true }); } });
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
