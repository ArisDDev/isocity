'use strict';
/* ==========================================================================
   Mundo: mapa, terreno procedural, edificios y construcción
   ========================================================================== */
const W = {
  N: 64, seed: 1, style: 'island',
  ter: null, tree: null, road: null, zone: null, bid: null, scorch: null, wdist: null,
  lv: null, pol: null, crime: null, traf: null, dens: null, comp: null,
  cov: {},
  buildings: new Map(), nextId: 1,
  dirtyNet: true, dirtyMaps: true, version: 0,
  start: { x: 32, y: 32 },
  nComp: 0,

  idx(x, y) { return y * this.N + x; },
  inb(x, y) { return x >= 0 && y >= 0 && x < this.N && y < this.N; },

  init(N, seed, style) {
    this.N = N; this.seed = seed; this.style = style || 'island';
    const n = N * N;
    this.ter = new Uint8Array(n); this.tree = new Uint8Array(n); this.road = new Uint8Array(n);
    this.zone = new Uint8Array(n); this.bid = new Int32Array(n); this.scorch = new Uint8Array(n);
    this.wdist = new Uint8Array(n);
    this.lv = new Float32Array(n).fill(50); this.pol = new Float32Array(n); this.crime = new Float32Array(n);
    this.traf = new Float32Array(n); this.dens = new Float32Array(n); this.comp = new Int32Array(n).fill(-1);
    this.cov = {};
    for (const k of COVS) this.cov[k] = new Float32Array(n);
    this.buildings = new Map(); this.nextId = 1;
    this.dirtyNet = this.dirtyMaps = true; this.version++; this.gver = (this.gver || 0) + 1;
    this.generate();
  },

  /* ---------- terreno ---------- */
  generate() {
    const N = this.N, seed = this.seed, style = this.style;
    const noise = (x, y, s) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash2(xi, yi, seed + s), b = hash2(xi + 1, yi, seed + s), c = hash2(xi, yi + 1, seed + s), d = hash2(xi + 1, yi + 1, seed + s);
      return lerp(lerp(a, b, u), lerp(c, d, u), v);
    };
    const fbm = (x, y, s, oct = 4) => { let a = 1, sum = 0, nrm = 0, f = 1; for (let i = 0; i < oct; i++) { sum += a * noise(x * f, y * f, s + i * 17); nrm += a; a *= 0.5; f *= 2; } return sum / nrm; };
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const h = new Float32Array(N * N);
    const side = Math.floor(rnd() * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = x / N, ny = y / N;
      const base = fbm(nx * 3.6 + 3, ny * 3.6 + 7, 1);
      let v;
      if (style === 'island') {
        const dx = nx - 0.5, dy = ny - 0.5, dist = Math.sqrt(dx * dx + dy * dy) * 2;
        v = base * 0.62 + (1 - Math.pow(clamp(dist, 0, 1.3), 1.7)) * 0.55;
      } else if (style === 'coast') {
        const g = side === 0 ? ny : side === 1 ? 1 - ny : side === 2 ? nx : 1 - nx;
        v = base * 0.7 + (1 - g) * 0.62 - 0.1;
      } else {
        const dx = Math.abs(nx - 0.5), dy = Math.abs(ny - 0.5), e = Math.max(dx, dy) * 2;
        v = base * 1.0 + 0.15 - Math.pow(e, 4) * 0.15;
      }
      h[y * N + x] = v;
    }
    const sorted = Array.from(h).sort((a, b) => a - b);
    const wf = style === 'island' ? 0.40 : style === 'coast' ? 0.30 : 0.20;
    const thr = sorted[Math.floor(N * N * wf)];
    for (let i = 0; i < N * N; i++) this.ter[i] = h[i] < thr ? TER.WATER : (h[i] < thr + 0.03 ? TER.SAND : TER.GRASS);
    this.cleanup();
    // zonas costeras de arena
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (this.ter[i] === TER.GRASS) {
        for (let d = 0; d < 4; d++) { const a = x + DX[d], b = y + DY[d]; if (this.inb(a, b) && this.ter[b * N + a] === TER.WATER && rnd() < 0.7) { this.ter[i] = TER.SAND; break; } }
      }
    }
    // árboles
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, nx = x / N, ny = y / N;
      const f = fbm(nx * 7 + 11, ny * 7 + 5, 40, 3);
      if (this.ter[i] === TER.GRASS) {
        const p = f > 0.57 ? 0.7 : f > 0.5 ? 0.22 : 0.015;
        if (rnd() < p) this.tree[i] = f > 0.6 ? (rnd() < 0.65 ? 1 : 2) : (rnd() < 0.5 ? 2 : 3);
      } else if (this.ter[i] === TER.SAND && rnd() < 0.025) this.tree[i] = 4;
    }
    // tree codes: 1 pino, 2 roble, 3 arbusto, 4 palmera
    // distancia al agua
    const q = [];
    this.wdist.fill(255);
    for (let i = 0; i < N * N; i++) if (this.ter[i] === TER.WATER) { this.wdist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % N, y = (i / N) | 0, dd = this.wdist[i];
      if (dd >= 8) continue;
      for (let d = 0; d < 4; d++) {
        const a = x + DX[d], b = y + DY[d];
        if (!this.inb(a, b)) continue;
        const j = b * N + a;
        if (this.wdist[j] > dd + 1) { this.wdist[j] = dd + 1; q.push(j); }
      }
    }
    // punto de inicio: centro de masa de la tierra grande
    let sx = 0, sy = 0, cnt = 0;
    for (let y = N * 0.25; y < N * 0.75; y++) for (let x = N * 0.25; x < N * 0.75; x++) {
      if (this.ter[(y | 0) * N + (x | 0)] !== TER.WATER) { sx += x; sy += y; cnt++; }
    }
    this.start = cnt ? { x: Math.round(sx / cnt), y: Math.round(sy / cnt) } : { x: N >> 1, y: N >> 1 };
  },

  cleanup() {
    const N = this.N, seen = new Uint8Array(N * N);
    const flood = (i0, type) => {
      const st = [i0], comp = []; seen[i0] = 1;
      while (st.length) {
        const i = st.pop(); comp.push(i);
        const x = i % N, y = (i / N) | 0;
        for (let d = 0; d < 4; d++) {
          const a = x + DX[d], b = y + DY[d]; if (!this.inb(a, b)) continue;
          const j = b * N + a;
          if (!seen[j] && ((this.ter[j] === TER.WATER) === type)) { seen[j] = 1; st.push(j); }
        }
      }
      return comp;
    };
    for (let i = 0; i < N * N; i++) if (!seen[i]) {
      const isW = this.ter[i] === TER.WATER;
      const comp = flood(i, isW);
      if (isW && comp.length < 7) for (const j of comp) this.ter[j] = TER.SAND;
      else if (!isW && comp.length < 14) for (const j of comp) this.ter[j] = TER.WATER;
    }
  },

  /* ---------- consultas ---------- */
  isWater(x, y) { return !this.inb(x, y) || this.ter[y * this.N + x] === TER.WATER; },
  roadAt(x, y) { return this.inb(x, y) ? this.road[y * this.N + x] : 0; },
  roadMask(x, y) {
    let m = 0;
    for (let d = 0; d < 4; d++) if (this.roadAt(x + DX[d], y + DY[d])) m |= 1 << d;
    return m;
  },
  bldAt(x, y) { if (!this.inb(x, y)) return null; const id = this.bid[y * this.N + x]; return id ? this.buildings.get(id) : null; },

  canPlace(def, x, y) {
    const N = this.N;
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) {
      if (!this.inb(xx, yy)) return { ok: false, reason: 'Fuera del mapa' };
      const i = yy * N + xx;
      if (this.ter[i] === TER.WATER) return { ok: false, reason: 'No se puede construir sobre el agua' };
      if (this.road[i]) return { ok: false, reason: 'Hay una carretera' };
      if (this.bid[i]) return { ok: false, reason: 'Terreno ocupado' };
    }
    if (def.needWater) {
      let ok = false;
      for (let yy = y - 1; yy <= y + def.h && !ok; yy++) for (let xx = x - 1; xx <= x + def.w; xx++) {
        const inside = xx >= x && xx < x + def.w && yy >= y && yy < y + def.h;
        if (!inside && this.inb(xx, yy) && this.ter[yy * N + xx] === TER.WATER) { ok = true; break; }
      }
      if (!ok) return { ok: false, reason: 'Debe estar junto al agua' };
    }
    return { ok: true };
  },

  canZone(x, y) {
    if (!this.inb(x, y)) return false;
    const i = y * this.N + x;
    return this.ter[i] !== TER.WATER && !this.road[i] && !this.bid[i];
  },

  roadCost(x, y, type) {
    if (!this.inb(x, y)) return -1;
    const i = y * this.N + x, cur = this.road[i];
    if (cur >= type) return -1;
    if (this.bid[i]) return -1;
    let c = ROADS[type].cost - (cur ? ROADS[cur].cost : 0);
    if (this.ter[i] === TER.WATER) {
      // los puentes necesitan un extremo en tierra o en otro puente
      c *= 4;
    }
    return c;
  },

  setRoad(x, y, type) {
    const i = y * this.N + x;
    this.road[i] = type; this.zone[i] = 0; this.tree[i] = 0;
    this.dirtyNet = true; this.version++; this.gver++;
  },

  addBuilding(key, x, y, extra) {
    const def = BDEFS[key] || null;
    const w = def ? def.w : 1, h = def ? def.h : 1;
    const b = {
      id: this.nextId++, key, def, x, y, w, h, lvl: 1, v: rint(8), pop: 0, emp: 0, hp: 100, fire: 0, bad: 0,
      pw: false, wt: false, acc: -1, rt: -1, happy: 50, age: 0, truck: 0, cx: x + w / 2, cy: y + h / 2,
    };
    if (extra) Object.assign(b, extra);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = yy * this.N + xx;
      this.bid[i] = b.id; this.tree[i] = 0;
      if (def && this.zone[i]) { this.zone[i] = 0; this.gver++; }
    }
    this.buildings.set(b.id, b);
    this.dirtyNet = this.dirtyMaps = true; this.version++;
    return b;
  },

  removeBuilding(id, scorch) {
    const b = this.buildings.get(id); if (!b) return;
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = yy * this.N + xx; this.bid[i] = 0;
      if (scorch) this.scorch[i] = 200;
    }
    this.buildings.delete(id);
    this.dirtyNet = this.dirtyMaps = true; this.version++;
  },

  /** Demolición de un tile. Devuelve qué se quitó. */
  bulldoze(x, y) {
    if (!this.inb(x, y)) return null;
    const i = y * this.N + x;
    if (this.bid[i]) { const b = this.buildings.get(this.bid[i]); this.removeBuilding(b.id); return { what: 'building', b }; }
    if (this.road[i]) { this.road[i] = 0; this.dirtyNet = true; this.version++; this.gver++; return { what: 'road' }; }
    if (this.zone[i]) { this.zone[i] = 0; this.version++; this.gver++; return { what: 'zone' }; }
    if (this.tree[i]) { this.tree[i] = 0; this.version++; return { what: 'tree' }; }
    return null;
  },

  /** Tile de carretera adyacente a un edificio (o -1). */
  adjacentRoad(b) {
    const N = this.N;
    for (let xx = b.x - 1; xx <= b.x + b.w; xx++) for (const yy of [b.y - 1, b.y + b.h]) {
      if (xx >= b.x && xx < b.x + b.w && yy >= b.y && yy < b.y + b.h) continue;
      if (this.inb(xx, yy) && this.road[yy * N + xx] && (xx >= b.x && xx < b.x + b.w)) return yy * N + xx;
    }
    for (let yy = b.y; yy < b.y + b.h; yy++) for (const xx of [b.x - 1, b.x + b.w]) {
      if (this.inb(xx, yy) && this.road[yy * N + xx]) return yy * N + xx;
    }
    return -1;
  },
};
