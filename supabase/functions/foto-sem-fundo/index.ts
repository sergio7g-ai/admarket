// foto-sem-fundo: recebe o endereço da foto de um produto (site da cadeia), tira o fundo branco, enquadra num quadrado
// 600×600 transparente e guarda no Storage público "fotos-produtos". Cada foto é processada uma única vez (cache).
// 0 tokens de IA: as fotos dos sites estão sobre fundo branco, por isso basta encher o fundo a partir das bordas.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image, decode } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
};
const HOSTS = /(^|\.)(continente\.pt|pingodoce\.pt|auchan\.pt|lidl\.pt|googleusercontent\.com|ipaper\.io)$/;

async function hash(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// mesmo algoritmo da biblioteca de fotos da app: fundo = branco ligado às bordas (+ buracos brancos fechados)
function semFundo(img: Image) {
  const W = img.width, H = img.height, d = img.bitmap, bg = new Uint8Array(W * H), st: number[] = [];
  const isBg = (i: number) => { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mn = Math.min(r, g, b), mx = Math.max(r, g, b); return d[i * 4 + 3] < 20 || (mn >= 240 && mx - mn < 12); };
  for (let X = 0; X < W; X++) st.push(X, (H - 1) * W + X);
  for (let Y = 0; Y < H; Y++) st.push(Y * W, Y * W + W - 1);
  while (st.length) {
    const i = st.pop()!; if (bg[i] || !isBg(i)) continue; bg[i] = 1;
    const X = i % W, Y = (i / W) | 0;
    if (X > 0) st.push(i - 1); if (X < W - 1) st.push(i + 1); if (Y > 0) st.push(i - W); if (Y < H - 1) st.push(i + W);
  }
  const borda = bg.reduce((a, v) => a + v, 0) / (W * H);
  if (borda < 0.05) return null;                      // não tem fundo branco: não mexer
  const pure = (i: number) => { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; return Math.min(r, g, b) >= 250 && Math.max(r, g, b) - Math.min(r, g, b) < 5; };
  const seen = new Uint8Array(W * H);
  for (let s0 = 0; s0 < W * H; s0++) {
    if (bg[s0] || seen[s0] || !pure(s0)) continue;
    const reg: number[] = [], q = [s0]; seen[s0] = 1; let edge = 0, neutral = 0;
    while (q.length) {
      const i = q.pop()!; reg.push(i); const X = i % W, Y = (i / W) | 0;
      for (const n of [X > 0 ? i - 1 : -1, X < W - 1 ? i + 1 : -1, Y > 0 ? i - W : -1, Y < H - 1 ? i + W : -1]) {
        if (n < 0 || seen[n] || bg[n]) continue;
        if (pure(n)) { seen[n] = 1; q.push(n); }
        else { edge++; const r = d[n * 4], g = d[n * 4 + 1], b = d[n * 4 + 2], mn = Math.min(r, g, b), mx = Math.max(r, g, b); if (mn >= 170 && mx - mn < 7) neutral++; }
      }
    }
    if (reg.length > W * H * 0.004 && edge && neutral / edge > 0.9) for (const i of reg) bg[i] = 1;
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const i = Y * W + X;
    if (bg[i]) { d[i * 4 + 3] = 0; continue; }
    const nb = (X > 0 && bg[i - 1]) || (X < W - 1 && bg[i + 1]) || (Y > 0 && bg[i - W]) || (Y < H - 1 && bg[i + W]);
    if (nb) { const mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); if (mn > 232) d[i * 4 + 3] = Math.max(90, 255 - (mn - 232) * 12); }
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, S = 600, pad = 0.08, k = Math.min(S * (1 - 2 * pad) / cw, S * (1 - 2 * pad) / ch);
  const recorte = img.clone().crop(x0, y0, cw, ch).resize(Math.max(1, Math.round(cw * k)), Math.max(1, Math.round(ch * k)));
  const out = new Image(S, S); out.fill(0x00000000);
  out.composite(recorte, Math.round((S - recorte.width) / 2), Math.round((S - recorte.height) / 2));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  let body: any = {}; try { body = await req.json(); } catch (_) { /* */ }
  const urls: string[] = (Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : []).slice(0, 6);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const out: Record<string, string | null> = {};
  for (const u of urls) {
    try {
      const host = new URL(u).hostname;
      if (!HOSTS.test(host)) { out[u] = null; continue; }
      const { data: ja } = await sb.from('fotos_sem_fundo').select('url').eq('origem', u).maybeSingle();
      if (ja) { out[u] = ja.url; continue; }
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; admarket/1.0)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const img = await decode(new Uint8Array(await r.arrayBuffer())) as Image;
      if (!img || !(img instanceof Image)) throw new Error('formato');
      if (img.width > 900 || img.height > 900) img.resize(img.width >= img.height ? 900 : Image.RESIZE_AUTO, img.height > img.width ? 900 : Image.RESIZE_AUTO);
      const sf = semFundo(img);
      let pub: string | null = null;
      if (sf) {
        const nome = (await hash(u)) + '.png';
        const { error } = await sb.storage.from('fotos-produtos').upload(nome, await sf.encode(), { contentType: 'image/png', upsert: true });
        if (error) throw error;
        pub = sb.storage.from('fotos-produtos').getPublicUrl(nome).data.publicUrl;
      }
      await sb.from('fotos_sem_fundo').upsert({ origem: u, url: pub });
      out[u] = pub;
    } catch (e) { console.log('foto', u, String((e as Error).message || e)); out[u] = null; }
  }
  return json({ ok: true, fotos: out });
});
