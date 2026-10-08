'use strict';
/* ==========================================================================
   Sprites procedurales isométricos. Todo se dibuja con primitivas de canvas.
   Coordenadas de los constructores: (u,v) en tiles desde la esquina superior
   del solar, z en píxeles de altura.
   ========================================================================== */
const Sprites = (() => {
  const cache = new Map();
  let lightMode = false, seed = 0, litDrawn = false;

  const P = (u, v, z = 0) => [(u - v) * TW / 2, (u + v) * TH / 2 - z];

  function rgb(h) {
    if (h[0] === '#') {
      if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
      return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
    }
    const m = h.match(/\d+/g); return [+m[0], +m[1], +m[2]];
  }
  function shade(h, f) {
    const [r, g, b] = rgb(h);
    return `rgb(${clamp(Math.round(r * f), 0, 255)},${clamp(Math.round(g * f), 0, 255)},${clamp(Math.round(b * f), 0, 255)})`;
  }
  function mat(h) { return { t: shade(h, 1.13), l: shade(h, 0.95), r: shade(h, 0.72), e: 'rgba(20,24,34,0.34)', b: h }; }

  /* ---------- primitivas ---------- */
  function poly(c, pts, fill, stroke, lw) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke && !lightMode) { c.strokeStyle = stroke; c.lineWidth = lw || 0.7; c.lineJoin = 'round'; c.stroke(); }
  }
  function box(c, u0, v0, u1, v1, z0, z1, m) {
    poly(c, [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)], m.l, m.e);
    poly(c, [P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, z1), P(u1, v1, z1)], m.r, m.e);
    poly(c, [P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], m.t, m.e);
  }
  function flat(c, u0, v0, u1, v1, z, fill, stroke) {
    poly(c, [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], fill, stroke);
  }
  function win(c, pts, col, k) {
    if (lightMode) {
      if (hash2(k, seed, 77) < 0.55) {
        litDrawn = true;
        c.globalCompositeOperation = 'source-over';
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.closePath(); c.fillStyle = 'rgba(255,214,120,1)'; c.fill();
        c.globalCompositeOperation = 'destination-out';
      }
      return;
    }
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath(); c.fillStyle = col; c.fill();
    c.strokeStyle = 'rgba(15,25,40,0.35)'; c.lineWidth = 0.5; c.stroke();
  }
  function winL(c, u0, u1, v, z0, z1, col, k) { win(c, [P(u0, v, z0), P(u1, v, z0), P(u1, v, z1), P(u0, v, z1)], col, k); }
  function winR(c, u, v0, v1, z0, z1, col, k) { win(c, [P(u, v0, z0), P(u, v1, z0), P(u, v1, z1), P(u, v0, z1)], col, k + 5000); }
  function winGridL(c, u0, u1, v, z0, z1, cols, rows, col, mx = 0.2, my = 0.22) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = u0 + (u1 - u0) * (i + mx) / cols, b = u0 + (u1 - u0) * (i + 1 - mx) / cols;
      const p = z0 + (z1 - z0) * (j + my) / rows, q = z0 + (z1 - z0) * (j + 1 - my) / rows;
      winL(c, a, b, v, p, q, col, i * 31 + j * 7 + 1);
    }
  }
  function winGridR(c, u, v0, v1, z0, z1, cols, rows, col, mx = 0.2, my = 0.22) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const a = v0 + (v1 - v0) * (i + mx) / cols, b = v0 + (v1 - v0) * (i + 1 - mx) / cols;
      const p = z0 + (z1 - z0) * (j + my) / rows, q = z0 + (z1 - z0) * (j + 1 - my) / rows;
      winR(c, u, a, b, p, q, col, i * 29 + j * 11 + 3);
    }
  }
  function doorL(c, u0, u1, v, z1, col) { poly(c, [P(u0, v, 0), P(u1, v, 0), P(u1, v, z1), P(u0, v, z1)], col || '#6e4a32', 'rgba(0,0,0,0.3)'); }
  function doorR(c, u, v0, v1, z1, col) { poly(c, [P(u, v0, 0), P(u, v1, 0), P(u, v1, z1), P(u, v0, z1)], col || '#5a3b27', 'rgba(0,0,0,0.3)'); }

  // tejado a dos aguas con cumbrera a lo largo de u
  function gableU(c, u0, v0, u1, v1, z, hr, m, wall) {
    const vm = (v0 + v1) / 2;
    // la vertiente trasera queda oculta tras la cumbrera
    poly(c, [P(u0, v1, z), P(u1, v1, z), P(u1, vm, z + hr), P(u0, vm, z + hr)], m.l, m.e);
    poly(c, [P(u1, v1, z), P(u1, v0, z), P(u1, vm, z + hr)], wall.r, wall.e);
  }
  // cumbrera a lo largo de v
  function gableV(c, u0, v0, u1, v1, z, hr, m, wall) {
    const um = (u0 + u1) / 2;
    poly(c, [P(u0, v1, z), P(u1, v1, z), P(um, v1, z + hr)], wall.l, wall.e);
    poly(c, [P(u1, v1, z), P(u1, v0, z), P(um, v0, z + hr), P(um, v1, z + hr)], m.r, m.e);
  }
  function pyramid(c, u0, v0, u1, v1, z, hr, m) {
    const a = P((u0 + u1) / 2, (v0 + v1) / 2, z + hr);
    poly(c, [P(u0, v1, z), P(u1, v1, z), a], m.l, m.e);
    poly(c, [P(u1, v1, z), P(u1, v0, z), a], m.r, m.e);
  }
  function cyl(c, u, v, r, z0, z1, m, top) {
    const [cx, cy0] = P(u, v, z0), cy1 = P(u, v, z1)[1];
    const rx = r * TW * 0.7071, ry = r * TH * 0.7071;
    const g = c.createLinearGradient(cx - rx, 0, cx + rx, 0);
    g.addColorStop(0, m.l); g.addColorStop(0.35, m.t); g.addColorStop(1, m.r);
    c.beginPath(); c.moveTo(cx - rx, cy1); c.lineTo(cx - rx, cy0);
    c.ellipse(cx, cy0, rx, ry, 0, Math.PI, 0, true);
    c.lineTo(cx + rx, cy1);
    c.ellipse(cx, cy1, rx, ry, 0, 0, Math.PI, false);
    c.closePath(); c.fillStyle = g; c.fill();
    c.strokeStyle = m.e; c.lineWidth = 0.6; c.stroke();
    if (top !== false) {
      c.beginPath(); c.ellipse(cx, cy1, rx, ry, 0, 0, Math.PI * 2);
      c.fillStyle = top || m.t; c.fill(); c.stroke();
    }
  }
  function ell(c, u, v, r, z, fill, stroke) {
    const [cx, cy] = P(u, v, z);
    c.beginPath(); c.ellipse(cx, cy, r * TW * 0.7071, r * TH * 0.7071, 0, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.7; c.stroke(); }
  }
  function dome(c, u, v, r, z, m) {
    const [cx, cy] = P(u, v, z);
    const rx = r * TW * 0.7071, ry = r * TH * 0.7071;
    const g = c.createRadialGradient(cx - rx * 0.35, cy - rx * 0.6, rx * 0.1, cx, cy - rx * 0.2, rx * 1.2);
    g.addColorStop(0, m.t); g.addColorStop(0.55, m.l); g.addColorStop(1, m.r);
    c.beginPath(); c.ellipse(cx, cy, rx, rx * 0.95, 0, Math.PI, 0, false);
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false); c.closePath();
    c.fillStyle = g; c.fill(); c.strokeStyle = m.e; c.lineWidth = 0.6; c.stroke();
  }
  function coolTower(c, u, v, r, z0, z1, m) {
    const [cx, cy0] = P(u, v, z0);
    const H = z1 - z0, rxB = r * TW * 0.7071, ryB = r * TH * 0.7071;
    const rad = t => 0.74 + 0.26 * Math.pow(1 - t, 2.2) + 0.1 * t * t;
    const g = c.createLinearGradient(cx - rxB, 0, cx + rxB, 0);
    g.addColorStop(0, m.l); g.addColorStop(0.4, m.t); g.addColorStop(1, m.r);
    c.beginPath(); c.moveTo(cx - rxB, cy0);
    const n = 14;
    for (let i = 1; i <= n; i++) { const t = i / n; c.lineTo(cx - rxB * rad(t), cy0 - H * t); }
    for (let i = n; i >= 0; i--) { const t = i / n; c.lineTo(cx + rxB * rad(t), cy0 - H * t); }
    c.ellipse(cx, cy0, rxB, ryB, 0, 0, Math.PI, false);
    c.closePath(); c.fillStyle = g; c.fill(); c.strokeStyle = m.e; c.lineWidth = 0.6; c.stroke();
    const rt = rad(1);
    c.beginPath(); c.ellipse(cx, cy0 - H, rxB * rt, ryB * rt, 0, 0, Math.PI * 2);
    c.fillStyle = '#6b7380'; c.fill(); c.stroke();
  }
  function stripedStack(c, u, v, r, z0, z1, m1, m2, bands) {
    const h = (z1 - z0) / bands;
    for (let i = 0; i < bands; i++) cyl(c, u, v, r, z0 + h * i, z0 + h * (i + 1), i % 2 ? m2 : m1, i === bands - 1 ? '#3a3f47' : false);
  }
  function lawn(c, w, d, col, inset = 0.05) { flat(c, inset, inset, w - inset, d - inset, 0, col || '#8cc063', 'rgba(0,0,0,0.12)'); }
  function pave(c, u0, v0, u1, v1, col) { flat(c, u0, v0, u1, v1, 0, col || '#cfcabd', 'rgba(0,0,0,0.12)'); }
  function dot(c, u, v, col, r = 1.8) {
    const [x, y] = P(u, v, 0); c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = col; c.fill();
  }
  function line(c, a, b, col, w) {
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.strokeStyle = col; c.lineWidth = w || 1; c.stroke();
  }

  /* ---------- árboles ---------- */
  function treeShape(c, x, y, kind, s, tint) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(2, 1, 9, 4.5, 0, 0, 7); c.fill();
    if (kind === 0) {                       // pino
      c.fillStyle = '#6b4a2e'; c.fillRect(-1.5, -7, 3, 8);
      const cols = [['#2f7d49', '#25663b'], ['#38905a', '#2b7a47'], ['#44a468', '#33895a']];
      for (let i = 0; i < 3; i++) {
        const by = -5 - i * 9, hw = 11 - i * 2.6, top = by - 14;
        c.fillStyle = cols[i][0]; c.beginPath(); c.moveTo(-hw, by); c.lineTo(0, top); c.lineTo(0, by); c.closePath(); c.fill();
        c.fillStyle = cols[i][1]; c.beginPath(); c.moveTo(hw, by); c.lineTo(0, top); c.lineTo(0, by); c.closePath(); c.fill();
      }
    } else if (kind === 1) {                // roble
      c.fillStyle = '#6b4a2e'; c.fillRect(-2, -12, 4, 13);
      const g = tint || '#4f9b45';
      const blobs = [[-6, -17, 8], [6, -17, 8], [0, -24, 9], [0, -15, 9]];
      for (const [bx, by, br] of blobs) { c.fillStyle = shade(g, 0.78); c.beginPath(); c.arc(bx + 1, by + 1.5, br, 0, 7); c.fill(); }
      for (const [bx, by, br] of blobs) { c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill(); }
      c.fillStyle = shade(g, 1.2); c.beginPath(); c.arc(-3, -27, 4.5, 0, 7); c.fill();
    } else if (kind === 2) {                // arbusto
      const g = tint || '#58a64d';
      for (const [bx, by, br] of [[-5, -4, 5.5], [5, -4, 5.5], [0, -8, 6]]) { c.fillStyle = shade(g, 0.8); c.beginPath(); c.arc(bx + 1, by + 1, br, 0, 7); c.fill(); }
      for (const [bx, by, br] of [[-5, -4, 5.5], [5, -4, 5.5], [0, -8, 6]]) { c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill(); }
    } else {                                // palmera
      c.strokeStyle = '#8a6a43'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(4, -14, 1, -28); c.stroke();
      c.fillStyle = '#3f9a4f';
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + 0.3;
        c.beginPath(); c.moveTo(1, -28);
        c.quadraticCurveTo(1 + Math.cos(a) * 9, -28 - 8 + Math.sin(a) * 3, 1 + Math.cos(a) * 14, -28 + 4 + Math.sin(a) * 6);
        c.quadraticCurveTo(1 + Math.cos(a) * 8, -28 - 2 + Math.sin(a) * 3, 1, -28); c.fill();
      }
    }
    c.restore();
  }
  function treeSprite(kind, variant) {
    const key = `tree${kind}_${variant}`;
    let e = cache.get(key); if (e) return e;
    const cv = document.createElement('canvas'); cv.width = 48 * SPR; cv.height = 64 * SPR;
    const c = cv.getContext('2d'); c.scale(SPR, SPR);
    const tints = ['#4f9b45', '#5aa84c', '#468f40', '#68ad4a'];
    treeShape(c, 24, 54, kind, 1, tints[variant % 4]);
    e = { c: cv, ox: 24 * SPR, oy: 54 * SPR }; cache.set(key, e); return e;
  }

  /* ---------- suelo ---------- */
  function newCanvas(w, h) { const cv = document.createElement('canvas'); cv.width = Math.ceil(w * SPR); cv.height = Math.ceil(h * SPR); const c = cv.getContext('2d'); c.scale(SPR, SPR); return [cv, c]; }
  const TOPX = TW / 2 + 2, TOPY = 2;
  function diamondPath(c, e) {
    c.beginPath();
    c.moveTo(TOPX, TOPY - e); c.lineTo(TOPX + TW / 2 + e, TOPY + TH / 2); c.lineTo(TOPX, TOPY + TH + e); c.lineTo(TOPX - TW / 2 - e, TOPY + TH / 2); c.closePath();
  }
  const GRASS = ['#78b95a', '#74b556', '#7cbd5d', '#71b154'];
  function groundTile(kind, v) {
    const key = `g_${kind}_${v}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4);
    diamondPath(c, 0.8);
    if (kind === 'sand') c.fillStyle = ['#e6d39d', '#e1cd95', '#e9d8a5', '#decb92'][v % 4];
    else c.fillStyle = GRASS[v % 4];
    c.fill();
    c.save(); diamondPath(c, 0); c.clip();
    const r = mulberry32(v * 977 + (kind === 'sand' ? 5 : 11));
    for (let i = 0; i < 9; i++) {
      const px = TOPX + (r() - 0.5) * TW * 0.8, py = TOPY + TH / 2 + (r() - 0.5) * TH * 0.8;
      if (kind === 'sand') { c.fillStyle = r() < 0.5 ? 'rgba(160,130,70,0.25)' : 'rgba(255,255,230,0.3)'; c.fillRect(px, py, 1.6, 1.2); }
      else {
        c.fillStyle = r() < 0.5 ? 'rgba(40,110,40,0.22)' : 'rgba(200,240,150,0.25)';
        c.fillRect(px, py, 1.2, 2.4);
      }
    }
    c.restore();
    e = { c: cv, ox: TOPX * SPR, oy: TOPY * SPR }; cache.set(key, e); return e;
  }
  function waterTile(mask) {
    const key = `w_${mask}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4);
    diamondPath(c, 0.8);
    const g = c.createLinearGradient(0, TOPY, 0, TOPY + TH);
    g.addColorStop(0, '#3f97d6'); g.addColorStop(1, '#2f80c4');
    c.fillStyle = g; c.fill();
    // bordes con tierra: espuma clara (dirs en pantalla: 0:+u 1:+v 2:-u 3:-v)
    const strips = [
      [[1, 0], [1, 1], [0.8, 1], [0.8, 0]], [[0, 1], [1, 1], [1, 0.8], [0, 0.8]],
      [[0, 0], [0, 1], [0.2, 1], [0.2, 0]], [[0, 0], [1, 0], [1, 0.2], [0, 0.2]],
    ];
    c.save(); diamondPath(c, 0); c.clip(); c.translate(TOPX, TOPY);
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) {
      const s = strips[d].map(([u, v]) => P(u, v, 0));
      c.beginPath(); c.moveTo(s[0][0], s[0][1]); for (let i = 1; i < 4; i++) c.lineTo(s[i][0], s[i][1]); c.closePath();
      c.fillStyle = 'rgba(190,240,245,0.55)'; c.fill();
      const q = [[[1, 0], [1, 1]], [[0, 1], [1, 1]], [[0, 0], [0, 1]], [[0, 0], [1, 0]]][d].map(([u, v]) => P(u, v, 0));
      c.beginPath(); c.moveTo(q[0][0], q[0][1]); c.lineTo(q[1][0], q[1][1]); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.4; c.stroke();
    }
    c.restore();
    e = { c: cv, ox: TOPX * SPR, oy: TOPY * SPR }; cache.set(key, e); return e;
  }
  function rippleTile(v) {
    const key = `rip_${v}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4);
    c.save(); diamondPath(c, 0); c.clip();
    const r = mulberry32(v * 31 + 7);
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const px = TOPX + (r() - 0.5) * TW * 0.55, py = TOPY + TH / 2 + (r() - 0.5) * TH * 0.5, l = 4 + r() * 6;
      c.beginPath(); c.moveTo(px - l, py); c.quadraticCurveTo(px, py - 2, px + l, py); c.stroke();
    }
    c.restore();
    e = { c: cv, ox: TOPX * SPR, oy: TOPY * SPR }; cache.set(key, e); return e;
  }
  function zoneTile(z) {
    const key = `zone${z}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4);
    const col = ZONE_INFO[z].color;
    diamondPath(c, 0.4); c.fillStyle = col; c.globalAlpha = 0.34; c.fill(); c.globalAlpha = 1;
    c.save(); c.translate(TOPX, TOPY);
    const q = [P(0.07, 0.07), P(0.93, 0.07), P(0.93, 0.93), P(0.07, 0.93)];
    c.beginPath(); c.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) c.lineTo(q[i][0], q[i][1]); c.closePath();
    c.strokeStyle = col; c.globalAlpha = 0.85; c.lineWidth = 1.2; c.stroke();
    c.restore();
    e = { c: cv, ox: TOPX * SPR, oy: TOPY * SPR }; cache.set(key, e); return e;
  }
  function plainDiamond(color, alpha) {
    const key = `dia_${color}_${alpha}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4);
    diamondPath(c, 0.4); c.fillStyle = color; c.globalAlpha = alpha; c.fill();
    e = { c: cv, ox: TOPX * SPR, oy: TOPY * SPR }; cache.set(key, e); return e;
  }

  /* ---------- carreteras ---------- */
  // mask en direcciones de PANTALLA: bit0 +u, bit1 +v, bit2 -u, bit3 -v
  function roadTile(type, mask, bg) {
    const key = `r_${type}_${mask}_${bg}`; let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(TW + 4, TH + 4 + 12);
    c.translate(0, 8);
    // fondo
    diamondPath(c, 0.8);
    c.fillStyle = bg === 'w' ? '#3a8ccf' : bg === 's' ? '#e3d09a' : '#78b95a'; c.fill();
    c.save(); c.translate(TOPX, TOPY);
    const hw = type === 2 ? 0.3 : 0.2, sw = hw + 0.075;
    const arms = [[0.5, 1, 0.5 - 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const rect = (d, h) => {
      switch (d) {
        case 0: return [0.5, 0.5 - h, 1.001, 0.5 + h];
        case 1: return [0.5 - h, 0.5, 0.5 + h, 1.001];
        case 2: return [-0.001, 0.5 - h, 0.5, 0.5 + h];
        default: return [0.5 - h, -0.001, 0.5 + h, 0.5];
      }
    };
    const paint = (h, col, z, stroke) => {
      const list = [];
      for (let d = 0; d < 4; d++) if (mask & (1 << d)) list.push(rect(d, h));
      list.push([0.5 - h, 0.5 - h, 0.5 + h, 0.5 + h]);
      for (const [u0, v0, u1, v1] of list) {
        c.beginPath();
        const a = P(u0, v0, z), b = P(u1, v0, z), cc = P(u1, v1, z), dd = P(u0, v1, z);
        c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(cc[0], cc[1]); c.lineTo(dd[0], dd[1]); c.closePath();
        c.fillStyle = col; c.fill();
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.5; c.stroke(); }
      }
    };
    if (bg === 'w') {
      // puente: tablero elevado con caras laterales
      const Hd = 6;
      const order = [3, 2, 'c', 1, 0];
      for (const d of order) {
        let r0;
        if (d === 'c') r0 = [0.5 - sw, 0.5 - sw, 0.5 + sw, 0.5 + sw];
        else { if (!(mask & (1 << d))) continue; r0 = rect(d, sw); }
        box(c, r0[0], r0[1], r0[2], r0[3], 0, Hd, mat('#9aa0a8'));
      }
      paint(hw, type === 2 ? '#3f444d' : '#4a4f58', Hd);
    } else {
      paint(sw, '#bcb9ad', 0, 'rgba(0,0,0,0.12)');
      paint(hw, type === 2 ? '#3f444d' : '#4a4f58', 0);
    }
    // marcas viales
    const zr = bg === 'w' ? 6 : 0;
    const nArms = [0, 1, 2, 3].filter(d => mask & (1 << d)).length;
    // franja alineada con la cuadrícula: a = distancia desde el centro a lo largo del brazo, o = desplazamiento lateral
    const strip = (d, a0, a1, o0, o1, col) => {
      let q;
      switch (d) {
        case 0: q = [[0.5 + a0, 0.5 + o0], [0.5 + a1, 0.5 + o0], [0.5 + a1, 0.5 + o1], [0.5 + a0, 0.5 + o1]]; break;
        case 1: q = [[0.5 + o0, 0.5 + a0], [0.5 + o0, 0.5 + a1], [0.5 + o1, 0.5 + a1], [0.5 + o1, 0.5 + a0]]; break;
        case 2: q = [[0.5 - a0, 0.5 + o0], [0.5 - a1, 0.5 + o0], [0.5 - a1, 0.5 + o1], [0.5 - a0, 0.5 + o1]]; break;
        default: q = [[0.5 + o0, 0.5 - a0], [0.5 + o0, 0.5 - a1], [0.5 + o1, 0.5 - a1], [0.5 + o1, 0.5 - a0]];
      }
      c.beginPath();
      q.forEach(([u, v], i) => { const p = P(u, v, zr); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
      c.closePath(); c.fillStyle = col; c.fill();
    };
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) {
      if (type === 2) {
        strip(d, hw + 0.02, 0.5, -0.03, -0.012, '#e8c24a'); strip(d, hw + 0.02, 0.5, 0.012, 0.03, '#e8c24a');
        strip(d, 0.3, 0.4, hw * 0.5 - 0.01, hw * 0.5 + 0.01, '#e8e8e8'); strip(d, 0.3, 0.4, -hw * 0.5 - 0.01, -hw * 0.5 + 0.01, '#e8e8e8');
      } else {
        strip(d, 0.3, 0.38, -0.012, 0.012, '#e8e1b8'); strip(d, 0.44, 0.5, -0.012, 0.012, '#e8e1b8');
      }
      if (nArms >= 3) {
        for (let k = 0; k < 5; k++) { const o = -hw * 0.8 + k * hw * 0.4; strip(d, hw + 0.03, hw + 0.11, o - 0.03, o + 0.03, 'rgba(240,240,240,0.88)'); }
      }
    }
    c.restore();
    e = { c: cv, ox: TOPX * SPR, oy: (TOPY + 8) * SPR }; cache.set(key, e); return e;
  }

  /* ---------- paletas ---------- */
  const WALL1 = ['#f3e6c8', '#ecd0a6', '#dbe8f1', '#f5d8d2', '#d3e6c6', '#f0e3ac'];
  const ROOF1 = ['#b5523b', '#7d5a45', '#4f6a8a', '#8a3f3f'];
  const GLASS = '#8ccbec';

  /* ---------- constructores de edificios ---------- */
  const B = {}, H = {};

  // --- Residencial ---
  H.R1 = 46;
  B.R1 = (c, w, d, v) => {
    const wall = mat(WALL1[v % 6]), roof = mat(ROOF1[(v >> 1) % 4]);
    lawn(c, 1, 1, '#8fc366', 0.06);
    pave(c, 0.45, 0.66, 0.56, 0.94, '#d9d2c2');
    dot(c, 0.2, 0.84, '#ff7a90'); dot(c, 0.3, 0.9, '#ffd24a'); dot(c, 0.84, 0.86, '#ff7a90'); dot(c, 0.74, 0.9, '#fff');
    box(c, 0.2, 0.18, 0.78, 0.66, 0, 15, wall);
    winL(c, 0.27, 0.4, 0.66, 5, 12, GLASS, 1); winL(c, 0.62, 0.73, 0.66, 5, 12, GLASS, 2);
    doorL(c, 0.455, 0.545, 0.66, 11);
    winR(c, 0.78, 0.28, 0.54, 5, 12, GLASS, 3);
    if (v % 2) gableU(c, 0.15, 0.13, 0.83, 0.71, 15, 10, roof, wall); else gableV(c, 0.15, 0.13, 0.83, 0.71, 15, 10, roof, wall);
    box(c, 0.6, 0.25, 0.68, 0.33, 19, 28, mat('#9c6b55'));
  };
  H.R2 = 70;
  B.R2 = (c, w, d, v) => {
    const wall = mat(['#d9b99b', '#cbb8a4', '#c9a58d', '#bfc7cf'][v % 4]);
    pave(c, 0.04, 0.04, 0.96, 0.96, '#c7c3b7');
    box(c, 0.13, 0.15, 0.87, 0.85, 0, 38, wall);
    box(c, 0.11, 0.13, 0.89, 0.87, 38, 41, mat('#ebe4d6'));
    winGridL(c, 0.13, 0.87, 0.85, 13, 36, 4, 3, GLASS, 0.2, 0.2);
    winGridR(c, 0.87, 0.15, 0.85, 13, 36, 4, 3, '#78b4da', 0.2, 0.2);
    doorL(c, 0.44, 0.56, 0.85, 10, '#4b6a8a');
    poly(c, [P(0.4, 0.85, 12), P(0.6, 0.85, 12), P(0.6, 0.93, 9), P(0.4, 0.93, 9)], '#c0504a', 'rgba(0,0,0,0.25)');
    box(c, 0.5, 0.3, 0.72, 0.5, 41, 49, mat('#b8b2a6'));
    box(c, 0.22, 0.55, 0.32, 0.66, 41, 46, mat('#9aa3ab'));
    dot(c, 0.2, 0.92, '#6fb25a', 3); dot(c, 0.8, 0.92, '#6fb25a', 3);
  };
  H.R3 = 124;
  B.R3 = (c, w, d, v) => {
    const m = mat(['#c9d3dc', '#d9d1c4', '#b8c6d4', '#cdbfd0'][v % 4]);
    pave(c, 0.03, 0.03, 0.97, 0.97, '#bdb9ae');
    dot(c, 0.12, 0.92, '#5fae55', 3.2); dot(c, 0.9, 0.92, '#5fae55', 3.2); dot(c, 0.12, 0.2, '#5fae55', 3.2);
    box(c, 0.1, 0.12, 0.9, 0.9, 0, 7, mat('#a8a79f'));
    box(c, 0.2, 0.22, 0.8, 0.8, 7, 84, m);
    winGridL(c, 0.2, 0.8, 0.8, 13, 82, 5, 10, '#79b3da', 0.2, 0.2);
    winGridR(c, 0.8, 0.22, 0.8, 13, 82, 5, 10, '#629fca', 0.2, 0.2);
    box(c, 0.27, 0.3, 0.73, 0.72, 84, 92, mat('#aeb8c2'));
    box(c, 0.42, 0.44, 0.58, 0.58, 92, 98, mat('#d95b50'));
    line(c, P(0.5, 0.51, 98), P(0.5, 0.51, 118), '#6a7078', 1.2);
  };

  // --- Comercial ---
  H.C1 = 52;
  B.C1 = (c, w, d, v) => {
    const col = ['#f5c36b', '#8fd3c9', '#f2a6a0', '#b8dd98'][v % 4];
    pave(c, 0.03, 0.03, 0.97, 0.97, '#cfc9bb');
    box(c, 0.1, 0.2, 0.9, 0.76, 0, 18, mat(col));
    winGridL(c, 0.16, 0.84, 0.76, 3, 11, 3, 1, '#c3e8f8', 0.12, 0.1);
    winGridR(c, 0.9, 0.24, 0.72, 5, 14, 2, 1, '#bfe3f4', 0.2, 0.1);
    const aw = ['#d9453a', '#2f7cc4', '#2f9d5a', '#e08a22'][v % 4];
    for (let i = 0; i < 6; i++) {
      const a = 0.14 + i * 0.12, b = a + 0.12;
      poly(c, [P(a, 0.76, 13), P(b, 0.76, 13), P(b, 0.94, 8), P(a, 0.94, 8)], i % 2 ? '#f4f4f0' : aw, 'rgba(0,0,0,0.2)');
    }
    box(c, 0.28, 0.3, 0.72, 0.36, 18, 25, mat('#f1f1ee'));
    poly(c, [P(0.28, 0.36, 19), P(0.72, 0.36, 19), P(0.72, 0.36, 24), P(0.28, 0.36, 24)], aw, null);
    box(c, 0.68, 0.5, 0.84, 0.64, 18, 22, mat('#a5adb5'));
    box(c, 0.8, 0.84, 0.9, 0.94, 0, 5, mat('#b98b4e'));
  };
  H.C2 = 84;
  B.C2 = (c, w, d, v) => {
    const wall = mat(['#c9d3dc', '#d4c4a8', '#aab7c4'][v % 3]);
    pave(c, 0.03, 0.03, 0.97, 0.97, '#c5c1b5');
    box(c, 0.08, 0.1, 0.92, 0.9, 0, 38, wall);
    winGridL(c, 0.08, 0.92, 0.9, 6, 35, 6, 2, '#9ed3ee', 0.12, 0.14);
    winGridR(c, 0.92, 0.1, 0.9, 6, 35, 5, 2, '#86bddb', 0.12, 0.14);
    box(c, 0.35, 0.9, 0.65, 0.98, 0, 12, mat('#4a6a8a'));
    poly(c, [P(0.35, 0.98, 12), P(0.65, 0.98, 12), P(0.65, 0.98, 4), P(0.35, 0.98, 4)], '#9ed3ee', null);
    box(c, 0.16, 0.18, 0.84, 0.26, 38, 52, mat('#e9e9e4'));
    const sc = ['#e0533d', '#2f7cc4', '#2f9d5a'][v % 3];
    poly(c, [P(0.2, 0.26, 40), P(0.8, 0.26, 40), P(0.8, 0.26, 50), P(0.2, 0.26, 50)], sc, null);
    box(c, 0.3, 0.45, 0.46, 0.6, 38, 45, mat('#9aa3ab'));
    box(c, 0.6, 0.5, 0.78, 0.7, 38, 43, mat('#9aa3ab'));
  };
  H.C3 = 156;
  B.C3 = (c, w, d, v) => {
    const wall = ['#4a7fb5', '#3f8f9a', '#5a6fb0', '#2f6f8f'][v % 4];
    pave(c, 0.03, 0.03, 0.97, 0.97, '#b8b5ab');
    dot(c, 0.1, 0.9, '#5fae55', 3.2); dot(c, 0.92, 0.9, '#5fae55', 3.2);
    box(c, 0.08, 0.1, 0.92, 0.92, 0, 12, mat('#8e9aa6'));
    winGridL(c, 0.08, 0.92, 0.92, 2, 10, 7, 1, '#c8ecfa', 0.12, 0.12);
    box(c, 0.2, 0.22, 0.8, 0.8, 12, 108, mat(wall));
    winGridL(c, 0.2, 0.8, 0.8, 16, 106, 4, 15, '#a8dcf6', 0.14, 0.2);
    winGridR(c, 0.8, 0.22, 0.8, 16, 106, 4, 15, '#8cc6e6', 0.14, 0.2);
    box(c, 0.3, 0.32, 0.7, 0.7, 108, 116, mat('#5d6c7c'));
    box(c, 0.43, 0.45, 0.57, 0.57, 116, 122, mat('#8e98a3'));
    line(c, P(0.5, 0.51, 122), P(0.5, 0.51, 148), '#aab3bc', 1.4);
    if (!lightMode) { const [x, y] = P(0.5, 0.51, 148); c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fillStyle = '#ff4040'; c.fill(); }
  };

  // --- Industrial ---
  H.I1 = 50;
  B.I1 = (c, w, d, v) => {
    const wall = mat(['#9aa6b2', '#b2a68c', '#8fa39a'][v % 3]), roof = mat('#6f7b88');
    pave(c, 0.03, 0.03, 0.97, 0.97, '#a9a79f');
    box(c, 0.08, 0.14, 0.92, 0.8, 0, 15, wall);
    gableU(c, 0.06, 0.12, 0.94, 0.82, 15, 7, roof, wall);
    doorL(c, 0.18, 0.38, 0.8, 11, '#d6a845'); doorL(c, 0.5, 0.7, 0.8, 11, '#d6a845');
    winGridR(c, 0.92, 0.2, 0.74, 7, 12, 3, 1, '#bcd6e6', 0.2, 0.1);
    box(c, 0.76, 0.86, 0.9, 0.96, 0, 5, mat('#b98b4e'));
    box(c, 0.1, 0.86, 0.22, 0.96, 0, 8, mat('#6d86a6'));
  };
  H.I2 = 104;
  B.I2 = (c, w, d, v) => {
    const wall = mat(['#a2abb5', '#b09a88'][v % 2]), roof = mat('#68717d');
    pave(c, 0.03, 0.03, 0.97, 0.97, '#a3a198');
    stripedStack(c, 0.82, 0.17, 0.1, 0, 74, mat('#d8d8d4'), mat('#c4453a'), 6);
    box(c, 0.08, 0.28, 0.92, 0.9, 0, 24, wall);
    for (let k = 0; k < 3; k++) gableV(c, 0.08 + k * 0.28, 0.28, 0.36 + k * 0.28, 0.9, 24, 9, roof, wall);
    winGridL(c, 0.08, 0.92, 0.9, 6, 20, 5, 1, '#b7d0e0', 0.15, 0.1);
    doorL(c, 0.4, 0.6, 0.9, 14, '#8a8f96');
    box(c, 0.12, 0.12, 0.34, 0.24, 0, 10, mat('#8f9ba8'));
    line(c, P(0.34, 0.18, 8), P(0.8, 0.2, 8), '#6b7278', 2);
  };
  H.I3 = 124;
  B.I3 = (c, w, d, v) => {
    pave(c, 0.02, 0.02, 0.98, 0.98, '#9d9b92');
    stripedStack(c, 0.84, 0.16, 0.09, 0, 96, mat('#d8d8d4'), mat('#c4453a'), 8);
    stripedStack(c, 0.68, 0.14, 0.08, 0, 88, mat('#d8d8d4'), mat('#c4453a'), 8);
    box(c, 0.45, 0.26, 0.93, 0.88, 0, 30, mat('#8d98a3'));
    box(c, 0.5, 0.3, 0.88, 0.5, 30, 38, mat('#7a8591'));
    winGridL(c, 0.45, 0.93, 0.88, 8, 26, 6, 1, '#b7d0e0', 0.14, 0.1);
    winGridR(c, 0.93, 0.26, 0.88, 8, 26, 3, 1, '#a3bfd2', 0.14, 0.1);
    cyl(c, 0.24, 0.3, 0.17, 0, 30, mat('#c9ced3'), '#aab0b7');
    cyl(c, 0.22, 0.66, 0.15, 0, 24, mat('#d3d6da'), '#b4bac1');
    line(c, P(0.24, 0.3, 28), P(0.5, 0.4, 32), '#555c63', 2);
    box(c, 0.08, 0.84, 0.38, 0.95, 0, 7, mat('#b98b4e'));
  };

  // --- Energía ---
  H.wind = 100;
  B.wind = (c) => {
    pave(c, 0.2, 0.2, 0.8, 0.8, '#bdbab0');
    box(c, 0.38, 0.38, 0.62, 0.62, 0, 5, mat('#c8ccd0'));
    if (lightMode) return;
    const [x, y] = P(0.5, 0.5, 5), [x2, y2] = P(0.5, 0.5, 66);
    const g = c.createLinearGradient(x - 4, 0, x + 4, 0); g.addColorStop(0, '#fbfbfb'); g.addColorStop(1, '#b9c0c8');
    c.beginPath(); c.moveTo(x - 4.5, y); c.lineTo(x + 4.5, y); c.lineTo(x + 2, y2); c.lineTo(x - 2, y2); c.closePath(); c.fillStyle = g; c.fill();
    c.fillStyle = '#e8ecef'; c.fillRect(x2 - 4, y2 - 3, 8, 6);
  };
  H.solar = 46;
  B.solar = (c) => {
    pave(c, 0.06, 0.06, 1.94, 1.94, '#aeb2a8');
    box(c, 1.5, 1.55, 1.85, 1.9, 0, 8, mat('#dde1e4'));
    const pm = (u0, u1, v0, v1) => {
      poly(c, [P(u0, v0, 12), P(u1, v0, 12), P(u1, v1, 5), P(u0, v1, 5)], '#2b59a1', '#9fb7d8', 0.8);
      poly(c, [P(u0, (v0 + v1) / 2, 8.5), P(u1, (v0 + v1) / 2, 8.5), P(u1, (v0 + v1) / 2 + 0.01, 8.5), P(u0, (v0 + v1) / 2 + 0.01, 8.5)], null, 'rgba(160,190,230,0.7)', 0.6);
      poly(c, [P((u0 + u1) / 2, v0, 12), P((u0 + u1) / 2 + 0.01, v0, 12), P((u0 + u1) / 2 + 0.01, v1, 5), P((u0 + u1) / 2, v1, 5)], null, 'rgba(160,190,230,0.7)', 0.6);
    };
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === 2 && j === 2) continue;
      pm(0.12 + i * 0.5, 0.12 + i * 0.5 + 0.44, 0.12 + j * 0.5, 0.12 + j * 0.5 + 0.44);
    }
  };
  H.coal = 140;
  B.coal = (c) => {
    pave(c, 0.04, 0.04, 2.96, 2.96, '#8f8e86');
    box(c, 0.25, 0.25, 1.35, 1.25, 0, 52, mat('#a9b0b6'));
    winGridL(c, 0.25, 1.35, 1.25, 12, 48, 3, 3, '#6d7f90', 0.2, 0.2);
    box(c, 0.25, 1.35, 2.15, 2.55, 0, 34, mat('#7c858e'));
    winGridL(c, 0.25, 2.15, 2.55, 8, 30, 6, 1, '#9ab0c0', 0.12, 0.15);
    winGridR(c, 2.15, 1.35, 2.55, 8, 30, 3, 1, '#8aa0b0', 0.15, 0.15);
    box(c, 0.2, 1.3, 2.2, 1.4, 34, 38, mat('#5f6770'));
    // pila de carbón
    if (!lightMode) {
      const [x, y] = P(0.6, 0.55 + 2.1, 0);
      c.fillStyle = '#2b2e33'; c.beginPath(); c.moveTo(x - 20, y + 4); c.lineTo(x - 8, y - 10); c.lineTo(x + 6, y - 12); c.lineTo(x + 20, y + 4); c.closePath(); c.fill();
      c.fillStyle = '#3d4147'; c.beginPath(); c.moveTo(x - 8, y - 10); c.lineTo(x + 6, y - 12); c.lineTo(x + 20, y + 4); c.lineTo(x + 4, y - 2); c.closePath(); c.fill();
    }
    stripedStack(c, 2.05, 0.7, 0.17, 0, 108, mat('#d8d8d4'), mat('#c4453a'), 8);
    stripedStack(c, 2.55, 1.2, 0.17, 0, 108, mat('#d8d8d4'), mat('#c4453a'), 8);
  };
  H.nuclear = 160;
  B.nuclear = (c) => {
    pave(c, 0.04, 0.04, 3.96, 3.96, '#98978f');
    coolTower(c, 1.1, 1.0, 0.72, 0, 84, mat('#dadcde'));
    coolTower(c, 2.9, 0.9, 0.62, 0, 74, mat('#d4d7da'));
    box(c, 0.3, 2.4, 2.0, 3.7, 0, 26, mat('#9ba5af'));
    winGridL(c, 0.3, 2.0, 3.7, 6, 22, 5, 1, '#adc4d4', 0.12, 0.15);
    box(c, 2.3, 2.1, 3.7, 3.7, 0, 30, mat('#b4bcc4'));
    cyl(c, 3.0, 2.9, 0.5, 30, 38, mat('#c4cbd2'));
    dome(c, 3.0, 2.9, 0.5, 38, mat('#cdd3d9'));
    box(c, 1.2, 1.9, 1.6, 2.3, 0, 12, mat('#8b949d'));
  };

  // --- Agua ---
  H.well = 40;
  B.well = (c) => {
    lawn(c, 1, 1, '#8fc366', 0.08);
    pave(c, 0.3, 0.3, 0.7, 0.7, '#c9c5b8');
    cyl(c, 0.42, 0.55, 0.16, 0, 7, mat('#a6a8a6'), '#2f6fa5');
    box(c, 0.56, 0.2, 0.84, 0.46, 0, 12, mat('#c9a679'));
    pyramid(c, 0.52, 0.16, 0.88, 0.5, 12, 8, mat('#8a4a3a'));
    line(c, P(0.5, 0.55, 8), P(0.62, 0.5, 4), '#59616a', 2);
  };
  H.pump = 74;
  B.pump = (c) => {
    pave(c, 0.06, 0.06, 1.94, 1.94, '#b3b8b8');
    cyl(c, 0.65, 0.7, 0.4, 0, 32, mat('#9ec3de'), '#7fa9c7');
    stripedStack(c, 0.65, 0.7, 0.4, 32, 36, mat('#dfe6ea'), mat('#dfe6ea'), 1);
    box(c, 1.1, 0.4, 1.85, 1.2, 0, 20, mat('#d9d3c5'));
    winGridL(c, 1.1, 1.85, 1.2, 5, 16, 3, 1, GLASS, 0.18, 0.15);
    gableU(c, 1.05, 0.35, 1.9, 1.25, 20, 8, mat('#6b7f94'), mat('#d9d3c5'));
    box(c, 0.9, 1.35, 1.6, 1.6, 0, 6, mat('#5f8fb8'));
    line(c, P(0.65, 1.1, 5), P(1.5, 1.5, 5), '#4a6e8e', 3);
  };
  H.wplant = 90;
  B.wplant = (c) => {
    pave(c, 0.04, 0.04, 2.96, 2.96, '#a9aeb0');
    for (const [u, v] of [[0.85, 0.85], [0.85, 2.1]]) {
      cyl(c, u, v, 0.62, 0, 9, mat('#cfd4d6'), '#4a9bd6');
      ell(c, u, v, 0.45, 9, '#6cb6e8');
    }
    box(c, 1.8, 0.35, 2.75, 1.7, 0, 30, mat('#d9d3c5'));
    winGridL(c, 1.8, 2.75, 1.7, 6, 26, 3, 1, GLASS, 0.15, 0.15);
    winGridR(c, 2.75, 0.35, 1.7, 6, 26, 4, 1, '#79b4d8', 0.15, 0.15);
    cyl(c, 2.25, 2.35, 0.4, 0, 52, mat('#9ec3de'), '#c9dded');
    line(c, P(1.4, 0.85, 6), P(1.8, 0.85, 6), '#4a6e8e', 3);
  };

  // --- Seguridad ---
  H.police = 78;
  B.police = (c) => {
    pave(c, 0.05, 0.05, 1.95, 1.95, '#bcbbb2');
    box(c, 0.2, 0.28, 1.8, 1.5, 0, 20, mat('#dfe5ee'));
    box(c, 0.2, 0.28, 1.8, 1.5, 20, 31, mat('#2f5da8'));
    winGridL(c, 0.2, 1.8, 1.5, 5, 17, 6, 1, GLASS, 0.18, 0.12);
    winGridR(c, 1.8, 0.28, 1.5, 5, 17, 4, 1, '#79b4d8', 0.18, 0.12);
    doorL(c, 0.9, 1.1, 1.5, 12, '#2a3f66');
    // insignia
    if (!lightMode) {
      const [x, y] = P(1.45, 1.5, 25);
      c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 2.4 : 5; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath();
      c.fillStyle = '#ffd24a'; c.fill();
    }
    box(c, 0.8, 0.6, 1.2, 0.95, 31, 36, mat('#cfd6e0'));
    box(c, 0.84, 0.66, 0.97, 0.8, 36, 41, mat('#e04242'));
    box(c, 1.03, 0.66, 1.16, 0.8, 36, 41, mat('#3f7de0'));
    line(c, P(0.3, 1.8, 0), P(0.3, 1.8, 40), '#8a8f96', 1.2);
    if (!lightMode) { const [x, y] = P(0.3, 1.8, 40); c.fillStyle = '#2f5da8'; c.fillRect(x, y, 9, 5); }
  };
  H.fire = 86;
  B.fire = (c) => {
    pave(c, 0.05, 0.05, 1.95, 1.95, '#bcbbb2');
    box(c, 0.18, 0.3, 1.82, 1.5, 0, 28, mat('#c8402f'));
    box(c, 0.16, 0.28, 1.84, 1.52, 24, 28, mat('#e8e2d4'));
    for (let i = 0; i < 3; i++) {
      const a = 0.28 + i * 0.5, b = a + 0.4;
      poly(c, [P(a, 1.5, 0), P(b, 1.5, 0), P(b, 1.5, 18), P(a, 1.5, 18)], '#e9ecef', 'rgba(0,0,0,0.3)');
      for (let k = 1; k < 5; k++) line(c, P(a, 1.5, k * 3.6), P(b, 1.5, k * 3.6), 'rgba(0,0,0,0.18)', 0.6);
    }
    winGridR(c, 1.82, 0.3, 1.5, 8, 21, 3, 1, '#8ab6d4', 0.2, 0.1);
    box(c, 1.38, 0.34, 1.78, 0.74, 28, 62, mat('#a93226'));
    winGridL(c, 1.38, 1.78, 0.74, 44, 58, 1, 1, '#ffe9a6', 0.2, 0.1);
    pyramid(c, 1.34, 0.3, 1.82, 0.78, 62, 12, mat('#4a4f56'));
  };

  // --- Sanidad ---
  function cross(c, x, y, s, col) {
    c.fillStyle = col; c.fillRect(x - s, y - s * 0.35, s * 2, s * 0.7); c.fillRect(x - s * 0.35, y - s, s * 0.7, s * 2);
  }
  H.clinic = 66;
  B.clinic = (c) => {
    pave(c, 0.05, 0.05, 1.95, 1.95, '#c5c4bc');
    box(c, 0.2, 0.3, 1.8, 1.5, 0, 26, mat('#eef2f5'));
    box(c, 0.18, 0.28, 1.82, 1.52, 26, 30, mat('#3fa66a'));
    winGridL(c, 0.2, 1.8, 1.5, 6, 22, 6, 1, GLASS, 0.18, 0.15);
    winGridR(c, 1.8, 0.3, 1.5, 6, 22, 4, 1, '#79b4d8', 0.18, 0.15);
    doorL(c, 0.9, 1.1, 1.5, 11, '#6fa9c9');
    { const [x, y] = P(1.45, 1.5, 17); cross(c, x, y, 5, '#e0443a'); }
    box(c, 0.7, 0.5, 1.3, 0.9, 30, 36, mat('#d4dadf'));
    cross(c, ...P(1.0, 0.7, 36), 4, '#e0443a');
    dot(c, 0.2, 1.75, '#5fae55', 3.2); dot(c, 1.85, 1.75, '#5fae55', 3.2);
  };
  H.hospital = 112;
  B.hospital = (c) => {
    pave(c, 0.04, 0.04, 2.96, 2.96, '#c0bfb7');
    box(c, 0.35, 0.35, 2.2, 1.35, 0, 56, mat('#e9eef2'));
    winGridL(c, 0.35, 2.2, 1.35, 10, 52, 5, 4, GLASS, 0.18, 0.18);
    winGridR(c, 2.2, 0.35, 1.35, 10, 52, 2, 4, '#79b4d8', 0.18, 0.18);
    box(c, 0.3, 1.35, 2.7, 2.6, 0, 34, mat('#f2f5f7'));
    box(c, 0.28, 1.33, 2.72, 2.62, 34, 38, mat('#3fa66a'));
    winGridL(c, 0.3, 2.7, 2.6, 8, 31, 7, 2, GLASS, 0.18, 0.15);
    winGridR(c, 2.7, 1.35, 2.6, 8, 31, 3, 2, '#79b4d8', 0.18, 0.15);
    doorL(c, 1.35, 1.65, 2.6, 14, '#6fa9c9');
    cross(c, ...P(1.5, 2.6, 28), 5.5, '#e0443a');
    // helipuerto
    ell(c, 0.95, 0.9, 0.34, 56, '#5a626a', '#cfd5da');
    box(c, 0.75, 0.75, 1.18, 1.15, 56, 56.6, mat('#5a626a'));
    if (!lightMode) { const [x, y] = P(0.97, 0.95, 57); c.fillStyle = '#ffd84a'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText('H', x, y + 3); }
  };

  // --- Educación ---
  H.school = 76;
  B.school = (c) => {
    pave(c, 0.05, 0.05, 1.95, 1.95, '#c6c3b8');
    flat(c, 0.35, 1.05, 1.85, 1.85, 0, '#d6896a', 'rgba(0,0,0,0.2)');
    flat(c, 0.55, 1.15, 1.65, 1.75, 0, null, 'rgba(255,255,255,0.7)');
    box(c, 0.2, 0.2, 1.8, 0.95, 0, 24, mat('#f2c85b'));
    box(c, 0.18, 0.18, 1.82, 0.97, 24, 27, mat('#b04a3a'));
    winGridL(c, 0.2, 1.8, 0.95, 6, 20, 6, 1, GLASS, 0.18, 0.12);
    winGridR(c, 1.8, 0.2, 0.95, 6, 20, 2, 1, '#79b4d8', 0.2, 0.12);
    doorL(c, 0.9, 1.1, 0.95, 10, '#7a4a2f');
    box(c, 0.75, 0.3, 1.25, 0.8, 27, 48, mat('#e9b94a'));
    winGridL(c, 0.75, 1.25, 0.8, 34, 44, 1, 1, '#fffbe0', 0.3, 0.1);
    pyramid(c, 0.72, 0.27, 1.28, 0.83, 48, 14, mat('#b04a3a'));
    line(c, P(0.2, 1.0, 0), P(0.2, 1.0, 30), '#8a8f96', 1.1);
    if (!lightMode) { const [x, y] = P(0.2, 1.0, 30); c.fillStyle = '#e04a4a'; c.fillRect(x, y, 8, 5); }
    dot(c, 1.9, 0.95, '#5fae55', 3.2);
  };
  H.university = 116;
  B.university = (c) => {
    lawn(c, 3, 3, '#8fc366', 0.05);
    pave(c, 1.2, 2.0, 1.8, 2.95, '#d9d2c2');
    box(c, 0.4, 0.5, 2.6, 1.9, 0, 34, mat('#dccfb4'));
    winGridL(c, 0.4, 2.6, 1.9, 8, 31, 8, 2, '#9fc4d6', 0.18, 0.14);
    winGridR(c, 2.6, 0.5, 1.9, 8, 31, 4, 2, '#86adc0', 0.18, 0.14);
    box(c, 0.38, 0.48, 2.62, 1.92, 34, 38, mat('#c4b898'));
    for (let i = 0; i < 6; i++) box(c, 0.75 + i * 0.35, 1.95, 0.85 + i * 0.35, 2.05, 0, 28, mat('#f0ead8'));
    box(c, 0.7, 1.92, 2.4, 2.1, 28, 32, mat('#efe8d6'));
    box(c, 0.6, 1.9, 2.5, 2.2, 0, 3, mat('#d0cabb'));
    cyl(c, 1.5, 1.2, 0.5, 38, 56, mat('#e6dcc3'));
    dome(c, 1.5, 1.2, 0.5, 56, mat('#4fa58c'));
    line(c, P(1.5, 1.2, 80), P(1.5, 1.2, 94), '#d9c46a', 1.4);
  };

  // --- Ocio ---
  function trees(c, list) { for (const [u, v, k, s] of list) { const [x, y] = P(u, v, 0); treeShape(c, x, y, k, s || 0.8); } }
  H.park1 = 54;
  B.park1 = (c) => {
    lawn(c, 1, 1, '#7fc063', 0.03);
    flat(c, 0.42, 0.03, 0.58, 0.97, 0, '#d9cfae'); flat(c, 0.03, 0.42, 0.97, 0.58, 0, '#d9cfae');
    dot(c, 0.2, 0.2, '#ff7a90'); dot(c, 0.8, 0.8, '#ffd24a'); dot(c, 0.22, 0.78, '#fff');
    box(c, 0.62, 0.62, 0.8, 0.7, 0, 3.5, mat('#9c6b45'));
    trees(c, [[0.22, 0.22, 1, 0.72], [0.8, 0.25, 0, 0.62], [0.74, 0.86, 2, 0.8]]);
  };
  H.park2 = 70;
  B.park2 = (c) => {
    lawn(c, 2, 2, '#7fc063', 0.03);
    flat(c, 0.9, 0.03, 1.1, 1.97, 0, '#d9cfae'); flat(c, 0.03, 0.9, 1.97, 1.1, 0, '#d9cfae');
    ell(c, 1.45, 0.48, 0.34, 0, '#58a9e0', '#cfe9f5');
    ell(c, 0.5, 1.55, 0.2, 0, '#d9cfae', null);
    cyl(c, 0.5, 1.55, 0.13, 0, 6, mat('#cfd3d6'), '#58a9e0');
    line(c, P(0.5, 1.55, 6), P(0.5, 1.55, 15), 'rgba(160,215,245,0.9)', 1.5);
    box(c, 1.3, 1.5, 1.6, 1.6, 0, 3.5, mat('#9c6b45'));
    trees(c, [[0.28, 0.3, 1, 0.8], [0.62, 0.22, 0, 0.7], [1.7, 0.3, 1, 0.78], [0.3, 0.78, 0, 0.62], [1.7, 1.55, 0, 0.7], [1.45, 1.8, 2, 0.8], [0.8, 1.85, 1, 0.8], [1.85, 1.0, 2, 0.8]]);
  };
  H.stadium = 84;
  B.stadium = (c) => {
    pave(c, 0.03, 0.03, 2.97, 2.97, '#b7b4aa');
    // gradas
    cyl(c, 1.5, 1.5, 1.38, 0, 24, mat('#c9ccd0'), '#aeb2b8');
    ell(c, 1.5, 1.5, 1.2, 24, '#b9433a', null);
    ell(c, 1.5, 1.5, 1.02, 22, '#d9b84a', null);
    ell(c, 1.5, 1.5, 0.86, 20, '#8a8f98', null);
    ell(c, 1.5, 1.5, 0.74, 14, '#5fb35a', '#e8f5e0');
    if (!lightMode) {
      const [x, y] = P(1.5, 1.5, 14);
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke();
      c.beginPath(); c.ellipse(x, y, 5, 2.5, 0, 0, 7); c.stroke();
    }
    for (const [u, v] of [[0.28, 0.28], [2.72, 0.28], [0.28, 2.72], [2.72, 2.72]]) {
      line(c, P(u, v, 0), P(u, v, 58), '#7c8590', 2);
      box(c, u - 0.1, v - 0.07, u + 0.1, v + 0.07, 58, 63, mat('#f4f1da'));
    }
  };

  // --- Servicios ---
  H.recycle = 70;
  B.recycle = (c) => {
    pave(c, 0.05, 0.05, 1.95, 1.95, '#b9b8ae');
    box(c, 0.2, 0.22, 1.35, 1.1, 0, 26, mat('#5aa469'));
    gableU(c, 0.16, 0.18, 1.39, 1.14, 26, 8, mat('#417d4e'), mat('#5aa469'));
    doorL(c, 0.4, 0.75, 1.1, 18, '#cfe8d3');
    if (!lightMode) {
      const [x, y] = P(1.1, 1.1, 14);
      c.strokeStyle = '#eaf7ec'; c.lineWidth = 1.6; c.lineCap = 'round';
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; c.beginPath(); c.arc(x, y, 3.8, a, a + 1.5); c.stroke(); }
    }
    box(c, 1.45, 1.4, 1.65, 1.6, 0, 9, mat('#3b84c4')); box(c, 1.7, 1.4, 1.9, 1.6, 0, 9, mat('#d7b43a'));
    box(c, 1.45, 1.65, 1.65, 1.85, 0, 9, mat('#4aa05a')); box(c, 1.7, 1.65, 1.9, 1.85, 0, 9, mat('#c9544a'));
    box(c, 0.3, 1.45, 1.0, 1.75, 0, 8, mat('#a5adb5'));
  };
  H.bus = 44;
  B.bus = (c) => {
    pave(c, 0.04, 0.04, 0.96, 0.96, '#cfcabd');
    flat(c, 0.04, 0.78, 0.96, 0.96, 0, '#8e9298');
    for (const [u, v] of [[0.22, 0.36], [0.78, 0.36], [0.22, 0.62], [0.78, 0.62]]) box(c, u - 0.02, v - 0.02, u + 0.02, v + 0.02, 0, 15, mat('#6a717a'));
    box(c, 0.16, 0.3, 0.84, 0.68, 15, 18, mat('#2f7cc4'));
    flat(c, 0.3, 0.46, 0.7, 0.54, 4, '#a78b5c', null);
    box(c, 0.3, 0.46, 0.7, 0.54, 0, 5, mat('#9c6b45'));
    line(c, P(0.9, 0.2, 0), P(0.9, 0.2, 30), '#6a717a', 1.2);
    box(c, 0.84, 0.14, 0.96, 0.26, 30, 38, mat('#2f7cc4'));
  };
  H.metro = 74;
  B.metro = (c) => {
    pave(c, 0.04, 0.04, 1.96, 1.96, '#bdbab0');
    box(c, 0.3, 0.4, 1.7, 1.5, 0, 20, mat('#556270'));
    for (let i = 0; i < 6; i++) poly(c, [P(0.3 + i * 0.23, 1.5, 4), P(0.5 + i * 0.23, 1.5, 4), P(0.5 + i * 0.23, 1.5, 15), P(0.3 + i * 0.23, 1.5, 15)], 'rgba(170,220,240,0.9)', 'rgba(0,0,0,0.3)');
    box(c, 0.26, 0.36, 1.74, 1.54, 20, 24, mat('#2f7cc4'));
    flat(c, 0.6, 1.5, 1.4, 1.85, 0, '#4a5058');
    for (let i = 0; i < 6; i++) line(c, P(0.6, 1.52 + i * 0.055, 0), P(1.4, 1.52 + i * 0.055, 0), 'rgba(255,255,255,0.35)', 0.8);
    line(c, P(1.7, 1.65, 0), P(1.7, 1.65, 52), '#6a717a', 1.4);
    if (!lightMode) {
      const [x, y] = P(1.7, 1.65, 58);
      c.beginPath(); c.arc(x, y, 8.5, 0, 7); c.fillStyle = '#d6443a'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#fff'; c.stroke();
      c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText('M', x, y + 4);
    }
  };

  // anclajes para efectos dinámicos (en tiles/píxeles dentro del sprite)
  const ANCH = {
    I2: { smoke: [[0.82, 0.17, 76]] },
    I3: { smoke: [[0.84, 0.16, 98], [0.68, 0.14, 90]] },
    coal: { smoke: [[2.05, 0.7, 110], [2.55, 1.2, 110]] },
    nuclear: { steam: [[1.1, 1.0, 86], [2.9, 0.9, 76]] },
    wind: { rotor: [0.5, 0.5, 66] },
    police: { siren: [0.9, 0.73, 37] },
    fire: { siren: [1.58, 0.54, 64] },
  };

  /* ---------- fábrica de sprites de edificio ---------- */
  function make(w, d, Hh, fn, lit, v) {
    const pad = 6;
    const left = d * TW / 2 + pad, right = w * TW / 2 + pad;
    const top = Hh + pad, bottom = (w + d) * TH / 2 + pad + 6;
    const [cv, c] = newCanvas(left + right, top + bottom);
    c.translate(left, top);
    lightMode = lit; seed = v; litDrawn = false;
    c.lineCap = 'butt';
    if (lit) c.globalCompositeOperation = 'destination-out';   // orden del pintor: lo que se dibuja después tapa las ventanas que quedan detrás
    fn(c, w, d, v);
    lightMode = false;
    return { c: cv, ox: left * SPR, oy: top * SPR, lit: litDrawn };
  }
  function bname(b) { return b.def ? b.key : b.key + b.lvl; }
  function forBuilding(b) {
    const name = bname(b), v = b.def ? 0 : (b.v | 0);
    const key = name + ':' + v;
    let e = cache.get(key);
    if (!e) {
      e = { base: make(b.w, b.h, H[name], B[name], false, v), lit: undefined };
      cache.set(key, e);
    }
    return e;
  }
  function lights(e, b) {
    if (e.lit === undefined) {
      const name = bname(b);
      const l = make(b.w, b.h, H[name], B[name], true, b.def ? 0 : (b.v | 0));
      e.lit = l.lit ? l : null;
    }
    return e.lit;
  }
  function forDef(key) {
    const k = 'def:' + key; let e = cache.get(k);
    if (!e) { e = { base: make(BDEFS[key].w, BDEFS[key].h, H[key], B[key], false, 0) }; cache.set(k, e); }
    return e;
  }
  function zoneSample(zkey, lvl, v) {
    const name = zkey + lvl, k = 'zs:' + name + v; let e = cache.get(k);
    if (!e) { e = { base: make(1, 1, H[name], B[name], false, v) }; cache.set(k, e); }
    return e;
  }

  /* ---------- atlas de sprites ----------
   * Dibujar cientos de sprites que viven cada uno en su propio lienzo obliga a la GPU a cambiar de textura en cada llamada
   * (en el móvil ~0,1 ms por llamada). Los sprites se copian a unas pocas páginas grandes y se dibujan con un rectángulo
   * de origen: las llamadas consecutivas comparten textura y se agrupan en una sola. La copia se hace al primer uso. */
  const PG = 2048, GUT = 2, pages = []; let cur = null, ax = 0, ay = 0, rowH = 0;
  function newPage() { const cv = document.createElement('canvas'); cv.width = cv.height = PG; cur = { cv, g: cv.getContext('2d') }; pages.push(cur); ax = ay = rowH = 0; }
  /** Devuelve {cv,x,y,w,h} con el sitio del sprite en el atlas (o null: se dibujará desde su propio lienzo). Solo entran los sprites reducidos (LOD) y los forzados. */
  function pack(s, force) {
    if (s.a !== undefined) return s.a;
    if (!s.k && !force) return (s.a = null);        // resolución completa: desde su lienzo (medido en móvil: ~2x más rápido que desde el atlas)
    const w = s.c.width, h = s.c.height, bw = w + GUT * 2, bh = h + GUT * 2;
    if (bw > PG || bh > PG) return (s.a = null);
    if (!cur) newPage();
    if (ax + bw > PG) { ax = 0; ay += rowH; rowH = 0; }
    if (ay + bh > PG) { if (pages.length >= 8) return (s.a = null); newPage(); }       // tope de memoria (~130 MB de texturas)
    cur.g.drawImage(s.c, ax + GUT, ay + GUT);
    const a = { cv: cur.cv, x: ax + GUT, y: ay + GUT, w, h };
    ax += bw; rowH = Math.max(rowH, bh);
    return (s.a = a);
  }
  function atlasInfo() { return { pages: pages.length, px: pages.length * PG * PG }; }

  /** Silueta negra opaca de un sprite (para ocultar luces de lo que queda detrás). */
  function sil(e) {
    if (e.sil) return e.sil;
    const cv = document.createElement('canvas'); cv.width = e.c.width; cv.height = e.c.height;
    const c = cv.getContext('2d'); c.drawImage(e.c, 0, 0);
    c.globalCompositeOperation = 'source-in'; c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    return (e.sil = { c: cv, ox: e.ox, oy: e.oy });
  }

  /* ---------- niveles de detalle (LOD) ---------- */
  /** Versión reducida a 1/2 (nivel 1) o 1/4 (nivel 2) de un sprite, cacheada en el propio sprite. */
  function lod(e, level) {
    const key = level === 1 ? 'l1' : 'l2';
    if (e[key]) return e[key];
    const src = level === 1 ? e : lod(e, 1);
    const w = Math.max(1, Math.ceil(src.c.width / 2)), h = Math.max(1, Math.ceil(src.c.height / 2));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(src.c, 0, 0, w, h);
    return (e[key] = { c: cv, ox: src.ox / 2, oy: src.oy / 2, k: (src.k || 1) / 2, dw: e.c.width / SPR, dh: e.c.height / SPR });
  }
  /** Máscara nocturna: silueta negra opaca + ventanas encendidas en un solo sprite (un dibujado por edificio). */
  function nightMask(e, b) {
    if (e.nm) return e.nm;
    const s = sil(e.base), l = lights(e, b);
    if (!l) return (e.nm = s);
    const cv = document.createElement('canvas'); cv.width = s.c.width; cv.height = s.c.height;
    const c = cv.getContext('2d'); c.drawImage(s.c, 0, 0); c.drawImage(l.c, 0, 0);
    return (e.nm = { c: cv, ox: s.ox, oy: s.oy });
  }
  /** Vehículo precalculado (color, tipo y orientación); el centro del coche es el punto de anclaje. */
  function vehicle(kind, color, alongX) {
    const key = 'veh_' + kind + '_' + color + '_' + (alongX ? 1 : 0);
    let e = cache.get(key); if (e) return e;
    const [cv, c] = newCanvas(56, 48); c.translate(28, 32);
    const m = mat(color), truck = kind === 'truck';
    const L = truck ? 0.3 : 0.24, Wd = truck ? 0.15 : 0.13, lu = alongX ? L : Wd, lv = alongX ? Wd : L;
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath();
    [P(-lu, -lv, 0), P(lu, -lv, 0), P(lu, lv, 0), P(-lu, lv, 0)].forEach((p, n) => n ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.fill();
    box(c, -lu, -lv, lu, lv, 1, truck ? 7 : 5, m);
    if (truck) box(c, alongX ? -L * 0.9 : -Wd * 0.9, alongX ? -Wd * 0.9 : -L * 0.9, alongX ? L * 0.3 : Wd * 0.9, alongX ? Wd * 0.9 : L * 0.3, 7, 9.5, mat('#cfd3d6'));
    else box(c, -lu * 0.5, -lv * 0.5, lu * 0.5, lv * 0.5, 5, 7.5, mat('#aebccb'));
    e = { c: cv, ox: 28 * SPR, oy: 32 * SPR }; cache.set(key, e); return e;
  }

  /* ---------- iconos de la barra ---------- */
  function iconCanvas(size) { const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; const c = cv.getContext('2d'); c.scale(2, 2); return [cv, c]; }
  function iconFromSprite(e, size) {
    const [cv, c] = iconCanvas(size);
    const sw = e.base.c.width / SPR, sh = e.base.c.height / SPR;
    const s = Math.min((size - 4) / sw, (size - 4) / sh);
    c.imageSmoothingQuality = 'high';
    c.drawImage(e.base.c, (size - sw * s) / 2, (size - sh * s) / 2 + 1, sw * s, sh * s);
    return cv;
  }
  function icon(tool, size = 46) {
    if (tool.kind === 'build') return iconFromSprite(forDef(tool.key), size);
    const [cv, c] = iconCanvas(size);
    if (tool.kind === 'road') {
      const e = roadTile(tool.road, 5, 'g'), s = (size - 4) / (TW + 4);
      c.drawImage(e.c, 2, size * 0.2, (TW + 4) * s, (TH + 12) * s);
    } else if (tool.kind === 'zone') {
      const e = zoneTile(tool.zone), s = (size - 2) / (TW + 4);
      c.drawImage(plainDiamond('#78b95a', 1).c, 1, size * 0.28, (TW + 4) * s, (TH + 4) * s);
      c.drawImage(e.c, 1, size * 0.28, (TW + 4) * s, (TH + 4) * s);
      c.drawImage(e.c, 1, size * 0.28, (TW + 4) * s, (TH + 4) * s);
      c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3;
      c.fillText(ZKEY[tool.zone], size / 2, size * 0.28 + (TH + 4) * s / 2);
    }
    return cv;
  }

  return {
    P, mat, box, poly, flat, cyl, dome, ell, treeShape, B, H, ANCH,
    groundTile, waterTile, rippleTile, zoneTile, plainDiamond, roadTile, treeSprite,
    forBuilding, lights, forDef, zoneSample, icon, shade, sil, lod, nightMask, vehicle, pack, atlasInfo,
  };
})();
