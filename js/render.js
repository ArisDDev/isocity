'use strict';
/* ==========================================================================
   Render isométrico con rotación de cámara, efectos y ciclo día/noche
   ========================================================================== */
const Cam = { x: 0, y: 0, zoom: 0.9, rot: 0 };

const Render = {
  canvas: null, ctx: null, wpx: 800, hpx: 600, dpr: 1,
  time: 0, fx: [], overlay: 'none', night: 0, nightOn: true,
  preview: null, selected: null, hoverTile: null,
  items: [], lodLevel: 0, quality: 'high', stats: { fps: 0 }, _fpsAcc: 0, _fpsN: 0, CH: 8, _ch: null, _cb: [0, 0, 0, 0], lodBias: 0, _ad: null,
  boats: [], _boatKey: '', rain: 0, raining: false, rainT: 60, weatherOn: true, drops: null,

  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    try { const q = localStorage.getItem('isocity_quality'); this.quality = (q === 'low' || q === 'medium' || q === 'high') ? q : this.defaultQuality(); } catch (e) { this.quality = this.defaultQuality(); }
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const g = this.glow = document.createElement('canvas'); g.width = g.height = 64;
    const c = g.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,220,140,1)'); gr.addColorStop(0.35, 'rgba(255,190,90,0.45)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    // brillo de farola con su opacidad ya aplicada: evita cambiar globalAlpha dos veces por farola
    const l = this.glowLamp = document.createElement('canvas'); l.width = l.height = 64;
    const lc = l.getContext('2d'); lc.globalAlpha = 0.75; lc.drawImage(g, 0, 0);
    const k = this.glowCar = document.createElement('canvas'); k.width = k.height = 64;
    const kc = k.getContext('2d'); kc.globalAlpha = 0.42; kc.drawImage(g, 0, 0);               // faros de coche
    this.sLamp = { c: l }; this.sCar = { c: k };
    this.initGL();
  },
  /** Calidad por defecto: alta en escritorio; media (o baja en equipos justos) en dispositivos táctiles. */
  defaultQuality() {
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (!coarse) return 'high';
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    return weak ? 'low' : 'medium';
  },
  setQuality(q) { this.quality = q; try { localStorage.setItem('isocity_quality', q); } catch (e) { } this.resize(); this._gc = null; this.freeChunks(); },
  resize() {
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.25 : (coarse ? 1.75 : 2);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.dpr = dpr; this.wpx = window.innerWidth; this.hpx = window.innerHeight;
    this.canvas.width = Math.floor(this.wpx * dpr); this.canvas.height = Math.floor(this.hpx * dpr);
    this.canvas.style.width = this.wpx + 'px'; this.canvas.style.height = this.hpx + 'px';
    if (this.resizeGL) this.resizeGL();
  },

  /* ---------- geometría ---------- */
  rotPt(px, py) {
    const N = W.N;
    switch (Cam.rot) { case 0: return [px, py]; case 1: return [N - py, px]; case 2: return [N - px, N - py]; default: return [py, N - px]; }
  },
  unrotPt(qx, qy) {
    const N = W.N;
    switch (Cam.rot) { case 0: return [qx, qy]; case 1: return [qy, N - qx]; case 2: return [N - qx, N - qy]; default: return [N - qy, qx]; }
  },
  proj(px, py) { const [qx, qy] = this.rotPt(px, py); return [(qx - qy) * TW / 2, (qx + qy) * TH / 2]; },
  unproj(sx, sy) { return this.unrotPt(sx / TW + sy / TH, sy / TH - sx / TW); },
  qToTile(qx, qy) {
    const N = W.N;
    switch (Cam.rot) { case 0: return [qx, qy]; case 1: return [qy, N - 1 - qx]; case 2: return [N - 1 - qx, N - 1 - qy]; default: return [N - 1 - qy, qx]; }
  },
  screenToWorld(mx, my) {
    const sx = (mx - this.wpx / 2) / Cam.zoom + Cam.x, sy = (my - this.hpx / 2) / Cam.zoom + Cam.y;
    return this.unproj(sx, sy);
  },
  screenToTile(mx, my) { const [px, py] = this.screenToWorld(mx, my); return [Math.floor(px), Math.floor(py)]; },
  centerOn(px, py) { const [sx, sy] = this.proj(px, py); Cam.x = sx; Cam.y = sy; },
  rotate(dir) {
    const [px, py] = this.unproj(Cam.x, Cam.y);
    Cam.rot = (Cam.rot + dir + 4) % 4;
    this.centerOn(px, py);
  },
  clampCam() {
    const N = W.N;
    const pts = [this.proj(0, 0), this.proj(N, 0), this.proj(N, N), this.proj(0, N)];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    Cam.x = clamp(Cam.x, Math.min(...xs) - 100, Math.max(...xs) + 100);
    Cam.y = clamp(Cam.y, Math.min(...ys) - 100, Math.max(...ys) + 100);
  },
  rotMask(m) { const r = Cam.rot; return ((m << r) | (m >> (4 - r))) & 15; },

  addFx(f) { this.fx.push(f); },

  /* ---------- sprites helpers ---------- */
  /** Dibuja un sprite usando su versión reducida (LOD) cuando la pantalla no necesita tanta resolución. */
  spr(ctx, s, x, y) {
    const L = this.lodLevel;
    if (L) s = Sprites.lod(s, L);
    const f = SPR * (s.k || 1), a = s.a === undefined ? Sprites.pack(s) : s.a;
    if (a) ctx.drawImage(a.cv, a.x, a.y, a.w, a.h, x - s.ox / f, y - s.oy / f, s.dw || a.w / SPR, s.dh || a.h / SPR);
    else ctx.drawImage(s.c, x - s.ox / f, y - s.oy / f, s.dw || s.c.width / SPR, s.dh || s.c.height / SPR);
  },
  /** Aspa de aerogenerador a 'step' de ROT_STEPS pasos dentro de un tercio de vuelta (las 3 aspas son iguales), centrada en el buje. */
  ROT_STEPS: 24,
  rotorSprite(step) {
    const c = this._rotors || (this._rotors = []);
    if (c[step]) return c[step];
    const R = 21, M = 4, sz = (R + M) * 2, cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(sz * SPR);
    const g = cv.getContext('2d'); g.scale(SPR, SPR); g.translate(R + M, R + M);
    const ang = step * (Math.PI * 2 / 3) / this.ROT_STEPS;
    g.strokeStyle = '#f4f6f8'; g.lineWidth = 2.2; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const a = ang + k * Math.PI * 2 / 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R * 0.95); g.stroke(); }
    g.fillStyle = '#c9ced3'; g.beginPath(); g.arc(0, 0, 2.4, 0, Math.PI * 2); g.fill();
    return (c[step] = { c: cv, ox: (R + M) * SPR, oy: (R + M) * SPR });
  },
  treeSpr(tr, h) {
    const row = this._tr || (this._tr = [[], [], [], [], []]), v = (h * 4) | 0;
    return row[tr][v] || (row[tr][v] = Sprites.treeSprite(tr - 1, v));
  },
  /** Igual que spr() pero con escala (árboles). */
  sprScaled(ctx, s, x, y, sc) {
    const L = this.lodLevel;
    if (L) s = Sprites.lod(s, L);
    const f = SPR * (s.k || 1), a = s.a === undefined ? Sprites.pack(s) : s.a;
    if (a) ctx.drawImage(a.cv, a.x, a.y, a.w, a.h, x - s.ox / f * sc, y - s.oy / f * sc, (s.dw || a.w / SPR) * sc, (s.dh || a.h / SPR) * sc);
    else ctx.drawImage(s.c, x - s.ox / f * sc, y - s.oy / f * sc, (s.dw || s.c.width / SPR) * sc, (s.dh || s.c.height / SPR) * sc);
  },

  /* ---------- detalle automático ---------- */
  /** Umbrales (px de pantalla por px de mundo) bajo los que se usa el LOD 2 y el LOD 1, según el nivel de reducción automática. */
  LODS: [[0.5, 1.0], [0.8, 1.6], [1.2, 2.6], [1.8, 4.6]],
  /**
   * Cada 0,5 s recibe los fps medidos. Si el equipo no sostiene el objetivo durante 2 s se pasa a sprites de menor resolución
   * (a la GPU del móvil le cuesta mucho el volumen de texeles que se muestrean); si va sobrado durante 10 s se vuelve a subir,
   * y si subir hace que vuelva a fallar, no se vuelve a intentar durante 5 minutos.
   */
  adapt(fps) {
    if (Game.mode !== 'play') return;
    const a = this._ad || (this._ad = { low: 0, high: 0, wait: 0, lock: 0, t: 0, lastUp: -999 });
    a.t++;
    if (a.wait > 0) { a.wait--; return; }
    if (a.lock > 0) a.lock--;
    const cap = Game.capNow(), tgt = cap > 0 && cap < 60 ? cap : 60;
    if (fps < tgt * 0.66) {
      a.high = 0;
      if (++a.low >= 4 && this.lodBias < this.LODS.length - 1) {
        this.lodBias++; a.low = 0; a.wait = 6;
        if (a.t - a.lastUp < 40) a.lock = 600;
      }
    } else if (fps >= tgt * 0.95) {
      a.low = 0;
      if (++a.high >= 20 && this.lodBias > 0 && a.lock <= 0) { this.lodBias--; a.high = 0; a.wait = 6; a.lastUp = a.t; }
    } else { a.low = 0; a.high = 0; }
  },

  /* ---------- ciclo día/noche ---------- */
  updateNight() {
    if (!this.nightOn) { this.night = 0; return; }
    const tod = (this.time / 150) % 1;                 // ciclo de 150 s
    const sun = Math.sin(tod * Math.PI * 2 + 1.1);
    this.night = smooth((0.22 - sun) / 0.7);
  },

  /* ---------- dibujo principal ---------- */
  draw(dt) {
    const T0 = performance.now(); this._bub = 0; this._sm = 0;
    const ctx = this.ctx, N = W.N, zoom = Cam.zoom, dpr = this.dpr;
    this.time += dt;
    this.updateNight(); this.updateWeather(dt); this.updateBoats(dt);
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.stats.fps = Math.round(this._fpsN / this._fpsAcc); this._fpsAcc = 0; this._fpsN = 0; this.adapt(this.stats.fps); }
    if (this.useGL()) { this.drawGL(dt, T0); return; }        // WebGL (glrender.js); el dibujo 2D de abajo es el respaldo
    this.stats.gl = 0;

    // fondo
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height * 0.45, 40, this.canvas.width / 2, this.canvas.height / 2, Math.max(this.canvas.width, this.canvas.height) * 0.75);
    g.addColorStop(0, '#244a68'); g.addColorStop(1, '#0b1624');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let shx = 0, shy = 0;
    if (Sim.shake > 0) { const s = Math.min(1, Sim.shake) * 7; shx = (Math.random() - 0.5) * s; shy = (Math.random() - 0.5) * s; }
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (this.wpx / 2 - Cam.x * zoom + shx), dpr * (this.hpx / 2 - Cam.y * zoom + shy));
    const vx0 = Cam.x - this.wpx / 2 / zoom, vx1 = Cam.x + this.wpx / 2 / zoom;
    const vy0 = Cam.y - this.hpx / 2 / zoom, vy1 = Cam.y + this.hpx / 2 / zoom;
    this.view = { vx0, vx1, vy0, vy1 };

    this.drawSlab(ctx);

    const ov = this.overlay;
    ctx.imageSmoothingEnabled = true;
    const rot = Cam.rot, zl = zoom * dpr;
    this.setLod(zl);
    const useCache = zoom < 0.7 && ov === 'none';
    const ts = this.tileSprites();
    if (useCache) this.drawGroundCache(ctx); else this.drawGroundChunks(ctx, ts);
    const showTrees = zoom >= 0.38;
    const items = this.collect(ctx, ov, !useCache || showTrees, showTrees, null);
    const [a0, a1, b0, b1] = this._rng;

    const T1 = performance.now();
    if (useCache) this.drawScorch(ctx, N, rot);       // con el suelo por bloques la ceniza ya va dentro de cada bloque
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      switch (it.t) {
        case 0: this.drawTree(ctx, it); break;
        case 1: this.drawBuilding(ctx, it); break;
        case 2: this.drawVehicle(ctx, it); break;
        case 3: this.drawTornado(ctx, it); break;
        case 4: this.drawBoat(ctx, it); break;
      }
    }

    const T2 = performance.now();
    this.drawFx(ctx, dt);
    this.drawImpacts(ctx);
    this.drawPreview(ctx);

    // noche
    const dark = this.night;
    if (dark > 0.02) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const k = dark, r = Math.round(lerp(255, 66, k)), gg = Math.round(lerp(255, 84, k)), bb = Math.round(lerp(255, 150, k));
      const warm = Math.sin(Math.min(1, k) * Math.PI) * 0.25;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${Math.round(r + (255 - r) * warm * 0.2)},${Math.round(gg - warm * 28)},${Math.round(bb - warm * 60)})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      this.drawLights(ctx, items, dark, shx, shy, a0, a1, b0, b1);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawRain(ctx, dt);
    // métricas suavizadas para el visor de FPS (tiempo de JS al emitir comandos, no de GPU)
    const T3 = performance.now(), st = this.stats, k = 0.1;
    st.ms = (st.ms || 0) * (1 - k) + (T3 - T0) * k; st.g = (st.g || 0) * (1 - k) + (T1 - T0) * k; st.i = (st.i || 0) * (1 - k) + (T2 - T1) * k; st.l = (st.l || 0) * (1 - k) + (T3 - T2) * k;
    st.lb = this.lodBias; st.n = items.length; st.bub = this._bub; st.sm = this._sm; st.ch = this._cl ? this._cl.length : 0;
  },

  /** Recoge los objetos visibles (árboles, edificios, vehículos, barcos, tornado) ordenados de atrás a delante. */
  collect(ctx, ov, loop, showTrees, onTile) {
    const N = W.N, rot = Cam.rot, vw = this.view, vx0 = vw.vx0, vx1 = vw.vx1, vy0 = vw.vy0, vy1 = vw.vy1;
    // rango de tiles visibles (coordenadas rotadas)
    const a0 = (vx0 - TW) * 2 / TW, a1 = (vx1 + TW) * 2 / TW;
    const b0 = (vy0 - TH - 110) * 2 / TH, b1 = (vy1 + TH) * 2 / TH;
    this._rng = [a0, a1, b0, b1];
    const items = this.items; items.length = 0;
    if (loop) for (let qy = 0; qy < N; qy++) {
      const qxMin = Math.max(qy + a0, b0 - qy, 0) | 0, qxMax = Math.min(qy + a1, b1 - qy, N - 1);
      for (let qx = qxMin; qx <= qxMax; qx++) {
        let x, y;
        switch (rot) { case 0: x = qx; y = qy; break; case 1: x = qy; y = N - 1 - qx; break; case 2: x = N - 1 - qx; y = N - 1 - qy; break; default: x = N - 1 - qy; y = qx; }
        const i = y * N + x;
        if (ov !== 'none') { if (onTile) onTile(x, y, i, (qx - qy) * TW / 2, (qx + qy) * TH / 2); else this.overlayTile(ctx, ov, x, y, i, (qx - qy) * TW / 2, (qx + qy) * TH / 2); }
        const tr = W.tree[i];
        if (showTrees && tr && !W.road[i]) items.push({ k: qx + qy + 1, t: 0, x: (qx - qy) * TW / 2 + (hash2(x, y, 9) - 0.5) * 12, y: (qx + qy) * TH / 2 + TH / 2 + (hash2(x, y, 10) - 0.5) * 6, tr, h: hash2(x, y, 11) });
      }
    }

    // edificios
    for (const b of W.buildings.values()) {
      let ax, ay, bx, by; const X0 = b.x, Y0 = b.y, X1 = b.x + b.w, Y1 = b.y + b.h;
      switch (rot) {
        case 0: ax = X0; ay = Y0; bx = X1; by = Y1; break;
        case 1: ax = N - Y0; ay = X0; bx = N - Y1; by = X1; break;
        case 2: ax = N - X0; ay = N - Y0; bx = N - X1; by = N - Y1; break;
        default: ax = Y0; ay = N - X0; bx = Y1; by = N - X1;
      }
      const minx = ax < bx ? ax : bx, miny = ay < by ? ay : by, maxx = ax < bx ? bx : ax, maxy = ay < by ? by : ay;
      const sx = (minx - miny) * TW / 2, sy = (minx + miny) * TH / 2;
      let e = b._e;
      if (!e || b._el !== b.lvl || b._ev !== b.v) { e = b._e = Sprites.forBuilding(b); b._el = b.lvl; b._ev = b.v; b._hg = Sprites.H[b.def ? b.key : b.key + b.lvl] || 100; }
      const hgt = b._hg, wd = (b.w + b.h) * TW / 2;
      if (sx + wd / 2 + 8 < vx0 || sx - wd / 2 - 8 > vx1 || sy - hgt - 10 > vy1 || sy + (b.w + b.h) * TH / 2 + 12 < vy0) continue;
      items.push({ k: (minx + maxx) / 2 + (miny + maxy) / 2 + b.id * 1e-6, t: 1, b, e, x: sx, y: sy, hgt });
    }
    // vehículos
    const vehs = Sim.veh, Nn = W.N;
    for (const v of vehs) {
      if (v.pi >= v.path.length - 1) continue;
      const pa = v.path[v.pi], pb = v.path[v.pi + 1];
      const ax = pa % Nn + 0.5, ay = ((pa / Nn) | 0) + 0.5, bx = pb % Nn + 0.5, by = ((pb / Nn) | 0) + 0.5;
      const dx = bx - ax, dy = by - ay;
      const px = ax + dx * v.t + (-dy) * 0.13, py = ay + dy * v.t + dx * 0.13;
      const [qx, qy] = this.rotPt(px, py);
      const sx = (qx - qy) * TW / 2, sy = (qx + qy) * TH / 2;
      if (sx < vx0 - 40 || sx > vx1 + 40 || sy < vy0 - 40 || sy > vy1 + 40) continue;
      const [rdx, rdy] = this.rotPt(ax + dx, ay + dy);
      const [r0x, r0y] = this.rotPt(ax, ay);
      items.push({ k: qx + qy, t: 2, v, qx, qy, alongX: Math.abs(rdx - r0x) > 0.5 });
    }
    // barcos
    for (const b of this.boats) {
      const px = lerp(b.fx, b.tx, b.t) + 0.5, py = lerp(b.fy, b.ty, b.t) + 0.5;
      const [qx, qy] = this.rotPt(px, py), sx = (qx - qy) * TW / 2, sy = (qx + qy) * TH / 2;
      if (sx < vx0 - 40 || sx > vx1 + 40 || sy < vy0 - 60 || sy > vy1 + 40) continue;
      const [r0x, r0y] = this.rotPt(b.fx + 0.5, b.fy + 0.5), [r1x] = this.rotPt(b.tx + 0.5, b.ty + 0.5);
      items.push({ k: qx + qy, t: 4, b, qx, qy, alongX: Math.abs(r1x - r0x) > 0.4 });
    }
    // tornado
    const tor = Sim.tornado;
    if (tor) { const [qx, qy] = this.rotPt(tor.x, tor.y); items.push({ k: qx + qy, t: 3, qx, qy, tor }); }

    items.sort((p, q) => p.k - q.k);
    return items;
  },
  setLod(zl) {
    const LB = this.LODS[this.lodBias];
    this.lodLevel = zl <= LB[0] ? 2 : zl <= LB[1] ? 1 : 0;
  },

  /* ---------- suelo ---------- */
  /** Sprites de cada casilla (suelo, calle con su máscara, agua con costa, zona); se recalculan solo si cambia el suelo o la rotación. */
  tileSprites() {
    const N = W.N, c = this._ts;
    if (c && c.ver === W.gver && c.rot === Cam.rot && c.N === N && c.seed === W.seed) return c;
    const g = new Array(N * N), z = new Array(N * N), rp = new Array(N * N), ph = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, ter = W.ter[i], rd = W.road[i];
      if (rd) g[i] = Sprites.roadTile(rd, this.rotMask(W.roadMask(x, y)), ter === TER.WATER ? 'w' : ter === TER.SAND ? 's' : 'g');
      else if (ter === TER.WATER) {
        let m = 0;
        for (let d = 0; d < 4; d++) { const a = x + DX[d], b = y + DY[d]; if (W.inb(a, b) && W.ter[b * N + a] !== TER.WATER) m |= 1 << d; }
        g[i] = Sprites.waterTile(this.rotMask(m));
        const h = hash2(x, y, 5); rp[i] = Sprites.rippleTile((h * 4) | 0); ph[i] = h * 6.28;
      } else g[i] = Sprites.groundTile(ter === TER.SAND ? 'sand' : 'grass', (hash2(x, y, 3) * 4) | 0);
      if (W.zone[i] && !rd) z[i] = Sprites.zoneTile(W.zone[i]);
    }
    const nt = { ver: W.gver, rot: Cam.rot, N, seed: W.seed, g, z, rp, ph };
    // los bloques de suelo solo se invalidan donde algún sprite de casilla ha cambiado
    if (c && c.N === N && c.rot === Cam.rot && c.seed === W.seed) this.markChangedChunks(c, nt); else this.freeChunks();
    return (this._ts = nt);
  },
  /** Índice (cy*G+cx) del bloque que contiene la casilla i, según la rotación actual. */
  chunkOfTile(i, N, rot) {
    const x = i % N, y = (i / N) | 0; let qx, qy;
    switch (rot) { case 0: qx = x; qy = y; break; case 1: qx = N - 1 - y; qy = x; break; case 2: qx = N - 1 - x; qy = N - 1 - y; break; default: qx = y; qy = N - 1 - x; }
    return ((qy / this.CH) | 0) * Math.ceil(N / this.CH) + ((qx / this.CH) | 0);
  },
  markChangedChunks(a, b) {
    const s = this._ch; if (!s || s.N !== b.N || s.rot !== b.rot) return;
    const N = b.N, n = N * N;
    for (let i = 0; i < n; i++) {
      if (a.g[i] === b.g[i] && a.z[i] === b.z[i] && a.rp[i] === b.rp[i]) continue;
      const e = s.map.get(this.chunkOfTile(i, N, b.rot)); if (e) e.ver++;
    }
  },
  groundTile(ctx, qx, qy, x, y, i, ripple, ts) {
    const sx = (qx - qy) * TW / 2, sy = (qx + qy) * TH / 2;
    this.spr(ctx, ts.g[i], sx, sy);
    if (ripple && ts.rp[i]) {
      ctx.globalAlpha = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(this.time * 1.3 + ts.ph[i]));
      this.spr(ctx, ts.rp[i], sx, sy);
      ctx.globalAlpha = 1;
    }
    if (ts.z[i]) this.spr(ctx, ts.z[i], sx, sy);
  },
  /** Cenizas de incendios/impactos: dinámicas (se desvanecen), así que se pintan aparte del suelo cacheado. */
  drawScorch(ctx, N, rot) {
    const sc = W.scorch, s = Sprites.plainDiamond('#15100c', 1);
    for (let i = 0; i < sc.length; i++) {
      if (!sc[i]) continue;
      const x = i % N, y = (i / N) | 0; let qx, qy;
      switch (rot) { case 0: qx = x; qy = y; break; case 1: qx = N - 1 - y; qy = x; break; case 2: qx = N - 1 - x; qy = N - 1 - y; break; default: qx = y; qy = N - 1 - x; }
      ctx.globalAlpha = Math.min(0.55, sc[i] / 120);
      this.spr(ctx, s, (qx - qy) * TW / 2, (qx + qy) * TH / 2);
    }
    ctx.globalAlpha = 1;
  },
  drawGroundCache(ctx) {
    const N = W.N, s = 0.5;
    let c = this._gc;
    if (!c || c.ver !== W.gver || c.rot !== Cam.rot || c.N !== N || c.seed !== W.seed) {
      const minX = -N * TW / 2 - TW, maxX = N * TW / 2 + TW, minY = -12, maxY = N * TH + TH + 8;
      const cv = c ? c.cv : document.createElement('canvas');
      cv.width = Math.ceil((maxX - minX) * s); cv.height = Math.ceil((maxY - minY) * s);
      const g = cv.getContext('2d'); g.setTransform(s, 0, 0, s, -minX * s, -minY * s);
      g.imageSmoothingEnabled = true;
      const ts = this.tileSprites(), keep = this.lodLevel; this.lodLevel = 0;
      for (let qy = 0; qy < N; qy++) for (let qx = 0; qx < N; qx++) { const [x, y] = this.qToTile(qx, qy); this.groundTile(g, qx, qy, x, y, y * N + x, false, ts); }
      this.lodLevel = keep;
      c = this._gc = { cv, minX, minY, s, ver: W.gver, rot: Cam.rot, N, seed: W.seed };
    }
    ctx.drawImage(c.cv, c.minX, c.minY, c.cv.width / c.s, c.cv.height / c.s);
  },

  /* ---------- suelo por bloques ---------- */
  /**
   * Con zoom >= 0,7 el suelo se pinta con bloques de CH×CH casillas (coordenadas rotadas) que se dibujan una sola vez:
   * suelo + ceniza en un lienzo y, si el bloque tiene agua, dos capas de ondas que se animan por opacidad en contrafase.
   * Cada nivel de detalle (LOD) tiene su propia versión; un bloque solo se reconstruye si cambia su contenido.
   * Lo que no cabe en el presupuesto de reconstrucción de este fotograma se pinta casilla a casilla como antes.
   */
  chunkStore() {
    const N = W.N, s = this._ch;
    if (s && s.N === N && s.rot === Cam.rot && s.seed === W.seed && s.q === this.quality) return s;
    this.freeChunks();
    const G = Math.ceil(N / this.CH);
    return (this._ch = { N, G, rot: Cam.rot, seed: W.seed, q: this.quality, map: new Map(), px: 0, frame: 0, sig: new Int32Array(G * G) });
  },
  freeChunks() {
    const s = this._ch; if (!s) return;
    for (const e of s.map.values()) for (const v of e.v) if (v) for (const cv of v.cvs) if (cv) cv.width = cv.height = 0;
    this._ch = null;
  },
  /** Caja del bloque en coordenadas de mundo (margen para los sprites de casilla) → this._cb = [minX, minY, maxX, maxY]. */
  chunkBounds(cx, cy, N) {
    const CH = this.CH, x0 = cx * CH, y0 = cy * CH, x1 = Math.min(N, x0 + CH), y1 = Math.min(N, y0 + CH), b = this._cb;
    b[0] = (x0 - y1 + 1) * TW / 2 - 38; b[1] = (x0 + y0) * TH / 2 - 14;
    b[2] = (x1 - 1 - y0) * TW / 2 + 38; b[3] = (x1 + y1 - 2) * TH / 2 + TH + 18;
    return b;
  },
  /** Firma de ceniza por bloque (cambia cuando un fuego deja ceniza o ésta se desvanece un escalón). */
  scanScorch(s) {
    const sig = s.sig, sc = W.scorch, N = s.N, G = s.G, CH = this.CH, rot = s.rot;
    sig.fill(0);
    for (let i = 0; i < sc.length; i++) {
      const v = sc[i]; if (!v) continue;
      const x = i % N, y = (i / N) | 0; let qx, qy;
      switch (rot) { case 0: qx = x; qy = y; break; case 1: qx = N - 1 - y; qy = x; break; case 2: qx = N - 1 - x; qy = N - 1 - y; break; default: qx = y; qy = N - 1 - x; }
      sig[((qy / CH) | 0) * G + ((qx / CH) | 0)] += (v >= 66 ? 12 : 1 + ((v / 6) | 0)) * (1 + i % 61);
    }
  },
  buildChunk(s, e, lod, ts) {
    const N = s.N, CH = this.CH, S = 2 / (1 << lod), x0 = e.cx * CH, y0 = e.cy * CH, x1 = Math.min(N, x0 + CH), y1 = Math.min(N, y0 + CH);
    const b = this.chunkBounds(e.cx, e.cy, N), minX = b[0], minY = b[1], bw = b[2] - b[0], bh = b[3] - b[1];
    let v = e.v[lod];
    if (!v) v = e.v[lod] = { cvs: [document.createElement('canvas'), null, null], ver: -1, sig: 0, px: 0, used: 0, rip: false, minX, minY, S };
    s.px -= v.px;
    const cv = v.cvs[0]; cv.width = Math.ceil(bw * S); cv.height = Math.ceil(bh * S);
    const g = cv.getContext('2d'); g.setTransform(S, 0, 0, S, -minX * S, -minY * S); g.imageSmoothingEnabled = true;
    const keep = this.lodLevel; this.lodLevel = lod;
    const dia = this._dia || (this._dia = Sprites.plainDiamond('#15100c', 1));
    let water = false;
    for (let qy = y0; qy < y1; qy++) for (let qx = x0; qx < x1; qx++) {
      const [x, y] = this.qToTile(qx, qy), i = y * N + x;
      this.groundTile(g, qx, qy, x, y, i, false, ts);
      if (ts.rp[i]) water = true;
    }
    for (let qy = y0; qy < y1; qy++) for (let qx = x0; qx < x1; qx++) {          // ceniza: encima de todo el suelo del bloque
      const [x, y] = this.qToTile(qx, qy), sc = W.scorch[y * N + x];
      if (!sc) continue;
      g.globalAlpha = Math.min(0.55, sc / 120);
      this.spr(g, dia, (qx - qy) * TW / 2, (qx + qy) * TH / 2);
    }
    g.globalAlpha = 1;
    let px = cv.width * cv.height;
    // capas de ondas (resolución reducida: son sutiles)
    v.rip = water && this.quality !== 'low';
    if (v.rip) {
      const RL = Math.min(2, lod + 1), RS = 2 / (1 << RL), rw = Math.ceil(bw * RS), rh = Math.ceil(bh * RS), rg = [null, null];
      for (let k = 1; k <= 2; k++) {
        const rc = v.cvs[k] || (v.cvs[k] = document.createElement('canvas')); rc.width = rw; rc.height = rh;
        rg[k - 1] = rc.getContext('2d'); rg[k - 1].setTransform(RS, 0, 0, RS, -minX * RS, -minY * RS); rg[k - 1].imageSmoothingEnabled = true;
      }
      this.lodLevel = RL;
      for (let qy = y0; qy < y1; qy++) for (let qx = x0; qx < x1; qx++) {
        const [x, y] = this.qToTile(qx, qy), i = y * N + x;
        if (ts.rp[i]) this.spr(rg[ts.ph[i] < Math.PI ? 0 : 1], ts.rp[i], (qx - qy) * TW / 2, (qx + qy) * TH / 2);
      }
      px += 2 * rw * rh;
    } else for (let k = 1; k <= 2; k++) if (v.cvs[k]) v.cvs[k].width = v.cvs[k].height = 0;
    this.lodLevel = keep;
    v.ver = e.ver; v.sig = s.sig[e.cy * s.G + e.cx]; v.px = px; v.minX = minX; v.minY = minY; v.S = S; s.px += px;
    return v;
  },
  drawGroundChunks(ctx, ts) {
    const s = this.chunkStore(), N = s.N, G = s.G, CH = this.CH, lod = this.lodLevel, vw = this.view, rot = s.rot;
    this.scanScorch(s);
    s.frame++;
    const list = this._cl || (this._cl = []); list.length = 0;
    const t0 = performance.now(), budget = 6, ripple = this.quality !== 'low';
    let built = 0;
    for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) {
      const b = this.chunkBounds(cx, cy, N);
      if (b[2] < vw.vx0 || b[0] > vw.vx1 || b[3] < vw.vy0 || b[1] > vw.vy1) continue;
      const id = cy * G + cx;
      let e = s.map.get(id); if (!e) { e = { cx, cy, ver: 0, v: [null, null, null] }; s.map.set(id, e); }
      let v = e.v[lod];
      if (!v || v.ver !== e.ver || v.sig !== s.sig[id]) {
        if (built === 0 || performance.now() - t0 < budget) { v = this.buildChunk(s, e, lod, ts); built++; }
        else {                                                    // sin presupuesto: este bloque se pinta casilla a casilla en este fotograma
          for (let qy = cy * CH; qy < Math.min(N, cy * CH + CH); qy++) for (let qx = cx * CH; qx < Math.min(N, cx * CH + CH); qx++) {
            const [x, y] = this.qToTile(qx, qy), i = y * N + x;
            this.groundTile(ctx, qx, qy, x, y, i, ripple, ts);
            const sc = W.scorch[i];
            if (sc) { ctx.globalAlpha = Math.min(0.55, sc / 120); this.spr(ctx, this._dia || (this._dia = Sprites.plainDiamond('#15100c', 1)), (qx - qy) * TW / 2, (qx + qy) * TH / 2); ctx.globalAlpha = 1; }
          }
          continue;
        }
      }
      v.used = s.frame;
      ctx.drawImage(v.cvs[0], v.minX, v.minY, v.cvs[0].width / v.S, v.cvs[0].height / v.S);
      if (v.rip) list.push(v);
    }
    if (list.length) {                                            // ondas del agua: dos capas en contrafase
      const t = this.time * 1.3, RS = 2 / (1 << Math.min(2, lod + 1));
      for (let k = 0; k < 2; k++) {
        ctx.globalAlpha = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(t + k * Math.PI));
        for (let n = 0; n < list.length; n++) { const v = list[n], rc = v.cvs[k + 1]; ctx.drawImage(rc, v.minX, v.minY, rc.width / RS, rc.height / RS); }
      }
      ctx.globalAlpha = 1;
    }
    // presupuesto de memoria: se descartan los bloques que llevan más tiempo sin verse
    const cap = this.quality === 'high' ? 28e6 : this.quality === 'medium' ? 14e6 : 8e6;
    if (s.px > cap) {
      const old = [];
      for (const e of s.map.values()) for (let l = 0; l < 3; l++) { const v = e.v[l]; if (v && v.used !== s.frame && v.px) old.push([v, e, l]); }
      old.sort((p, q) => p[0].used - q[0].used);
      for (let n = 0; n < old.length && s.px > cap; n++) { const [v, e, l] = old[n]; for (const cv of v.cvs) if (cv) cv.width = cv.height = 0; s.px -= v.px; e.v[l] = null; }
    }
  },

  /* ---------- luces nocturnas ---------- */
  /**
   * Las ventanas encendidas y las farolas se componen en un búfer aparte siguiendo el mismo orden de
   * profundidad que la escena: cada edificio (o árbol) tapa primero con su silueta negra lo que hay detrás
   * y luego aporta sus propias luces. El búfer se suma al final con mezcla aditiva.
   */
  drawLights(ctx, items, dark, shx, shy, a0, a1, b0, b1) {
    const N = W.N, zoom = Cam.zoom, dpr = this.dpr, cw = this.canvas.width, ch = this.canvas.height;
    if (zoom < 0.4 || this.quality === 'low') return;          // a distancia las ventanas son invisibles: no se calcula la capa
    if (!this._lb || this._lb.width !== cw || this._lb.height !== ch) { this._lb = document.createElement('canvas'); this._lb.width = cw; this._lb.height = ch; this._lbc = this._lb.getContext('2d'); }
    const lc = this._lbc;
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.clearRect(0, 0, cw, ch);
    lc.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (this.wpx / 2 - Cam.x * zoom + shx), dpr * (this.hpx / 2 - Cam.y * zoom + shy));
    // farolas como elementos con profundidad propia (un edificio delante las tapa; una farola delante tapa al edificio)
    let list = items;
    const heads = zoom > 0.5 && dark > 0.3;
    if (zoom >= 0.7) {                                          // a menos zoom las farolas son invisibles: ni se dibujan ni se ordenan
      list = items.slice();
      for (let qy = 0; qy < N; qy++) {
        const qxMin = Math.max(qy + a0, b0 - qy, 0) | 0, qxMax = Math.min(qy + a1, b1 - qy, N - 1);
        for (let qx = qxMin; qx <= qxMax; qx++) {
          if ((qx + qy) % 2) continue;
          const [x, y] = this.qToTile(qx, qy);
          if (!W.road[y * N + x]) continue;
          list.push({ k: qx + qy + 1.001, t: 9, x: (qx - qy) * TW / 2, y: (qx + qy + 1) * TH / 2 });
        }
      }
      list.sort((p, q) => p.k - q.k);
    }
    for (let n = 0; n < list.length; n++) {
      const it = list[n];
      if (it.t === 1) {
        const e = it.e;
        this.spr(lc, it.b.on ? Sprites.nightMask(e, it.b) : Sprites.sil(e.base), it.x, it.y);       // silueta opaca + ventanas, un solo dibujado
      } else if (it.t === 0) {
        this.sprScaled(lc, Sprites.sil(this.treeSpr(it.tr, it.h)), it.x, it.y, 0.85 + it.h * 0.3);
      } else if (it.t === 9) {
        const a = this.lodLevel ? (this.sLamp.a || Sprites.pack(this.sLamp, true)) : null;
        if (a) lc.drawImage(a.cv, a.x, a.y, a.w, a.h, it.x - 15, it.y - 14, 30, 30); else lc.drawImage(this.glowLamp, it.x - 15, it.y - 14, 30, 30);
      } else if (it.t === 2 && heads) {                               // faros del coche
        const sx = (it.qx - it.qy) * TW / 2, sy = (it.qx + it.qy) * TH / 2;
        const a = this.lodLevel ? (this.sCar.a || Sprites.pack(this.sCar, true)) : null;
        if (a) lc.drawImage(a.cv, a.x, a.y, a.w, a.h, sx - 9, sy - 12, 18, 18); else lc.drawImage(this.glowCar, sx - 9, sy - 12, 18, 18);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, dark * 1.2);
    ctx.drawImage(this._lb, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },

  /* ---------- base del mapa ---------- */
  /** Emite los polígonos de la base del mapa como (color, [x0,y0,x1,y1,x2,y2,x3,y3]); solo los lados visibles. */
  slabPolys(emit) {
    const N = W.N, T = 20, vw = this.view, mg = 6;
    const A = this.proj(0, 0), B = this.proj(N, 0), C = this.proj(N, N), D = this.proj(0, N);
    emit('#2f7fc2', [A[0], A[1], B[0], B[1], C[0], C[1], D[0], D[1]]);
    for (let k = 0; k < N; k++) {
      // cara izquierda (qy = N-1) y derecha (qx = N-1); solo las que caen dentro de la vista
      const lx0 = (k - N) * TW / 2, ly0 = (k + N) * TH / 2, rx1 = (N - k) * TW / 2, ry0 = (N + k) * TH / 2;
      const visL = lx0 + TW / 2 >= vw.vx0 - mg && lx0 <= vw.vx1 + mg && ly0 + TH / 2 + T + mg >= vw.vy0 && ly0 <= vw.vy1 + mg;
      const visR = rx1 >= vw.vx0 - mg && rx1 - TW / 2 <= vw.vx1 + mg && ry0 + TH / 2 + T + mg >= vw.vy0 && ry0 <= vw.vy1 + mg;
      if (!visL && !visR) continue;
      const [lx, ly] = this.qToTile(k, N - 1), [rx, ry] = this.qToTile(N - 1, k);
      const lt = W.ter[ly * N + lx], rt = W.ter[ry * N + rx];
      let p0x = (k - N) * TW / 2, p0y = (k + N) * TH / 2, p1x = (k + 1 - N) * TW / 2, p1y = (k + 1 + N) * TH / 2;
      if (visL) {
        emit(lt === TER.WATER ? '#2373b3' : '#7a5a3c', [p0x, p0y, p1x, p1y, p1x, p1y + T, p0x, p0y + T]);
        if (lt !== TER.WATER) emit(lt === TER.SAND ? '#d9c58c' : '#58963f', [p0x, p0y, p1x, p1y, p1x, p1y + 4, p0x, p0y + 4]);
      }
      if (!visR) continue;
      p0x = (N - k) * TW / 2; p0y = (N + k) * TH / 2; p1x = (N - k - 1) * TW / 2; p1y = (N + k + 1) * TH / 2;
      emit(rt === TER.WATER ? '#185a92' : '#5d442c', [p0x, p0y, p1x, p1y, p1x, p1y + T, p0x, p0y + T]);
      if (rt !== TER.WATER) emit(rt === TER.SAND ? '#c4b177' : '#477f33', [p0x, p0y, p1x, p1y, p1x, p1y + 4, p0x, p0y + 4]);
    }
  },
  drawSlab(ctx) {
    this.slabPolys((col, p) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.lineTo(p[6], p[7]); ctx.closePath(); ctx.fill();
    });
  },

  /* ---------- superposiciones de datos ---------- */
  heat(v) {
    v = clamp(v, 0, 1);
    const r = v < 0.5 ? lerp(60, 250, v * 2) : 250, g = v < 0.5 ? 210 : lerp(210, 60, (v - 0.5) * 2);
    return [Math.round(r), Math.round(g), 70];
  },
  /** Color [r,g,b,a] de la vista de datos para una casilla (o null). */
  overlayColor(ov, i) {
    let col = null, a = 0.5;
    const b = W.bid[i] ? W.buildings.get(W.bid[i]) : null;
    switch (ov) {
      case 'power': if (b) { col = b.pw ? [70, 220, 120] : [240, 70, 70]; } else if (W.road[i]) { col = Sim.rP[W.comp[i]] > 0 ? [250, 220, 90] : null; a = 0.35; } break;
      case 'water': if (b) { col = b.wt ? [70, 170, 240] : [240, 70, 70]; } else if (W.road[i]) { col = Sim.rW[W.comp[i]] > 0 ? [90, 200, 250] : null; a = 0.35; } break;
      case 'pollution': col = this.heat(W.pol[i]); a = 0.15 + W.pol[i] * 0.6; break;
      case 'crime': col = this.heat(W.crime[i]); a = 0.15 + W.crime[i] * 0.6; break;
      case 'lv': col = this.heat(1 - W.lv[i] / 100); a = 0.5; break;
      case 'traffic': if (W.road[i]) { col = this.heat(W.traf[i] * 1.2); a = 0.8; } break;
      case 'happy': if (b && b.key === 'R') { col = this.heat(1 - b.happy / 100); a = 0.7; } break;
      case 'police': case 'fire': case 'health': case 'edu': case 'rec': case 'transit': case 'garbage': {
        const v = W.cov[ov][i]; if (v > 0.02) { col = [60, 150 + v * 90, 255]; a = 0.15 + v * 0.55; } break;
      }
    }
    return col ? [col[0], col[1], col[2], a] : null;
  },
  overlayTile(ctx, ov, x, y, i, sx, sy) {
    const c = this.overlayColor(ov, i); if (!c) return;
    ctx.globalAlpha = c[3];
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + TW / 2, sy + TH / 2); ctx.lineTo(sx, sy + TH); ctx.lineTo(sx - TW / 2, sy + TH / 2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  },

  /* ---------- clima y barcos ---------- */
  updateWeather(dt) {
    if (Game.mode === 'play' || Game.mode === 'title') this.rainT -= dt;
    if (this.rainT <= 0) { this.raining = !this.raining; this.rainT = this.raining ? 25 + Math.random() * 35 : 100 + Math.random() * 160; }
    const target = this.raining && this.weatherOn ? 1 : 0;
    this.rain += (target - this.rain) * Math.min(1, dt * 0.5);
  },
  drawRain(ctx, dt) {
    if (this.rain < 0.03) return;
    const w = this.canvas.width, h = this.canvas.height, dpr = this.dpr;
    if (!this.drops) this.drops = Array.from({ length: this.quality === 'low' ? 140 : 320 }, () => ({ x: Math.random(), y: Math.random(), s: 0.7 + Math.random() * 0.6 }));
    ctx.fillStyle = `rgba(18,28,46,${0.26 * this.rain})`; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(200,222,245,${0.5 * this.rain})`; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
    const n = Math.floor(this.drops.length * this.rain);
    for (let i = 0; i < n; i++) {
      const d = this.drops[i]; d.y += dt * 1.5 * d.s; d.x -= dt * 0.12 * d.s;
      if (d.y > 1) { d.y -= 1.1; d.x = Math.random() * 1.2; } if (d.x < -0.05) d.x += 1.1;
      const x = d.x * w, y = d.y * h, l = 16 * dpr * d.s;
      ctx.moveTo(x, y); ctx.lineTo(x - l * 0.16, y + l);
    }
    ctx.stroke();
  },
  initBoats() {
    this.boats = []; const N = W.N, key = W.seed + ':' + N; this._boatKey = key;
    const open = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      let ok = true; for (let d = 0; d < 4; d++) if (W.ter[(y + DY[d]) * N + x + DX[d]] !== TER.WATER) ok = false;
      if (ok && W.ter[y * N + x] === TER.WATER) open.push([x, y]);
    }
    const cnt = Math.min(open.length, Math.max(3, Math.round(N / 9)));
    for (let k = 0; k < cnt; k++) { const [x, y] = open[(Math.random() * open.length) | 0]; this.boats.push({ fx: x, fy: y, tx: x, ty: y, t: 1, sp: 0.28 + Math.random() * 0.25, d: (Math.random() * 4) | 0, col: pick(['#f4f4f0', '#e9e2c8', '#d95b50', '#e8b84a']) }); }
  },
  updateBoats(dt) {
    if (this._boatKey !== W.seed + ':' + W.N) this.initBoats();
    const N = W.N, free = (x, y) => x > 0 && y > 0 && x < N - 1 && y < N - 1 && W.ter[y * N + x] === TER.WATER && !W.road[y * N + x];
    for (const b of this.boats) {
      b.t += b.sp * dt;
      if (b.t >= 1) {
        b.fx = b.tx; b.fy = b.ty; b.t = 0;
        if (!free(b.fx, b.fy)) { b.d = (b.d + 2) % 4; }
        const opts = [];
        for (let d = 0; d < 4; d++) if (free(b.fx + DX[d], b.fy + DY[d]) && d !== (b.d + 2) % 4) opts.push(d);
        let nd = b.d;
        if (!(opts.includes(b.d) && Math.random() < 0.7)) nd = opts.length ? opts[(Math.random() * opts.length) | 0] : (b.d + 2) % 4;
        b.d = nd; b.tx = b.fx + DX[nd]; b.ty = b.fy + DY[nd];
        if (!free(b.tx, b.ty)) { b.tx = b.fx; b.ty = b.fy; }
      }
    }
  },
  drawBoat(ctx, it) {
    const b = it.b, P = Sprites.P, mat = Sprites.mat;
    const sx = (it.qx - it.qy) * TW / 2, sy = (it.qx + it.qy) * TH / 2;
    ctx.save(); ctx.translate(sx, sy + Math.sin(this.time * 2 + b.fx) * 0.8);
    const lu = it.alongX ? 0.2 : 0.09, lv = it.alongX ? 0.09 : 0.2;
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(0, 1, 15, 6, 0, 0, 7); ctx.fill();
    Sprites.box(ctx, -lu, -lv, lu, lv, 0, 4, mat(b.col));
    const [mx, my] = P(0, 0, 4), [tx, ty] = P(0, 0, 26);
    ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = '#fbfbf6'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + (it.alongX ? 9 : -9), my - 1); ctx.lineTo(tx, my - 2); ctx.closePath(); ctx.fill();
    ctx.restore();
  },

  /* ---------- objetos ---------- */
  drawTree(ctx, it) {
    this.sprScaled(ctx, this.treeSpr(it.tr, it.h), it.x, it.y, 0.85 + it.h * 0.3);
  },
  drawBuilding(ctx, it, noSprite) {
    const b = it.b, e = it.e, t = this.time;
    ctx.globalAlpha = 1;
    if (!noSprite) this.spr(ctx, e.base, it.x, it.y);
    const A = Sprites.ANCH[b.def ? b.key : b.key + b.lvl];
    const P = Sprites.P;
    if (A && Cam.zoom > 0.4) {
      if (A.smoke && b.on && this.quality !== 'low') {
        for (const [u, v, z] of A.smoke) {
          this._sm++;
          const [px, py] = P(u, v, z);
          for (let k = 0; k < 4; k++) {
            const ph = (t * 0.22 + k / 4 + b.id * 0.37) % 1;
            ctx.globalAlpha = (1 - ph) * 0.42;
            ctx.fillStyle = '#7d848b';
            ctx.beginPath(); ctx.arc(it.x + px + ph * 14, it.y + py - ph * 34, 3 + ph * 7, 0, 7); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      if (A.steam && b.on && this.quality !== 'low') {
        for (const [u, v, z] of A.steam) {
          const [px, py] = P(u, v, z);
          for (let k = 0; k < 5; k++) {
            const ph = (t * 0.16 + k / 5 + b.id * 0.21) % 1;
            ctx.globalAlpha = (1 - ph) * 0.55; ctx.fillStyle = '#f2f5f8';
            ctx.beginPath(); ctx.arc(it.x + px + Math.sin(ph * 4 + k) * 3 + ph * 8, it.y + py - ph * 40, 6 + ph * 11, 0, 7); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      if (A.rotor && !noSprite) {                  // con WebGL el aspa es un sprite con profundidad (glrender.js): un edificio delante la tapa
        const [px, py] = P(A.rotor[0], A.rotor[1], A.rotor[2]);
        const hx = it.x + px, hy = it.y + py, ang = t * 1.8 + b.id;
        ctx.strokeStyle = '#f4f6f8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const a = ang + k * Math.PI * 2 / 3;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 21, hy + Math.sin(a) * 21 * 0.95); ctx.stroke();
        }
        ctx.fillStyle = '#c9ced3'; ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, 7); ctx.fill();
      }
      if (A.siren && b.on) {
        const [px, py] = P(A.siren[0], A.siren[1], A.siren[2]);
        const on = Math.floor(t * 3 + b.id) % 2;
        ctx.fillStyle = on ? 'rgba(255,60,60,0.95)' : 'rgba(70,120,255,0.95)';
        ctx.beginPath(); ctx.arc(it.x + px, it.y + py, 2.6, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(it.x + px, it.y + py, 6, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    // fuego
    if (b.fire) {
      const cx = it.x + (b.w - b.h) * TW / 4, cy = it.y + (b.w + b.h) * TH / 4;
      const s = 0.6 + Math.sqrt(b.w * b.h) * 0.45;
      for (let k = 0; k < 4; k++) {
        const ph = (t * 0.5 + k / 4 + b.id * 0.13) % 1;
        ctx.globalAlpha = (1 - ph) * 0.55; ctx.fillStyle = '#35373a';
        ctx.beginPath(); ctx.arc(cx + ph * 10, cy - 18 * s - ph * 44, 5 + ph * 11, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let k = 0; k < 5; k++) {
        const ph = t * 7 + b.id * 1.7 + k * 2.1;
        const fx = cx + (k - 2) * 7 * s + Math.sin(ph) * 1.5, h = (13 + Math.sin(ph * 1.3) * 5 + (k % 2) * 6) * s, wdt = 5.5 * s;
        const by = cy - 10 * s - (k % 2) * 3;
        ctx.fillStyle = '#e8541c';
        ctx.beginPath(); ctx.moveTo(fx - wdt, by); ctx.quadraticCurveTo(fx - wdt * 0.2, by - h * 0.55, fx + Math.sin(ph * 0.7) * 2, by - h); ctx.quadraticCurveTo(fx + wdt * 0.2, by - h * 0.5, fx + wdt, by); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath(); ctx.moveTo(fx - wdt * 0.55, by); ctx.quadraticCurveTo(fx, by - h * 0.5, fx + Math.sin(ph * 0.7) * 1.5, by - h * 0.62); ctx.quadraticCurveTo(fx + wdt * 0.1, by - h * 0.3, fx + wdt * 0.55, by); ctx.closePath(); ctx.fill();
      }
    }
    // burbuja de aviso
    if (!b.on && Cam.zoom > 0.5 && (b.key === 'R' || b.key === 'C' || b.key === 'I' || b.def)) {
      let ic = null;
      if (b.acc < 0) ic = '🚧'; else if (!b.pw) ic = '⚡'; else if (!b.wt) ic = '💧';
      if (ic) {
        this._bub++;
        const bx = it.x + (b.w - b.h) * TW / 4, by = it.y - it.hgt * 0.55 - 6 + Math.sin(t * 3 + b.id) * 2;
        ctx.fillStyle = 'rgba(20,24,34,0.85)'; ctx.beginPath(); ctx.arc(bx, by, 9, 0, 7); ctx.fill();
        ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.font = "11px 'Segoe UI Emoji','Apple Color Emoji',sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText(ic, bx, by + 1);
      }
    }
  },
  vehSprite(it) {
    const v = it.v, o = it.alongX ? 1 : 0, vs = v._sp || (v._sp = [null, null]);
    return vs[o] || (vs[o] = Sprites.vehicle(v.kind, v.color, it.alongX));
  },
  drawVehicle(ctx, it, noSprite) {
    const v = it.v, sx = (it.qx - it.qy) * TW / 2, sy = (it.qx + it.qy) * TH / 2;
    if (!noSprite) this.spr(ctx, this.vehSprite(it), sx, sy);
    if (v.kind === 'fire') {
      ctx.fillStyle = Math.floor(this.time * 6) % 2 ? '#ff4040' : '#4080ff'; ctx.beginPath(); ctx.arc(sx, sy - 8.5, 1.8, 0, 7); ctx.fill();
    }
  },
  drawTornado(ctx, it) {
    const sx = (it.qx - it.qy) * TW / 2, sy = (it.qx + it.qy) * TH / 2, t = it.tor.spin;
    ctx.save(); ctx.translate(sx, sy);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 2, 20, 9, 0, 0, 7); ctx.fill();
    const layers = 14;
    for (let k = 0; k < layers; k++) {
      const f = k / (layers - 1), y = -f * 120, r = 8 + f * 34;
      ctx.fillStyle = `rgba(${70 + f * 40},${74 + f * 40},${86 + f * 40},${0.78 - f * 0.2})`;
      ctx.beginPath(); ctx.ellipse(Math.sin(t * 0.5 + f * 3) * 4 * f, y, r, r * 0.38, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(40,44,52,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(Math.sin(t * 0.5 + f * 3) * 4 * f, y, r, r * 0.38, 0, t + f * 4, t + f * 4 + 2.2); ctx.stroke();
    }
    ctx.fillStyle = '#5a4a3a';
    for (let k = 0; k < 10; k++) { const a = t * 1.5 + k * 0.7, f = (k % 5) / 5; ctx.fillRect(Math.cos(a) * (14 + f * 28), -f * 90 + Math.sin(a) * 5, 2.5, 2.5); }
    ctx.restore();
  },

  /* ---------- efectos ---------- */
  drawFx(ctx, dt) {
    for (let k = this.fx.length - 1; k >= 0; k--) {
      const f = this.fx[k]; f.t += dt;
      if (f.t >= f.dur) { this.fx.splice(k, 1); continue; }
      const [sx, sy] = this.proj(f.x, f.y), p = f.t / f.dur;
      if (f.type === 'dust') {
        ctx.fillStyle = f.col || '#d9d1bd';
        for (let n = 0; n < 7; n++) {
          const a = n * 0.9 + f.seed, r = (6 + p * 22) * (f.big || 1);
          ctx.globalAlpha = (1 - p) * 0.5;
          ctx.beginPath(); ctx.arc(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.5 - p * 14, 3 + p * 5, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (f.type === 'boom') {
        ctx.globalAlpha = 1 - p;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20 + p * 150);
        g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.3, 'rgba(255,150,50,0.9)'); g.addColorStop(1, 'rgba(120,40,20,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy - 10, 30 + p * 170, (20 + p * 110) * 0.55, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#3a2a22';
        for (let n = 0; n < 12; n++) { const a = n * 0.52, r = p * 130; ctx.fillRect(sx + Math.cos(a) * r, sy - p * 70 * (1 - p) * 2 + Math.sin(a) * r * 0.5 - 20 * Math.sin(p * 3), 3, 3); }
        ctx.globalAlpha = 1;
      } else if (f.type === 'ring') {
        ctx.globalAlpha = (1 - p) * 0.7; ctx.strokeStyle = f.col || '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(sx, sy, (10 + p * 50), (10 + p * 50) * 0.5, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  },
  drawImpacts(ctx) {
    for (const m of Sim.impacts) {
      const p = 1 - m.t / m.dur;
      const [sx, sy] = this.proj(m.x, m.y);
      ctx.strokeStyle = `rgba(255,60,40,${0.5 + 0.4 * Math.sin(this.time * 14)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, 3 * TW * 0.7071 * 1.0, 3 * TH * 0.7071, 0, 0, 7); ctx.stroke();
      const mx = sx - (1 - p) * 300, my = sy - (1 - p) * 640;
      ctx.strokeStyle = 'rgba(255,170,60,0.8)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 90, my - 190); ctx.stroke();
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 22);
      g.addColorStop(0, '#fff6c8'); g.addColorStop(0.5, '#ff8a2a'); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 22, 0, 7); ctx.fill();
    }
  },

  /* ---------- previsualización de herramienta ---------- */
  diamond(ctx, qx, qy, fill, stroke) {
    const sx = (qx - qy) * TW / 2, sy = (qx + qy) * TH / 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + TW / 2, sy + TH / 2); ctx.lineTo(sx, sy + TH); ctx.lineTo(sx - TW / 2, sy + TH / 2); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  },
  footprint(ctx, x, y, w, h, fill, stroke) {
    const pts = [this.proj(x, y), this.proj(x + w, y), this.proj(x + w, y + h), this.proj(x, y + h)];
    ctx.beginPath(); pts.forEach((p, n) => n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  },
  ring(ctx, cx, cy, r, col) {
    const [sx, sy] = this.proj(cx, cy);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(sx, sy, r * TW * 0.7071, r * TH * 0.7071, 0, 0, 7);
    ctx.fillStyle = col + '22'; ctx.fill();
    ctx.setLineDash([8, 6]); ctx.lineDashOffset = -this.time * 12; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  },
  drawPreview(ctx) {
    const pv = this.preview, sel = this.selected;
    if (sel && W.buildings.has(sel.id)) {
      this.footprint(ctx, sel.x, sel.y, sel.w, sel.h, 'rgba(255,255,255,0.12)', '#fff');
      if (sel.def && sel.def.cover) for (const k in sel.def.cover) this.ring(ctx, sel.cx, sel.cy, sel.def.cover[k], '#4fd1c5');
    }
    if (!pv) return;
    if (pv.tiles) {
      for (const t of pv.tiles) {
        const [qx, qy] = this.rotPt(t.x + 0.5, t.y + 0.5);
        this.diamond(ctx, Math.floor(qx), Math.floor(qy), t.ok ? (pv.col || 'rgba(80,230,140,0.38)') : 'rgba(255,80,80,0.4)', t.ok ? (pv.stroke || 'rgba(120,255,180,0.9)') : 'rgba(255,100,100,0.9)');
      }
    }
    if (pv.ghost) {
      const g = pv.ghost, def = BDEFS[g.key];
      this.footprint(ctx, g.x, g.y, def.w, def.h, g.ok ? 'rgba(80,230,140,0.32)' : 'rgba(255,80,80,0.38)', g.ok ? '#6dffb0' : '#ff6a6a');
      if (def.cover) for (const k in def.cover) this.ring(ctx, g.x + def.w / 2, g.y + def.h / 2, def.cover[k], g.ok ? '#4fd1c5' : '#ff6a6a');
      const fake = { def, key: g.key, w: def.w, h: def.h, v: 0, lvl: 1 };
      const e = Sprites.forBuilding(fake);
      const [ax, ay] = this.rotPt(g.x, g.y), [bx, by] = this.rotPt(g.x + def.w, g.y + def.h);
      const minx = Math.min(ax, bx), miny = Math.min(ay, by);
      ctx.globalAlpha = 0.72; this.spr(ctx, e.base, (minx - miny) * TW / 2, (minx + miny) * TH / 2); ctx.globalAlpha = 1;
    }
    if (pv.hover) {
      const h = pv.hover;
      this.footprint(ctx, h.x, h.y, 1, 1, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.7)');
    }
  },
};
