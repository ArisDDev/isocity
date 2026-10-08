'use strict';
/* ==========================================================================
   Dibujo con WebGL2 (se añade a Render). Dos lienzos apilados:
     · #glview (abajo): fondo, base del mapa, suelo, ceniza, vistas de datos, árboles, edificios y vehículos.
     · una capa 2D fuera de pantalla con lo vectorial —humo, fuego, aspas, sirenas, avisos, barcos, efectos y previsualización—, que se sube como textura
       y se compone en WebGL antes del pase nocturno (así también se oscurece de noche, como en el dibujo 2D).
     · #view (arriba, 2D): solo la lluvia, que va por encima de la noche, y la captura de los gestos.
   Todos los sprites viven en unas pocas texturas grandes (atlas) y se dibujan en una llamada por página y capa.
   Los objetos se dibujan con prueba de profundidad (z según su orden de atrás a delante) y alpha-to-coverage (MSAA),
   así que lo que queda tapado por un edificio de delante ni se calcula y los bordes siguen suaves.
   De noche: un pase que oscurece (multiplicar) y otro aditivo con las ventanas encendidas, las farolas y los faros, con prueba de profundidad
   LEQUAL contra lo ya dibujado: la luz solo se ve donde ese objeto es lo más cercano, sin siluetas ni búferes intermedios.
   Si WebGL2 no está disponible o se pierde el contexto, Render.draw usa el dibujo 2D de siempre.
   ========================================================================== */
(() => {
  const F = 10;                         // floats por instancia: x0,y0,x1,y1, u0,v0,u1,v1, z, alfa
  const GUT = 2;                        // margen transparente alrededor de cada sprite en el atlas

  const SPRITE_VS = `#version 300 es
uniform vec4 uXf;
in vec4 aRect; in vec4 aUV; in vec2 aZA;
out vec2 vUV; out float vA;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 w = mix(aRect.xy, aRect.zw, c);
  vUV = mix(aUV.xy, aUV.zw, c); vA = aZA.y;
  gl_Position = vec4(w * uXf.xy + uXf.zw, aZA.x, 1.0);
}`;
  const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform float uCut; uniform float uG;
in vec2 vUV; in float vA; out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  if (uCut >= 0.0) { if (t.a < uCut) discard; o = vec4(t.rgb / max(t.a, 0.004), t.a); }   // objetos: sin mezcla (corte / alpha-to-coverage)
  else o = t * (vA * uG);                                                                 // suelo y capas: mezcla premultiplicada
}`;
  const FLAT_VS = `#version 300 es
uniform vec4 uXf; in vec2 aP; in vec4 aC; out vec4 vC;
void main() { vC = aC; gl_Position = vec4(aP * uXf.xy + uXf.zw, 0.0, 1.0); }`;
  const FLAT_FS = `#version 300 es
precision mediump float; in vec4 vC; out vec4 o;
void main() { o = vC; }`;
  const BG_VS = `#version 300 es
layout(location = 0) in vec2 aP; void main() { gl_Position = vec4(aP, 0.0, 1.0); }`;
  const BG_FS = `#version 300 es
precision highp float;
uniform vec4 uA; uniform vec2 uSz; out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSz.y - gl_FragCoord.y);
  float t = clamp((length(p - uA.xy) - uA.z) / (uA.w - uA.z), 0.0, 1.0);
  o = vec4(mix(vec3(0.141, 0.290, 0.408), vec3(0.043, 0.086, 0.141), t), 1.0);
}`;

  const FX_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uSz; out vec4 o;
void main() { o = texture(uTex, vec2(gl_FragCoord.x / uSz.x, 1.0 - gl_FragCoord.y / uSz.y)); }`;
  const MUL_FS = `#version 300 es
precision mediump float; uniform vec3 uC; out vec4 o;
void main() { o = vec4(uC, 1.0); }`;

  class Batch {
    constructor() { this.pg = []; }
    reset() { for (const b of this.pg) if (b) b.n = 0; }
    add(p, x0, y0, x1, y1, u0, v0, u1, v1, z, a) {
      let b = this.pg[p] || (this.pg[p] = { a: new Float32Array(F * 512), n: 0 });
      if ((b.n + 1) * F > b.a.length) { const na = new Float32Array(b.a.length * 2); na.set(b.a); b.a = na; }
      const o = b.n++ * F, d = b.a;
      d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1; d[o + 4] = u0; d[o + 5] = v0; d[o + 6] = u1; d[o + 7] = v1; d[o + 8] = z; d[o + 9] = a;
    }
  }
  class Flat {
    constructor() { this.a = new Float32Array(6 * 6 * 256); this.n = 0; }
    quad(p, r, g, b, a) {
      if ((this.n + 6) * 6 > this.a.length) { const na = new Float32Array(this.a.length * 2); na.set(this.a); this.a = na; }
      const d = this.a;
      for (const k of [0, 1, 2, 0, 2, 3]) { const o = this.n++ * 6; d[o] = p[k * 2]; d[o + 1] = p[k * 2 + 1]; d[o + 2] = r; d[o + 3] = g; d[o + 4] = b; d[o + 5] = a; }
    }
  }
  const hexCache = {};
  const hex = h => hexCache[h] || (hexCache[h] = [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]);

  Object.assign(Render, {
    G: null, rendererPref: 'auto',

    initGL() {
      try { this.rendererPref = localStorage.getItem('isocity_renderer') === '2d' ? '2d' : 'auto'; } catch (e) { this.rendererPref = 'auto'; }
      if (this.rendererPref !== '2d') this.makeGL();
    },
    /** Cambia el motor de dibujo desde Opciones: 'auto' (WebGL si hay) o '2d'. */
    setRenderer(v) {
      this.rendererPref = v === '2d' ? '2d' : 'auto';
      try { localStorage.setItem('isocity_renderer', this.rendererPref); } catch (e) { }
      if (this.rendererPref !== '2d') this.makeGL();
    },
    makeGL() {
      if (this.G) return;
      const cv = document.createElement('canvas'); cv.id = 'glview';
      cv.style.cssText = 'position:fixed;inset:0;display:block;pointer-events:none';
      let gl = null;
      try { gl = cv.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' }); } catch (e) { }
      if (!gl) return;
      this.canvas.parentNode.insertBefore(cv, this.canvas);
      const fxc = document.createElement('canvas');
      const G = this.G = { cv, gl, fxc, fctx: fxc.getContext('2d'), fxW: 0, fxH: 0, ok: false, epoch: 0, pages: [], samples: 0, bGround: new Batch(), bOver: new Batch(), bItems: new Batch(), bLight: new Batch(), fSlab: new Flat(), fOv: new Flat() };
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); G.ok = false; });
      cv.addEventListener('webglcontextrestored', () => { try { this.glBuild(); } catch (e) { G.ok = false; } });
      try { this.glBuild(); } catch (e) { console.warn('WebGL no disponible, se usa el dibujo 2D:', e); G.ok = false; }
      this.resizeGL();
    },
    resizeGL() {
      const G = this.G; if (!G) return;
      G.cv.width = this.canvas.width; G.cv.height = this.canvas.height;
      G.fxc.width = this.canvas.width; G.fxc.height = this.canvas.height; G.fxW = 0;       // la textura se vuelve a crear con el tamaño nuevo
      G.cv.style.width = this.wpx + 'px'; G.cv.style.height = this.hpx + 'px';
    },
    useGL() { const G = this.G; return !!(G && G.ok && this.rendererPref !== '2d'); },

    glBuild() {
      const G = this.G, gl = G.gl;
      G.epoch++; G.pages = [];
      G.samples = gl.getParameter(gl.SAMPLES) || 0;
      const mt = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      G.PW = Math.min(4096, mt); G.PH = Math.min(2048, mt);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
      // sprites (instanciados)
      const sp = G.sp = prog(SPRITE_VS, SPRITE_FS);
      G.uS = { xf: gl.getUniformLocation(sp, 'uXf'), cut: gl.getUniformLocation(sp, 'uCut'), g: gl.getUniformLocation(sp, 'uG'), tex: gl.getUniformLocation(sp, 'uTex') };
      G.vaoS = gl.createVertexArray(); gl.bindVertexArray(G.vaoS);
      G.bufS = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, G.bufS);
      const ST = F * 4, at = (n, size, off) => { const l = gl.getAttribLocation(sp, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, ST, off); gl.vertexAttribDivisor(l, 1); };
      at('aRect', 4, 0); at('aUV', 4, 16); at('aZA', 2, 32);
      // polígonos planos
      const fp = G.fp = prog(FLAT_VS, FLAT_FS);
      G.uF = { xf: gl.getUniformLocation(fp, 'uXf') };
      G.vaoF = gl.createVertexArray(); gl.bindVertexArray(G.vaoF);
      G.bufF = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, G.bufF);
      const la = gl.getAttribLocation(fp, 'aP'), lc = gl.getAttribLocation(fp, 'aC');
      gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 4, gl.FLOAT, false, 24, 8);
      // fondo (triángulo a pantalla completa)
      const bp = G.bp = prog(BG_VS, BG_FS);
      G.uB = { a: gl.getUniformLocation(bp, 'uA'), sz: gl.getUniformLocation(bp, 'uSz') };
      const xp = G.xp = prog(BG_VS, FX_FS); G.uX = { tex: gl.getUniformLocation(xp, 'uTex'), sz: gl.getUniformLocation(xp, 'uSz') };
      G.fxTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.fxTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      G.fxW = 0;
      const mp = G.mp = prog(BG_VS, MUL_FS); G.uM = { c: gl.getUniformLocation(mp, 'uC') };
      G.vaoB = gl.createVertexArray(); gl.bindVertexArray(G.vaoB);
      const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const lb = gl.getAttribLocation(bp, 'aP'); gl.enableVertexAttribArray(lb); gl.vertexAttribPointer(lb, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      G.ok = true;
    },

    /* ---------- atlas ---------- */
    glNewPage() {
      const G = this.G, gl = G.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, G.PW, G.PH);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const pg = { tex, i: G.pages.length, fx: 0, fy: 0, rowH: 0 };
      G.pages.push(pg); return pg;
    },
    /** Sitio del sprite en el atlas: {p: página (-1 si no cabe), u0,v0,u1,v1}. Se copia la primera vez que se usa. */
    glSlot(s) {
      const G = this.G, gl = G.gl;
      let q = s.gl;
      if (q !== undefined && q.e === G.epoch) return q;
      const c = s.c, w = c.width, h = c.height, bw = w + GUT * 2, bh = h + GUT * 2;
      q = { e: G.epoch, p: -1, u0: 0, v0: 0, u1: 0, v1: 0 };
      if (bw <= G.PW && bh <= G.PH) {
        const fit = pg => { if (pg.fx + bw > G.PW) { pg.fx = 0; pg.fy += pg.rowH; pg.rowH = 0; } return pg.fy + bh <= G.PH; };
        let pg = G.pages[G.pages.length - 1];
        if (!pg || !fit(pg)) { pg = G.pages.length < 6 ? this.glNewPage() : null; if (pg && !fit(pg)) pg = null; }
        if (pg) {
          gl.bindTexture(gl.TEXTURE_2D, pg.tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, pg.fx + GUT, pg.fy + GUT, w, h, gl.RGBA, gl.UNSIGNED_BYTE, c);
          q.p = pg.i; q.u0 = (pg.fx + GUT) / G.PW; q.v0 = (pg.fy + GUT) / G.PH; q.u1 = (pg.fx + GUT + w) / G.PW; q.v1 = (pg.fy + GUT + h) / G.PH;
          pg.fx += bw; pg.rowH = Math.max(pg.rowH, bh);
        }
      }
      s.gl = q; return q;
    },
    /** Añade un sprite (con su nivel de detalle actual) a una capa: misma geometría que spr()/sprScaled(). */
    glPush(b, s, x, y, sc, z, a) {
      if (this.lodLevel) s = Sprites.lod(s, this.lodLevel);
      const q = (s.gl !== undefined && s.gl.e === this.G.epoch) ? s.gl : this.glSlot(s);
      if (q.p < 0) return;
      const f = SPR * (s.k || 1), x0 = x - s.ox / f * sc, y0 = y - s.oy / f * sc;
      b.add(q.p, x0, y0, x0 + (s.dw || s.c.width / SPR) * sc, y0 + (s.dh || s.c.height / SPR) * sc, q.u0, q.v0, q.u1, q.v1, z, a);
    },
    /** Rectángulo de mundo con un sprite sin nivel de detalle (brillos de luz). */
    glPushRaw(b, s, x0, y0, w, h, z, a) {
      const q = (s.gl !== undefined && s.gl.e === this.G.epoch) ? s.gl : this.glSlot(s);
      if (q.p >= 0) b.add(q.p, x0, y0, x0 + w, y0 + h, q.u0, q.v0, q.u1, q.v1, z, a);
    },
    glDrawBatch(b) {
      const G = this.G, gl = G.gl;
      gl.bindVertexArray(G.vaoS); gl.bindBuffer(gl.ARRAY_BUFFER, G.bufS);
      for (let p = 0; p < b.pg.length; p++) {
        const e = b.pg[p]; if (!e || !e.n) continue;
        gl.bindTexture(gl.TEXTURE_2D, G.pages[p].tex);
        gl.bufferData(gl.ARRAY_BUFFER, e.a.subarray(0, e.n * F), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, e.n);
      }
    },
    glDrawFlat(f, xf) {
      if (!f.n) return;
      const G = this.G, gl = G.gl;
      gl.useProgram(G.fp); gl.uniform4fv(G.uF.xf, xf);
      gl.bindVertexArray(G.vaoF); gl.bindBuffer(gl.ARRAY_BUFFER, G.bufF);
      gl.bufferData(gl.ARRAY_BUFFER, f.a.subarray(0, f.n * 6), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, f.n);
    },

    /* ---------- fotograma ---------- */
    drawGL(dt, T0) {
      const G = this.G, gl = G.gl, ctx = this.ctx, N = W.N, zoom = Cam.zoom, dpr = this.dpr, CW = this.canvas.width, CH = this.canvas.height;
      if (gl.isContextLost()) { G.ok = false; return; }
      let shx = 0, shy = 0;
      if (Sim.shake > 0) { const s = Math.min(1, Sim.shake) * 7; shx = (Math.random() - 0.5) * s; shy = (Math.random() - 0.5) * s; }
      const S = dpr * zoom, offX = dpr * (this.wpx / 2 - Cam.x * zoom + shx), offY = dpr * (this.hpx / 2 - Cam.y * zoom + shy);
      const xf = G.xf || (G.xf = new Float32Array(4));
      xf[0] = 2 * S / CW; xf[1] = -2 * S / CH; xf[2] = 2 * offX / CW - 1; xf[3] = 1 - 2 * offY / CH;
      const vx0 = Cam.x - this.wpx / 2 / zoom, vx1 = Cam.x + this.wpx / 2 / zoom, vy0 = Cam.y - this.hpx / 2 / zoom, vy1 = Cam.y + this.hpx / 2 / zoom;
      this.view = { vx0, vx1, vy0, vy1 };
      const ov = this.overlay, rot = Cam.rot, showTrees = zoom >= 0.38;
      this.setLod(S);
      const ts = this.tileSprites();

      // base del mapa (polígonos planos, con color premultiplicado)
      const fs = G.fSlab; fs.n = 0;
      this.slabPolys((col, p) => { const c = hex(col); fs.quad(p, c[0], c[1], c[2], 1); });
      // vista de datos: rombos de color sobre el suelo
      const fo = G.fOv; fo.n = 0;
      const onTile = ov === 'none' ? null : (x, y, i, sx, sy) => {
        const c = this.overlayColor(ov, i); if (!c) return;
        const a = c[3], r = c[0] / 255 * a, g = c[1] / 255 * a, b = c[2] / 255 * a;
        fo.quad([sx, sy, sx + TW / 2, sy + TH / 2, sx, sy + TH, sx - TW / 2, sy + TH / 2], r, g, b, a);
      };
      const items = this.collect(ctx, ov, ov !== 'none' || showTrees, showTrees, onTile);
      const [a0, a1, b0, b1] = this._rng;

      // suelo: casillas y capas (ondas del agua, zonas, ceniza)
      const gb = G.bGround, ob = G.bOver; gb.reset(); ob.reset();
      const ripple = this.quality !== 'low', tw = this.time * 1.3;
      for (let qy = 0; qy < N; qy++) {
        const qxMin = Math.max(qy + a0, b0 - qy, 0) | 0, qxMax = Math.min(qy + a1, b1 - qy, N - 1);
        for (let qx = qxMin; qx <= qxMax; qx++) {
          let x, y;
          switch (rot) { case 0: x = qx; y = qy; break; case 1: x = qy; y = N - 1 - qx; break; case 2: x = N - 1 - qx; y = N - 1 - qy; break; default: x = N - 1 - qy; y = qx; }
          const i = y * N + x, sx = (qx - qy) * TW / 2, sy = (qx + qy) * TH / 2;
          this.glPush(gb, ts.g[i], sx, sy, 1, 0, 1);
          if (ripple && ts.rp[i]) this.glPush(ob, ts.rp[i], sx, sy, 1, 0, 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(tw + ts.ph[i])));
          if (ts.z[i]) this.glPush(ob, ts.z[i], sx, sy, 1, 0, 1);
        }
      }
      const sc = W.scorch, dia = this._dia || (this._dia = Sprites.plainDiamond('#15100c', 1));
      for (let i = 0; i < sc.length; i++) {
        if (!sc[i]) continue;
        const x = i % N, y = (i / N) | 0; let qx, qy;
        switch (rot) { case 0: qx = x; qy = y; break; case 1: qx = N - 1 - y; qy = x; break; case 2: qx = N - 1 - x; qy = N - 1 - y; break; default: qx = y; qy = N - 1 - x; }
        this.glPush(ob, dia, (qx - qy) * TW / 2, (qx + qy) * TH / 2, 1, 0, Math.min(0.55, sc[i] / 120));
      }
      // objetos: z crece hacia atrás (el más cercano tiene el z menor)
      const ib = G.bItems, lb = G.bLight; ib.reset(); lb.reset();
      const n = items.length, dark = this.night;
      const lights = dark > 0.02 && zoom >= 0.4 && this.quality !== 'low', heads = lights && zoom > 0.5 && dark > 0.3;
      for (let k = 0; k < n; k++) {
        const it = items[k], z = 0.98 - 0.96 * (k + 0.5) / n;
        switch (it.t) {
          case 0: this.glPush(ib, this.treeSpr(it.tr, it.h), it.x, it.y, 0.85 + it.h * 0.3, z, 1); break;
          case 1: {
            this.glPush(ib, it.e.base, it.x, it.y, 1, z, 1);
            if (zoom > 0.4) {
              const A = Sprites.ANCH[it.b.def ? it.b.key : it.b.key + it.b.lvl];
              if (A && A.rotor) {
                const [px, py] = Sprites.P(A.rotor[0], A.rotor[1], A.rotor[2]), T3 = Math.PI * 2 / 3;
                const ang = ((this.time * 1.8 + it.b.id) % T3 + T3) % T3, st = Math.min(this.ROT_STEPS - 1, (ang / T3 * this.ROT_STEPS) | 0);
                this.glPush(ib, this.rotorSprite(st), it.x + px, it.y + py, 1, z - 0.4 * 0.96 / n, 1);
              }
            }
            if (lights && it.b.on) { const l = Sprites.lights(it.e, it.b); if (l) this.glPush(lb, l, it.x, it.y, 1, z, 1); }
            break;
          }
          case 2: {
            const sx = (it.qx - it.qy) * TW / 2, sy = (it.qx + it.qy) * TH / 2;
            this.glPush(ib, this.vehSprite(it), sx, sy, 1, z, 1);
            if (heads) this.glPushRaw(lb, this.sCar, sx - 9, sy - 12, 18, 18, z, 1);
            break;
          }
        }
      }
      if (lights && zoom >= 0.7) {                                          // farolas: cada una con la profundidad que le corresponde entre los objetos
        const ks = this._ks && this._ks.length >= n ? this._ks : (this._ks = new Float64Array(n + 256));
        for (let k = 0; k < n; k++) ks[k] = items[k].k;
        for (let qy = 0; qy < N; qy++) {
          const qxMin = Math.max(qy + a0, b0 - qy, 0) | 0, qxMax = Math.min(qy + a1, b1 - qy, N - 1);
          for (let qx = qxMin; qx <= qxMax; qx++) {
            if ((qx + qy) & 1) continue;
            let x, y;
            switch (rot) { case 0: x = qx; y = qy; break; case 1: x = qy; y = N - 1 - qx; break; case 2: x = N - 1 - qx; y = N - 1 - qy; break; default: x = N - 1 - qy; y = qx; }
            if (!W.road[y * N + x]) continue;
            const kL = qx + qy + 1.001; let lo = 0, hi = n;                 // nº de objetos más lejanos que la farola
            while (lo < hi) { const m = (lo + hi) >> 1; if (ks[m] < kL) lo = m + 1; else hi = m; }
            this.glPushRaw(lb, this.sLamp, (qx - qy) * TW / 2 - 15, (qx + qy + 1) * TH / 2 - 14, 30, 30, 0.98 - 0.96 * lo / n, 1);
          }
        }
      }
      const T1 = performance.now();

      // ---- GL ----
      gl.viewport(0, 0, CW, CH);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.clearDepth(1); gl.clearColor(0.043, 0.086, 0.141, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(G.bp); gl.uniform4f(G.uB.a, CW / 2, CH * 0.475, 40 * dpr, Math.max(CW, CH) * 0.75); gl.uniform2f(G.uB.sz, CW, CH);
      gl.bindVertexArray(G.vaoB); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.glDrawFlat(G.fSlab, xf);
      gl.useProgram(G.sp); gl.uniform4fv(G.uS.xf, xf); gl.uniform1i(G.uS.tex, 0); gl.uniform1f(G.uS.cut, -1); gl.uniform1f(G.uS.g, 1);
      this.glDrawBatch(gb); this.glDrawBatch(ob);
      this.glDrawFlat(G.fOv, xf);
      // objetos con profundidad
      gl.useProgram(G.sp);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      const a2c = G.samples > 0; if (a2c) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.uniform1f(G.uS.cut, a2c ? 0.02 : 0.5);
      this.glDrawBatch(ib);
      if (a2c) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.disable(gl.DEPTH_TEST);
      const T2 = performance.now();

      // ---- capa vectorial (humo, fuego, aspas, sirenas, avisos, barcos, efectos, previsualización) ----
      const fc = G.fctx;
      fc.setTransform(1, 0, 0, 1, 0, 0); fc.globalCompositeOperation = 'source-over'; fc.globalAlpha = 1; fc.clearRect(0, 0, CW, CH);
      fc.setTransform(S, 0, 0, S, offX, offY); fc.imageSmoothingEnabled = true;
      this._bub = 0; this._sm = 0;
      for (let k = 0; k < n; k++) {
        const it = items[k];
        switch (it.t) {
          case 1: this.drawBuilding(fc, it, true); break;
          case 2: this.drawVehicle(fc, it, true); break;
          case 3: this.drawTornado(fc, it); break;
          case 4: this.drawBoat(fc, it); break;
        }
      }
      this.drawFx(fc, dt);
      this.drawImpacts(fc);
      this.drawPreview(fc);
      fc.setTransform(1, 0, 0, 1, 0, 0);
      const T2b = performance.now();
      // se sube como textura y se compone encima de la escena, antes del pase nocturno
      gl.useProgram(G.xp); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.fxTex);
      if (G.fxW !== CW || G.fxH !== CH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, G.fxc); G.fxW = CW; G.fxH = CH; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, G.fxc);
      gl.uniform1i(G.uX.tex, 0); gl.uniform2f(G.uX.sz, CW, CH);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(G.vaoB); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      // ---- noche ----
      if (dark > 0.02) {
        // 1) oscurecer: multiplicar toda la escena por el color de la noche
        const kk = dark, r = Math.round(lerp(255, 66, kk)), gg = Math.round(lerp(255, 84, kk)), bb = Math.round(lerp(255, 150, kk));
        const warm = Math.sin(Math.min(1, kk) * Math.PI) * 0.25;
        gl.useProgram(G.mp); gl.uniform3f(G.uM.c, Math.round(r + (255 - r) * warm * 0.2) / 255, Math.round(gg - warm * 28) / 255, Math.round(bb - warm * 60) / 255);
        gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        gl.bindVertexArray(G.vaoB); gl.drawArrays(gl.TRIANGLES, 0, 3);
        // 2) luces aditivas con profundidad: solo donde ese objeto es lo más cercano
        if (lights) {
          gl.useProgram(G.sp); gl.uniform1f(G.uS.cut, -1); gl.uniform1f(G.uS.g, Math.min(1, dark * 1.2));
          gl.blendFunc(gl.ONE, gl.ONE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
          this.glDrawBatch(lb);
          gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
        }
        gl.disable(gl.BLEND);
      }
      // ---- lluvia: en el lienzo visible, por encima de todo ----
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.clearRect(0, 0, CW, CH);
      this.drawRain(ctx, dt);

      const T3 = performance.now(), st = this.stats, k = 0.1;
      st.ms = (st.ms || 0) * (1 - k) + (T3 - T0) * k; st.g = (st.g || 0) * (1 - k) + (T1 - T0) * k; st.i = (st.i || 0) * (1 - k) + (T2 - T1) * k; st.l = (st.l || 0) * (1 - k) + (T3 - T2) * k;
      st.lb = this.lodBias; st.n = n; st.bub = this._bub; st.sm = this._sm; st.ch = G.pages.length; st.gl = 1;
    },
  });
})();
