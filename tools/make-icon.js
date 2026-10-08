// Genera los iconos PNG de IsoCity sin dependencias (rasterizador propio + zlib).
// Uso: node tools/make-icon.js
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const root = path.join(__dirname, '..');

/* ---------- PNG ---------- */
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- lienzo con antialiasing por supermuestreo ---------- */
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Float32Array(w * h * 4); }   // RGBA premultiplicado 0..1
  fillPoly(pts, [r, g, b], alpha = 1) {
    const { w, h, d } = this;
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(h - 1, Math.ceil(y1));
    const n = pts.length;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) {
          const i = (y * w + x) * 4, ia = 1 - alpha;
          d[i] = r * alpha + d[i] * ia; d[i + 1] = g * alpha + d[i + 1] * ia; d[i + 2] = b * alpha + d[i + 2] * ia; d[i + 3] = alpha + d[i + 3] * ia;
        }
      }
    }
  }
  circle(cx, cy, rx, ry, color, alpha) {
    const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    this.fillPoly(pts, color, alpha);
  }
  /** rellena todo el lienzo con f(x,y) -> [r,g,b,a] (sin compuesto: fondo) */
  paint(f) { const { w, h, d } = this; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = f(x / w, y / h); const i = (y * w + x) * 4; d[i] = r * a; d[i + 1] = g * a; d[i + 2] = b * a; d[i + 3] = a; } }
  /** reduce por factor s y devuelve Buffer RGBA recto (no premultiplicado) */
  down(s) {
    const W = this.w / s, H = this.h / s, out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const k = ((y * s + j) * this.w + x * s + i) * 4; r += this.d[k]; g += this.d[k + 1]; b += this.d[k + 2]; a += this.d[k + 3]; }
      const o = (y * W + x) * 4, n = s * s;
      r /= n; g /= n; b /= n; a /= n;
      out[o] = a > 0 ? Math.round(Math.min(1, r / a) * 255) : 0; out[o + 1] = a > 0 ? Math.round(Math.min(1, g / a) * 255) : 0; out[o + 2] = a > 0 ? Math.round(Math.min(1, b / a) * 255) : 0; out[o + 3] = Math.round(a * 255);
    }
    return { w: W, h: H, rgba: out };
  }
}

/* ---------- escena isométrica ---------- */
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const shade = (c, f) => c.map(v => Math.min(1, v * f));
const hash = (a, b) => { let h = Math.imul(a * 374761393 + b * 668265263, 1274126177); h ^= h >>> 13; return ((h * 2654435761) >>> 0) / 4294967296; };

/** Dibuja la escena en el lienzo. (cx,cy) = centro del suelo, K = escala de la casilla, H = escala de alturas. */
function scene(c, cx, cy, K) {
  const P = (u, v, z = 0) => [cx + (u - v) * K, cy + (u + v) * K / 2 - z * K / 68];
  const quad = (pts, col, a) => c.fillPoly(pts, col, a);
  const box = (u0, v0, u1, v1, z0, z1, base) => {
    const col = hex(base);
    quad([P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)], shade(col, 0.95));
    quad([P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, z1), P(u1, v1, z1)], shade(col, 0.72));
    quad([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], shade(col, 1.14));
  };
  const winsL = (u0, u1, v, z0, z1, cols, rows, seed) => {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = u0 + (u1 - u0) * (i + 0.2) / cols, b = u0 + (u1 - u0) * (i + 0.8) / cols, p = z0 + (z1 - z0) * (j + 0.25) / rows, q = z0 + (z1 - z0) * (j + 0.75) / rows;
      const lit = hash(i + seed, j) < 0.42;
      quad([P(a, v, p), P(b, v, p), P(b, v, q), P(a, v, q)], lit ? hex('#ffd98a') : hex('#bfe6fa'), lit ? 1 : 0.92);
    }
  };
  const winsR = (u, v0, v1, z0, z1, cols, rows, seed) => {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = v0 + (v1 - v0) * (i + 0.2) / cols, b = v0 + (v1 - v0) * (i + 0.8) / cols, p = z0 + (z1 - z0) * (j + 0.25) / rows, q = z0 + (z1 - z0) * (j + 0.75) / rows;
      const lit = hash(i + seed, j + 40) < 0.38;
      quad([P(u, a, p), P(u, b, p), P(u, b, q), P(u, a, q)], lit ? hex('#ffc65a') : hex('#8cc6e6'), lit ? 1 : 0.88);
    }
  };

  // sombra bajo la losa
  c.circle(cx, cy + 3.05 * K, 3.5 * K, 0.9 * K, hex('#000000'), 0.28);
  // losa de terreno (5×5)
  const S = 2.5, T = 62;
  quad([P(-S, S, 0), P(S, S, 0), P(S, S, -T), P(-S, S, -T)], hex('#7a5a3c'));
  quad([P(S, S, 0), P(S, -S, 0), P(S, -S, -T), P(S, S, -T)], hex('#5a412b'));
  quad([P(-S, S, 0), P(S, S, 0), P(S, S, -12), P(-S, S, -12)], hex('#5b9a41'));
  quad([P(S, S, 0), P(S, -S, 0), P(S, -S, -12), P(S, S, -12)], hex('#467b32'));
  quad([P(-S, -S, 0), P(S, -S, 0), P(S, S, 0), P(-S, S, 0)], hex('#7cc05c'));
  // cuadrícula de césped y calle central
  quad([P(-S, -0.3, 0), P(S, -0.3, 0), P(S, 0.3, 0), P(-S, 0.3, 0)], hex('#4a4f58'));
  quad([P(-S, -0.04, 0), P(S, -0.04, 0), P(S, 0.04, 0), P(-S, 0.04, 0)], hex('#e8e1b8'), 0.9);
  quad([P(-0.3, -S, 0), P(0.3, -S, 0), P(0.3, -0.3, 0), P(-0.3, -0.3, 0)], hex('#4a4f58'));

  // edificios (de atrás hacia delante)
  // rascacielos de cristal
  box(-1.0, -2.1, 0.4, -0.7, 0, 22, '#9aa7b3');
  box(-0.85, -1.95, 0.25, -0.85, 22, 440, '#3f7fc0');
  winsL(-0.85, 0.25, -0.85, 40, 430, 4, 11, 1);
  winsR(0.25, -1.95, -0.85, 40, 430, 4, 11, 2);
  box(-0.7, -1.8, 0.1, -1.0, 440, 470, '#56708a');
  box(-0.38, -1.5, -0.2, -1.3, 470, 535, '#aab3bc');
  // bloque residencial izquierdo
  box(-2.15, 0.45, -0.85, 1.85, 0, 210, '#e3b98f');
  box(-2.2, 0.4, -0.8, 1.9, 210, 228, '#f1e6cf');
  winsL(-2.15, -0.85, 1.85, 40, 200, 3, 4, 3);
  winsR(-0.85, 0.45, 1.85, 40, 200, 3, 4, 4);
  // tienda derecha con toldo
  box(0.9, 0.5, 2.15, 1.7, 0, 130, '#f2c05f');
  winsR(2.15, 0.5, 1.7, 30, 120, 3, 2, 5);
  for (let i = 0; i < 5; i++) {
    const a = 0.9 + i * 0.25, b = a + 0.25;
    quad([P(a, 1.7, 100), P(b, 1.7, 100), P(b, 2.05, 62), P(a, 2.05, 62)], i % 2 ? hex('#f7f7f2') : hex('#d9453a'));
  }
  quad([P(0.95, 1.7, 0), P(2.1, 1.7, 0), P(2.1, 1.7, 52), P(0.95, 1.7, 52)], hex('#bfe6fa'), 0.95);
  // árbol delantero
  const [tx, ty] = P(-0.2, 1.9, 0);
  quad([[tx - 0.05 * K, ty], [tx + 0.05 * K, ty], [tx + 0.05 * K, ty - 0.45 * K], [tx - 0.05 * K, ty - 0.45 * K]], hex('#6b4a2e'));
  c.circle(tx, ty - 0.75 * K, 0.5 * K, 0.5 * K, hex('#2f8a4a'));
  c.circle(tx - 0.12 * K, ty - 0.86 * K, 0.34 * K, 0.34 * K, hex('#58b45f'));
}

/* ---------- renderizado de cada icono ---------- */
const SS = 4;
function render(size, opts) {
  const c = new Canvas(size * SS, size * SS), N = size * SS;
  if (opts.background) c.paint((x, y) => {
    // degradado azul noche con un resplandor turquesa detrás de la ciudad
    const gx = x - 0.5, gy = y - 0.62, d = Math.sqrt(gx * gx + gy * gy * 1.2);
    const glow = Math.max(0, 1 - d / 0.62), t = (x + y) / 2;
    const base = [0.043 + 0.05 * (1 - t), 0.086 + 0.1 * (1 - t), 0.141 + 0.17 * (1 - t)];
    return [base[0] + glow * 0.04, base[1] + glow * 0.30, base[2] + glow * 0.28, 1];
  });
  // 680 de ancho a escala 1000 -> K = 68 * (N/1000) * scale
  const K = 68 * (N / 1000) * opts.scale;
  scene(c, N / 2, N * opts.cy, K);
  return c.down(SS);
}
function save(file, img) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, encodePng(img.w, img.h, img.rgba)); console.log('  ' + path.relative(root, file), img.w + 'x' + img.h); }

console.log('Generando iconos…');
// icono completo (PWA / tienda): ocupa ~68% del ancho
const full = { background: true, scale: 0.93, cy: 0.625 };
save(path.join(root, 'icons/icon-512.png'), render(512, full));
save(path.join(root, 'icons/icon-192.png'), render(192, full));
// Android adaptativo: primer plano transparente dentro de la zona segura (centro 61%)
const fg = render(432, { background: false, scale: 0.72, cy: 0.58 });
const res = path.join(root, 'android/app/src/main/res');
save(path.join(res, 'drawable-nodpi/ic_foreground.png'), fg);
// monocromo (iconos temáticos de Android 13+): silueta blanca con el alfa del primer plano
const mono = { w: fg.w, h: fg.h, rgba: Buffer.from(fg.rgba) };
for (let i = 0; i < mono.rgba.length; i += 4) { mono.rgba[i] = mono.rgba[i + 1] = mono.rgba[i + 2] = 255; }
save(path.join(res, 'drawable-nodpi/ic_monochrome.png'), mono);
