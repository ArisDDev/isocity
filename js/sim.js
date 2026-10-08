'use strict';
/* ==========================================================================
   Simulación: economía, servicios, demanda, crecimiento, tráfico, desastres
   ========================================================================== */
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function blur3(src, dst, N, selfW) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx; if (xx < 0 || xx >= N) continue;
        s += src[yy * N + xx]; c++;
      }
    }
    dst[y * N + x] = src[y * N + x] * selfW + (s / c) * (1 - selfW);
  }
}

const Sim = {
  S: null, veh: [], impacts: [], tornado: null, shake: 0, log: [],
  speedIdx: 1, dayAcc: 0, mapTimer: 0, agg: null, rP: null, rW: null,
  nRoad: 0, vehTimer: 0, trafTimer: 0, _cnt: null, onMonth: null,

  /* ------------------------------------------------------------------ */
  blankStats() {
    return {
      pop: 0, workforce: 0, jobs: 0, employed: 0, unemp: 0, fill: 0, happiness: 50, pol: 0, crime: 0, traf: 0, jam: 0,
      pSupply: 0, pDemand: 0, wSupply: 0, wDemand: 0, income: 0, expense: 0, net: 0, eduIdx: 0,
      revR: 0, revC: 0, revI: 0,
    };
  },

  reset(opts) {
    const diff = DIFFS[opts.diff || 'normal'];
    W.init(opts.size || 64, opts.seed, opts.style);
    this.S = {
      name: opts.name || 'Nueva Aurora', diff: opts.diff || 'normal', money: diff.money,
      day: 1, month: 0, year: 2000, totalDays: 0,
      taxes: { R: 9, C: 9, I: 9 },
      funding: { police: 100, fire: 100, health: 100, edu: 100, rec: 100, garbage: 100, transit: 100 },
      loans: [], ord: {}, demand: { R: 0.7, C: 0.3, I: 0.4 },
      stats: this.blankStats(), hist: { pop: [], money: [], happy: [], net: [], dR: [], dC: [], dI: [], jobs: [], unemp: [] },
      ach: {}, goals: {}, disasters: 0, debtMonths: 0, cd: {}, peak: 0, unlocked: {}, festival: 0, bankrupt: false,
      budget: null,
    };
    this.veh = []; this.impacts = []; this.tornado = null; this.shake = 0; this.log = [];
    this.dayAcc = 0; this.mapTimer = 0; this.agg = null; this.free = false; this.speedIdx = 1;
    this.rP = new Float32Array(1); this.rW = new Float32Array(1);
    this._cnt = new Uint16Array(W.N * W.N);
    this.aggregate();
  },

  /* ------------------------------------------------------------------ */
  notify(text, kind, x, y) {
    this.log.unshift({ t: this.S ? `${MONTHS[this.S.month]} ${this.S.year}` : '', text, kind: kind || 'info' });
    if (this.log.length > 80) this.log.pop();
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(text, kind || 'info', x, y);
  },
  once(key, months, text, kind) {
    const S = this.S, now = S.year * 12 + S.month;
    months *= 2;
    if (S.cd[key] !== undefined && now - S.cd[key] < months) return;
    S.cd[key] = now; this.notify(text, kind);
  },

  dateStr() { const S = this.S; return `${S.day} ${MONTHS[S.month]} ${S.year}`; },
  cityLevel() { let l = CITY_LEVELS[0]; for (const c of CITY_LEVELS) if (this.S.peak >= c.pop) l = c; return l.name; },
  unlocked(thr) { return this.S.diff === 'sandbox' || this.S.peak >= thr; },
  canAfford(c) { return this.S.diff === 'sandbox' || this.S.money >= c; },
  spend(c) { if (this.S.diff !== 'sandbox') this.S.money -= c; },

  /* ------------------------------------------------------------------ */
  consP(b) {
    const S = this.S;
    if (b.key === 'R' || b.key === 'C' || b.key === 'I') return ZB[ZONE[b.key]].useP[b.lvl - 1] * (S.ord.energy ? 0.85 : 1);
    return (b.def.useP || 0);
  },
  consW(b) {
    const S = this.S;
    if (b.key === 'R' || b.key === 'C' || b.key === 'I') return ZB[ZONE[b.key]].useW[b.lvl - 1] * (S.ord.water ? 0.85 : 1);
    return (b.def.useW || 0);
  },

  refreshNetworks() {
    const N = W.N, n = N * N, road = W.road, comp = W.comp;
    comp.fill(-1);
    let nc = 0, nr = 0;
    if (!this._stack || this._stack.length !== n) this._stack = new Int32Array(n);
    const stack = this._stack;
    for (let i = 0; i < n; i++) {
      if (!road[i]) continue;
      nr++;
      if (comp[i] >= 0) continue;
      let sp = 0; stack[sp++] = i; comp[i] = nc;
      while (sp) {
        const k = stack[--sp], x = k % N, y = (k / N) | 0;
        for (let d = 0; d < 4; d++) {
          const a = x + DX[d], b = y + DY[d];
          if (a < 0 || b < 0 || a >= N || b >= N) continue;
          const j = b * N + a;
          if (road[j] && comp[j] < 0) { comp[j] = nc; stack[sp++] = j; }
        }
      }
      nc++;
    }
    W.nComp = nc; this.nRoad = nr;
    const pS = new Float32Array(nc + 1), pD = new Float32Array(nc + 1), wS = new Float32Array(nc + 1), wD = new Float32Array(nc + 1);
    let tPS = 0, tPD = 0, tWS = 0, tWD = 0;
    for (const b of W.buildings.values()) {
      b.rt = W.adjacentRoad(b); b.acc = b.rt >= 0 ? comp[b.rt] : -1;
      if (b.acc < 0) continue;
      const u = this.consP(b), w = this.consW(b);
      pD[b.acc] += u; wD[b.acc] += w; tPD += u; tWD += w;
      if (b.def) {
        if (b.def.prodP) { pS[b.acc] += b.def.prodP; tPS += b.def.prodP; }
        if (b.def.prodW) { wS[b.acc] += b.def.prodW; tWS += b.def.prodW; }
      }
    }
    const rP = new Float32Array(nc + 1), rW = new Float32Array(nc + 1);
    for (let c = 0; c < nc; c++) {
      rP[c] = pD[c] > 0 ? Math.min(1, pS[c] / pD[c]) : (pS[c] > 0 ? 1 : 0);
      rW[c] = wD[c] > 0 ? Math.min(1, wS[c] / wD[c]) : (wS[c] > 0 ? 1 : 0);
    }
    this.rP = rP; this.rW = rW;
    for (const b of W.buildings.values()) {
      if (b.acc < 0) { b.pw = b.wt = b.on = false; continue; }
      const frac = (b.id * 0.6180339887) % 1;
      b.pw = this.consP(b) === 0 ? true : (rP[b.acc] >= 0.999 || frac < rP[b.acc]);
      b.wt = this.consW(b) === 0 ? true : (rW[b.acc] >= 0.999 || frac < rW[b.acc]);
      b.on = b.pw && b.wt;
      if (this.free) { b.pw = b.wt = true; b.on = true; }
    }
    const st = this.S.stats;
    st.pSupply = tPS; st.pDemand = tPD; st.wSupply = tWS; st.wDemand = tWD;
    this.aggregate();
  },

  aggregate() {
    const unempEx = this.S ? clamp((this.S.stats.unemp - 0.15) / 0.5, 0, 1) : 0;
    const a = { pop: 0, capR: 0, tgtR: 0, jobsC: 0, jobsI: 0, jobsP: 0, homes: [], jobsB: [], indB: [], comB: [], byKey: {}, lvl: { R: [0, 0, 0], C: [0, 0, 0], I: [0, 0, 0] } };
    for (const b of W.buildings.values()) {
      a.byKey[b.key] = (a.byKey[b.key] || 0) + 1;
      if (b.key === 'R') {
        a.lvl.R[b.lvl - 1]++; a.pop += b.pop;
        if (b.on) {
          const cap = ZB[1].cap[b.lvl - 1];
          a.capR += cap; a.tgtR += cap * clamp((b.happy - 22) / 50, 0.05, 1) * (1 - 0.6 * unempEx);
        }
        if (b.on && b.pop > 0.5) a.homes.push(b);
      } else if (b.key === 'C' || b.key === 'I') {
        a.lvl[b.key][b.lvl - 1]++;
        if (b.on) {
          const j = ZB[b.key === 'C' ? 2 : 3].jobs[b.lvl - 1];
          if (b.key === 'C') { a.jobsC += j; a.comB.push(b); } else { a.jobsI += j; a.indB.push(b); }
          a.jobsB.push(b);
        }
      } else if (b.def && b.on && b.def.jobs) { a.jobsP += b.def.jobs; a.jobsB.push(b); }
    }
    this.agg = a;
    if (this.S) {
      const st = this.S.stats;
      st.pop = Math.round(a.pop); st.workforce = a.pop * 0.58; st.jobs = a.jobsC + a.jobsI + a.jobsP;
      st.employed = Math.min(st.workforce, st.jobs);
      st.unemp = st.workforce > 2 ? 1 - st.employed / st.workforce : 0;
      st.fill = st.jobs > 0 ? Math.min(1, st.workforce / st.jobs) : 0;
      if (st.pop > this.S.peak) this.S.peak = st.pop;
    }
    return a;
  },

  /* ------------------------------------------------------------------ */
  refreshMaps() {
    const N = W.N, n = N * N, S = this.S;
    for (const k of COVS) W.cov[k].fill(0);
    const boost = { health: S.ord.health ? 1.25 : 1, edu: S.ord.scholar ? 1.3 : 1 };
    const broke = (S.money < 0 && S.diff !== 'sandbox') ? 0.5 : 1;   // sin fondos los servicios rinden a medias
    for (const b of W.buildings.values()) {
      if (!b.def || !b.def.cover || !b.on || b.fire) continue;
      const f = Math.max(0, S.funding[b.def.dept] / 100) * broke;
      if (f <= 0) continue;
      for (const k in b.def.cover) {
        const r = b.def.cover[k], str = (b.def.str || 1) * f * (boost[k] || 1), cov = W.cov[k];
        const x0 = Math.max(0, Math.floor(b.cx - r)), x1 = Math.min(N - 1, Math.ceil(b.cx + r));
        const y0 = Math.max(0, Math.floor(b.cy - r)), y1 = Math.min(N - 1, Math.ceil(b.cy + r));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dd = Math.hypot(x + 0.5 - b.cx, y + 0.5 - b.cy);
          if (dd >= r) continue;
          const v = Math.pow(1 - dd / r, 0.7) * str, i = y * N + x;
          cov[i] = Math.min(1, cov[i] + v);
        }
      }
    }
    // tráfico suavizado, densidad, contaminación, árboles
    const src = new Float32Array(n), tmp = new Float32Array(n), dens = new Float32Array(n), tr = new Float32Array(n);
    for (const b of W.buildings.values()) {
      let e = 0;
      if (b.key === 'I') e = ZB[3].pol[b.lvl - 1] * (b.on ? 1 : 0.3);
      else if (b.def && b.def.pol) e = b.def.pol * (b.on ? 1 : 0);
      if (b.fire) e += 4;
      const people = b.key === 'R' ? b.pop : (b.key === 'C' || b.key === 'I') ? ZB[ZONE[b.key]].jobs[b.lvl - 1] * (b.on ? 1 : 0) : (b.def.jobs || 0);
      const area = b.w * b.h;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const i = y * N + x; src[i] += e / area; dens[i] += people / area / 28; }
    }
    for (let i = 0; i < n; i++) { if (W.road[i]) { src[i] += W.traf[i] * 0.6; tr[i] = W.traf[i]; } }
    for (let p = 0; p < 4; p++) { blur3(src, tmp, N, 0.4); src.set(tmp); }
    const treeM = new Float32Array(n);
    for (let i = 0; i < n; i++) treeM[i] = W.tree[i] ? 1 : 0;
    blur3(treeM, tmp, N, 0.4); treeM.set(tmp); blur3(treeM, tmp, N, 0.4); treeM.set(tmp);
    blur3(dens, tmp, N, 0.5); dens.set(tmp); blur3(dens, tmp, N, 0.5); dens.set(tmp);
    blur3(tr, tmp, N, 0.4); tr.set(tmp); blur3(tr, tmp, N, 0.4); tr.set(tmp);
    const ordG = S.ord.green ? 0.75 : 1, ordN = S.ord.night ? 0.8 : 1, unemp = S.stats.unemp;
    const cp = W.cov.police, cr = W.cov.rec, cg = W.cov.garbage;
    for (let i = 0; i < n; i++) {
      let p = src[i] * 3.0 - treeM[i] * 0.35 - cr[i] * 0.15;
      p *= (1 - 0.3 * cg[i]) * ordG;
      W.pol[i] = clamp(p, 0, 1);
      W.dens[i] = dens[i];
      W.crime[i] = clamp(0.04 + 0.32 * (1 - W.lv[i] / 100) + 0.2 * unemp + 0.22 * Math.min(1, dens[i]) - 0.9 * cp[i], 0, 1) * ordN;
    }
    const c = W.cov;
    for (let i = 0; i < n; i++) {
      const wn = W.wdist[i] <= 5 ? 1 - W.wdist[i] / 6 : 0;
      let v = 38 + 16 * wn + 22 * c.rec[i] + 10 * c.edu[i] + 8 * c.health[i] + 6 * cp[i] + 6 * c.fire[i] + 6 * c.transit[i] + 4 * cg[i] + 5 * treeM[i]
        - 50 * W.pol[i] - 34 * W.crime[i] - 14 * clamp(tr[i] * 2.2, 0, 1);
      tmp[i] = clamp(v, 0, 100);
    }
    blur3(tmp, W.lv, N, 0.55);
    let sp = 0, sc = 0, cnt = 0;
    for (const b of W.buildings.values()) if (b.key === 'R' || b.key === 'C' || b.key === 'I') { const i = b.y * N + b.x; sp += W.pol[i]; sc += W.crime[i]; cnt++; }
    S.stats.pol = cnt ? sp / cnt : 0; S.stats.crime = cnt ? sc / cnt : 0;
  },

  /* ------------------------------------------------------------------ */
  evalHappy(b) {
    const S = this.S, i = b.y * W.N + b.x, c = W.cov;
    let h = 56;
    h += c.police[i] * 7 + c.fire[i] * 6 + c.health[i] * 9 + c.edu[i] * 6 + c.rec[i] * 12 + c.transit[i] * 4 + c.garbage[i] * 5;
    h -= W.pol[i] * 30 + W.crime[i] * 24;
    h -= (S.taxes.R - 9) * 1.6;
    h -= S.stats.unemp * 40;
    h -= clamp(W.traf[b.rt >= 0 ? b.rt : i] * 10, 0, 6);
    if (!b.pw) h -= 25;
    if (!b.wt) h -= 20;
    if (b.acc < 0) h -= 30;
    if (S.ord.night) h -= 2;
    if (S.festival > 0) h += 8;
    b.happy = clamp(h, 0, 100);
  },

  updateDemand() {
    const S = this.S, a = this.agg, st = S.stats, D = S.demand;
    const pop = a.pop, wf = pop * 0.58, jobs = a.jobsC + a.jobsI + a.jobsP;
    let tR = jobs > 0 ? (jobs - wf) / (jobs + 30) * 1.3 : 0;
    if (pop < 30) tR = Math.max(tR, 0.7 - pop / 60);
    tR += (st.happiness - 50) / 110;
    tR -= (S.taxes.R - 9) * 0.045;
    const vac = a.tgtR > 0 ? 1 - pop / a.tgtR : 0;
    tR -= Math.max(0, vac - 0.2) * 1.4;
    const wantC = pop * 0.22 + 4 + (S.ord.tourism ? pop * 0.05 + 10 : 0);
    let tC = (wantC - a.jobsC) / (wantC + 12) * 1.3 - (S.taxes.C - 9) * 0.045;
    const wantI = wf * 0.42 + 6;
    let tI = (wantI - a.jobsI) / (wantI + 12) * 1.3 - (S.taxes.I - 9) * 0.045;
    if (st.unemp > 0.12) { tI += 0.2; tC += 0.1; }
    D.R += (clamp(tR, -1, 1) - D.R) * 0.12;
    D.C += (clamp(tC, -1, 1) - D.C) * 0.12;
    D.I += (clamp(tI, -1, 1) - D.I) * 0.12;
  },

  /* ------------------------------------------------------------------ */
  step(dt) {
    const sp = SPEEDS[this.speedIdx];
    if (!sp) return;
    this.dayAcc += dt * sp;
    let guard = 0;
    while (this.dayAcc >= DAY_LEN && guard++ < 12) { this.dayAcc -= DAY_LEN; this.dayTick(); }
    this.stepVehicles(dt * Math.min(sp, 3));
    this.stepDisasters(dt * Math.min(sp, 3));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  },

  frame(dt, run) {
    if (W.dirtyNet) { W.dirtyNet = false; this.refreshNetworks(); }
    this.mapTimer -= dt;
    if (W.dirtyMaps && this.mapTimer <= 0) { W.dirtyMaps = false; this.mapTimer = 0.35; this.refreshMaps(); }
    if (run) this.step(dt); else this.stepVehicles(dt);
  },

  dayTick() {
    const S = this.S;
    S.totalDays++;
    S.day++;
    if (S.day > 30) { S.day = 1; this.monthTick(); S.month++; if (S.month > 11) { S.month = 0; S.year++; } }
    if (S.totalDays % 5 === 0) W.dirtyMaps = true;
    this.growth();
    this.dailyPeople();
    this.dailyFire();
    this.updateDemand();
    // cenizas y reparaciones
    if (S.totalDays % 3 === 0) {
      const sc = W.scorch; for (let i = 0; i < sc.length; i++) if (sc[i]) sc[i]--;
    }
    if (S.totalDays % 2 === 0) this.checkGoals();
  },

  /* ---------- crecimiento de zonas ---------- */
  growth() {
    const S = this.S, N = W.N, D = S.demand;
    const tries = Math.max(8, (N * N / 60) | 0);
    for (let t = 0; t < tries; t++) {
      const x = rint(N), y = rint(N), i = y * N + x, z = W.zone[i];
      if (!z || W.bid[i] || W.road[i] || W.ter[i] === TER.WATER) continue;
      let rt = -1;
      for (let d = 0; d < 4; d++) { const a = x + DX[d], b = y + DY[d]; if (W.inb(a, b) && W.road[b * N + a]) { rt = b * N + a; break; } }
      if (rt < 0) continue;
      const c = W.comp[rt];
      if (!(this.rP[c] > 0.55 && this.rW[c] > 0.55)) continue;
      const dem = D[ZKEY[z]];
      if (dem < 0.04) continue;
      if (z !== 3 && W.lv[i] < 15) continue;        // la industria sí puede levantarse en suelo contaminado
      if (z === 1 && W.pol[i] > 0.65) continue;
      if (Math.random() > 0.2 + dem * 0.65) continue;
      const b = W.addBuilding(ZKEY[z], x, y, { lvl: 1, v: rint(8) });
      b.rt = rt; b.acc = c; b.pw = b.wt = b.on = true;
      if (z === 1) this.evalHappy(b);
      W.dirtyNet = true;
    }
    // mejora / degradación / abandono
    const arr = Array.from(W.buildings.values());
    const sample = Math.max(4, (arr.length / 10) | 0);
    for (let k = 0; k < sample && arr.length; k++) {
      const b = arr[rint(arr.length)];
      if (b.key !== 'R' && b.key !== 'C' && b.key !== 'I') continue;
      const i = b.y * N + b.x, lv = W.lv[i], dem = D[b.key], thr = LVL_LV[ZONE[b.key]];
      if (b.lvl < 3 && dem > 0.1 && b.on && lv >= thr[b.lvl] && !b.fire) {
        let ok = true;
        if (b.lvl === 2) ok = W.cov.edu[i] >= (b.key === 'I' ? 0.1 : 0.12);
        if (ok && Math.random() < 0.2) { b.lvl++; b.v = rint(8); W.version++; W.dirtyNet = true; }
      } else if (b.lvl > 1 && lv < thr[b.lvl - 1] - 12 && Math.random() < 0.08) {
        b.lvl--; b.v = rint(8); W.version++; W.dirtyNet = true;
      }
      if (D[b.key] < -0.5 && Math.random() < 0.02 && !b.fire) { W.removeBuilding(b.id); }
    }
    // abandono por falta de servicios
    for (const b of arr) {
      if (b.key !== 'R' && b.key !== 'C' && b.key !== 'I') continue;
      if (!b.on) { b.bad++; if (b.bad > 50) { W.removeBuilding(b.id); this.once('aband', 2, '🏚️ Se abandonaron edificios sin electricidad, agua o acceso a carretera.', 'warn'); } }
      else b.bad = 0;
    }
  },

  dailyPeople() {
    const S = this.S, st = S.stats, a = this.agg;
    this.aggregate();
    const unempEx = clamp((st.unemp - 0.15) / 0.5, 0, 1);
    for (const b of W.buildings.values()) {
      if (b.key === 'R') {
        const cap = ZB[1].cap[b.lvl - 1];
        const occ = clamp((b.happy - 22) / 50, 0.05, 1) * (1 - 0.6 * unempEx);
        const tgt = b.on ? cap * occ : 0;
        const diff = tgt - b.pop;
        if (Math.abs(diff) < 0.25) b.pop = tgt;
        else b.pop += clamp(diff * 0.12, -cap * 0.06, cap * 0.07) + Math.sign(diff) * 0.15;
        b.pop = clamp(b.pop, 0, cap);
      } else if (b.key === 'C' || b.key === 'I') {
        const j = ZB[ZONE[b.key]].jobs[b.lvl - 1];
        b.emp = b.on ? j * st.fill : 0;
      }
      if (b.hp < 100 && !b.fire) b.hp = Math.min(100, b.hp + 1.5);
      b.age++;
    }
  },

  /* ---------- fuego ---------- */
  ignite(b) {
    if (b.fire) return;
    b.fire = 1; b.truck = 0;
    this.notify(`🔥 ¡Incendio en ${b.def ? b.def.name : ZB[ZONE[b.key]].name[b.lvl - 1]}!`, 'bad', b.cx, b.cy);
    if (typeof Snd !== 'undefined') Snd.play('alarm');
    if (!this.countType('fire')) this.once('adv_nofire', 3, '🚒 No tienes estación de bomberos: construye una para apagar los incendios.', 'warn');
  },
  destroyBuilding(b, cause) {
    W.removeBuilding(b.id, true);
    W.dirtyNet = true;
  },
  dailyFire() {
    const S = this.S, N = W.N;
    const burning = [];
    for (const b of W.buildings.values()) if (b.fire) burning.push(b);
    for (const b of burning) {
      const i = b.y * N + b.x, fc = W.cov.fire[i];
      // un edificio sano tarda ~120 días de juego (≈36 s a velocidad x1) en quemarse del todo
      b.hp -= (100 / FIRE_BURN_DAYS) * (0.7 + Math.random() * 0.6);
      if (Math.random() < 0.08 * fc) { b.fire = 0; b.truck = 0; this.notify('🚒 El incendio se extinguió.', 'good'); continue; }
      if (b.hp <= 0) {
        this.notify(`🏚️ ${b.def ? b.def.name : ZB[ZONE[b.key]].name[b.lvl - 1]} destruido por el fuego.`, 'bad', b.cx, b.cy);
        this.destroyBuilding(b, 'fire'); continue;
      }
      // propagación a edificios vecinos (una probabilidad por edificio, no por casilla)
      const seen = new Set();
      for (let yy = b.y - 1; yy <= b.y + b.h; yy++) for (let xx = b.x - 1; xx <= b.x + b.w; xx++) {
        if (!W.inb(xx, yy)) continue;
        const o = W.bldAt(xx, yy);
        if (!o || o === b || o.fire || seen.has(o.id)) continue;
        seen.add(o.id);
        if (Math.random() < FIRE_SPREAD * (1 - 0.85 * W.cov.fire[yy * N + xx])) this.ignite(o);
      }
      if (!b.truck) this.dispatchTruck(b);
    }
  },
  dispatchTruck(b) {
    let best = null, bd = 1e9;
    for (const s of W.buildings.values()) {
      if (!s.def || s.key !== 'fire' || !s.on || s.fire || s.acc !== b.acc || b.acc < 0) continue;
      if (S_FUND_OK(this.S, 'fire') === false) continue;
      const d = Math.abs(s.cx - b.cx) + Math.abs(s.cy - b.cy);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return;
    const path = this.findPath(best.rt, b.rt);
    if (!path) return;
    b.truck = 1;
    this.veh.push({ kind: 'fire', path, pi: 0, t: 0, target: b.id, color: '#d63a2a', ret: false });
    if (path.length < 2) this.arrive(this.veh.pop());
  },
  extinguish(b) {
    if (!b || !W.buildings.has(b.id) || !b.fire) return;
    b.fire = 0; b.truck = 0;
    this.notify('🚒 Los bomberos apagaron el incendio.', 'good', b.cx, b.cy);
  },

  /* ---------- tráfico ---------- */
  findPath(from, to) {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const N = W.N, n = N * N;
    if (!this._pv || this._pv.length !== n) { this._pv = new Uint32Array(n); this._pp = new Int32Array(n); this._pq = new Int32Array(n); this._stamp = 0; }
    const vis = this._pv, prev = this._pp, q = this._pq, st = ++this._stamp;
    let h = 0, t = 0; q[t++] = from; vis[from] = st; prev[from] = -1;
    while (h < t) {
      const i = q[h++]; if (i === to) break;
      const x = i % N, y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const a = x + DX[d], b = y + DY[d];
        if (a < 0 || b < 0 || a >= N || b >= N) continue;
        const j = b * N + a;
        if (W.road[j] && vis[j] !== st) { vis[j] = st; prev[j] = i; q[t++] = j; }
      }
    }
    if (vis[to] !== st) return null;
    const path = []; for (let k = to; k !== -1; k = prev[k]) path.push(k);
    return path.reverse();
  },

  spawnTrip() {
    const a = this.agg; if (!a || !a.homes.length || !a.jobsB.length) return;
    const truck = a.indB.length && a.comB.length && Math.random() < 0.18;
    let from, to, kind = 'car';
    if (truck) { from = pick(a.indB); to = pick(a.comB); kind = 'truck'; }
    else {
      from = pick(a.homes); to = pick(a.jobsB);
      if (Math.random() < W.cov.transit[from.y * W.N + from.x] * 0.55) return;
    }
    if (from.acc < 0 || from.acc !== to.acc || from.rt === to.rt) return;
    const path = this.findPath(from.rt, to.rt);
    if (!path || path.length < 2) return;
    const cols = ['#e04a3f', '#3f7fe0', '#f2c230', '#f4f4f0', '#3aa86a', '#8a5ad6', '#2a2f38', '#e9873a', '#9aa4ad'];
    this.veh.push({ kind, path, pi: 0, t: Math.random() * 0.2, color: kind === 'truck' ? pick(['#d9d9d4', '#c9a43a', '#6f8fae']) : pick(cols), ret: false });
  },
  arrive(v) {
    if (v.kind === 'fire') { const b = W.buildings.get(v.target); if (b) this.extinguish(b); return true; }
    if (!v.ret && Math.random() < 0.55) { v.path = v.path.slice().reverse(); v.pi = 0; v.t = 0; v.ret = true; return false; }
    return true;
  },
  stepVehicles(dt) {
    if (!this.agg) return;
    const N = W.N, st = this.S.stats, cnt = this._cnt;
    const target = clamp(Math.floor(st.pop / 16 + (this.agg.jobsC + this.agg.jobsI) / 28), 0, W.N >= 80 ? 340 : 240);
    this.vehTimer -= dt;
    if (this.veh.length < target && this.vehTimer <= 0) { this.spawnTrip(); this.vehTimer = 0.05; }
    // agrupar por segmento para evitar solapamientos
    const seg = new Map();
    for (const v of this.veh) {
      if (v.pi >= v.path.length - 1) continue;
      const key = v.path[v.pi] * 100003 + v.path[v.pi + 1];
      let l = seg.get(key); if (!l) seg.set(key, l = []); l.push(v);
    }
    for (let k = this.veh.length - 1; k >= 0; k--) {
      const v = this.veh[k];
      if (v.pi >= v.path.length - 1) { this.veh.splice(k, 1); continue; }
      const a = v.path[v.pi], b = v.path[v.pi + 1];
      const rd = ROADS[W.road[a]] || ROADS[1];
      let spd = rd.speed * (1 - 0.65 * clamp(W.traf[a], 0, 1)) * (v.kind === 'fire' ? 1.5 : v.kind === 'truck' ? 0.85 : 1);
      // distancia con el de delante
      let gap = 9;
      const same = seg.get(a * 100003 + b);
      if (same) for (const o of same) if (o !== v && o.t > v.t && o.t - v.t < gap) gap = o.t - v.t;
      if (v.pi + 2 < v.path.length) {
        const nx = seg.get(b * 100003 + v.path[v.pi + 2]);
        if (nx) for (const o of nx) { const g = 1 - v.t + o.t; if (g < gap) gap = g; }
      }
      if (gap < 0.26) spd = 0;
      else if (gap < 0.4) spd *= 0.5;
      v.t += spd * dt;
      if (v.t >= 1) {
        v.t -= 1; v.pi++;
        if (v.pi >= v.path.length - 1) { if (this.arrive(v)) { this.veh.splice(k, 1); continue; } }
      }
      cnt[v.path[v.pi]]++;
    }
    this._fr = (this._fr || 0) + 1;
    this.trafTimer -= dt;
    if (this.trafTimer <= 0) {
      this.trafTimer = 0.4;
      const fr = Math.max(1, this._fr); this._fr = 0;
      let sum = 0, nz = 0, jam = 0, roads = 0;
      for (let i = 0; i < N * N; i++) {
        if (!W.road[i]) continue;
        roads++;
        const c = ROADS[W.road[i]].cap;
        const sample = cnt[i] / fr / c;   // media de vehículos en el tile / capacidad
        W.traf[i] += (clamp(sample, 0, 1.2) - W.traf[i]) * 0.2;
        cnt[i] = 0;
        if (W.traf[i] > 0.02) { sum += W.traf[i]; nz++; }
        if (W.traf[i] > 0.7) jam++;
      }
      st.traf = nz ? sum / nz : 0; st.jam = roads ? jam / roads : 0;
    }
  },

  /* ---------- economía ---------- */
  calcBudget() {
    const S = this.S, diff = DIFFS[S.diff], st = S.stats;
    const empF = 0.55 + 0.45 * (1 - st.unemp);
    let revR = 0, revC = 0, revI = 0;
    const cust = clamp(st.pop * 0.3 / ((this.agg ? this.agg.jobsC : 0) + 1), 0.35, 1.3);
    const dep = {}; for (const k in DEPTS) dep[k] = 0;
    let power = 0, water = 0, other = 0, roads = 0;
    for (const b of W.buildings.values()) {
      const i = b.y * W.N + b.x, lv = W.lv[i];
      if (b.key === 'R') revR += b.pop * (0.5 + 0.0125 * lv) * (S.taxes.R / 9) * empF;
      else if (b.key === 'C') {
        if (b.on) { const e = b.lvl === 3 ? 0.55 + 0.45 * clamp(W.cov.edu[i] / 0.5, 0, 1) : 1; revC += b.emp * (1.9 + 0.012 * lv) * (S.taxes.C / 9) * cust * LVL_MULT[b.lvl - 1] * e; }
      } else if (b.key === 'I') {
        if (b.on) { const e = b.lvl === 3 ? 0.55 + 0.45 * clamp(W.cov.edu[i] / 0.5, 0, 1) : 1; revI += b.emp * (1.7 + 0.008 * lv) * (S.taxes.I / 9) * LVL_MULT[b.lvl - 1] * e; }
      } else if (b.def) {
        const up = b.def.upkeep * (b.def.dept ? S.funding[b.def.dept] / 100 : 1);
        if (b.def.dept) dep[b.def.dept] += up; else if (b.def.cat === 'power') power += up; else if (b.def.cat === 'water') water += up; else other += up;
      }
    }
    for (let i = 0; i < W.road.length; i++) if (W.road[i]) roads += ROADS[W.road[i]].upkeep;
    let interest = 0; for (const l of S.loans) interest += l.amount * 0.008;
    let ord = 0; for (const o of ORDS) if (S.ord[o.id]) ord += o.base + o.perCap * st.pop;
    revR *= diff.rev; revC *= diff.rev; revI *= diff.rev;
    const rev = revR + revC + revI;
    const exp = Object.values(dep).reduce((a, b) => a + b, 0) + power + water + other + roads + interest + ord;
    return { revR, revC, revI, rev, dep, power, water, other, roads, interest, ord, exp, net: rev - exp };
  },

  monthTick() {
    const S = this.S, st = S.stats;
    this.refreshMaps();
    for (const b of W.buildings.values()) if (b.key === 'R') this.evalHappy(b);
    this.aggregate();
    // felicidad global
    let hs = 0, ps = 0, es = 0;
    for (const b of W.buildings.values()) if (b.key === 'R' && b.pop > 0) { hs += b.happy * b.pop; ps += b.pop; es += W.cov.edu[b.y * W.N + b.x] * b.pop; }
    st.happiness = ps > 0 ? hs / ps : 50; st.eduIdx = ps > 0 ? es / ps : 0;
    // finanzas
    const bud = this.calcBudget();
    S.budget = bud;
    st.income = bud.rev; st.expense = bud.exp; st.net = bud.net;
    st.revR = bud.revR; st.revC = bud.revC; st.revI = bud.revI;
    if (S.diff !== 'sandbox') S.money += bud.net;
    if (S.festival > 0) S.festival--;
    this.updateDemand();
    // historial
    const h = S.hist;
    h.pop.push(st.pop); h.money.push(Math.round(S.money)); h.happy.push(Math.round(st.happiness)); h.net.push(Math.round(bud.net));
    h.dR.push(S.demand.R); h.dC.push(S.demand.C); h.dI.push(S.demand.I); h.jobs.push(Math.round(st.jobs)); h.unemp.push(st.unemp);
    for (const k in h) if (h[k].length > 240) h[k].shift();
    // quiebra
    if (S.money < -5000 && S.diff !== 'sandbox') S.debtMonths++; else S.debtMonths = 0;
    if (S.debtMonths >= 6 && !S.bankrupt) { S.bankrupt = true; if (typeof UI !== 'undefined') UI.bankrupt(); }
    // desbloqueos
    this.checkUnlocks();
    this.advisors();
    this.randomEvents();
    this.checkAchievements();
    // incendios espontáneos
    for (const b of W.buildings.values()) {
      if (b.fire) continue;
      const i = b.y * W.N + b.x, fc = W.cov.fire[i];
      let p = b.key === 'I' ? 0.0016 * b.lvl : b.key === 'coal' ? 0.003 : 0.0004;
      if (b.def && b.def.key === 'coal') p = 0.003;
      if (Math.random() < p * (1 - 0.85 * fc)) this.ignite(b);
    }
    if (this.onMonth) this.onMonth();
  },

  checkUnlocks() {
    const S = this.S;
    const items = [];
    for (const t in ROADS) items.push([`road${t}`, ROADS[t].name, ROADS[t].unlock]);
    for (const k in BDEFS) items.push([k, BDEFS[k].name, BDEFS[k].unlock]);
    for (const [id, name, thr] of items) {
      if (S.peak >= thr) {
        if (!S.unlocked[id]) { S.unlocked[id] = 1; if (thr > 0) this.notify(`🔓 Desbloqueado: ${name}`, 'good'); }
      }
    }
    const lv = this.cityLevel();
    if (S.lastLevel && S.lastLevel !== lv) this.notify(`🎉 ¡${S.name} ahora es ${lv.toLowerCase()}!`, 'good');
    S.lastLevel = lv;
  },

  advisors() {
    const S = this.S, st = S.stats;
    if (st.pop < 15 && S.totalDays < 200) return;
    if (st.pDemand > 0 && st.pSupply < st.pDemand) this.once('adv_power', 3, '⚡ Apagones: la demanda eléctrica supera la producción. Construye más centrales.', 'warn');
    if (st.wDemand > 0 && st.wSupply < st.wDemand) this.once('adv_water', 3, '💧 Falta agua: construye pozos o estaciones de bombeo.', 'warn');
    if (st.unemp > 0.15 && st.pop > 60) this.once('adv_jobs', 4, '👷 Desempleo alto: crea más zonas comerciales e industriales.', 'warn');
    if (st.unemp < 0.02 && st.jobs > st.workforce * 1.25 && st.pop > 60) this.once('adv_workers', 4, '🏠 Sobran empleos: faltan viviendas para trabajadores.', 'info');
    if (st.crime > 0.3) this.once('adv_crime', 4, '🚓 El crimen es alto: construye comisarías.', 'warn');
    if (st.pol > 0.3) this.once('adv_pol', 4, '🏭 La contaminación está dañando la ciudad. Separa la industria de las viviendas y planta parques.', 'warn');
    if (st.net < 0 && st.pop > 50) this.once('adv_budget', 3, '💸 Tienes déficit mensual. Revisa el presupuesto y los impuestos.', 'warn');
    if (st.jam > 0.25) this.once('adv_traffic', 4, '🚗 Tráfico denso: construye avenidas, paradas de bus o metro.', 'warn');
    if (st.happiness < 40 && st.pop > 100) this.once('adv_happy', 4, '😠 Los ciudadanos están descontentos.', 'warn');
    let uncovered = 0, tot = 0;
    for (const b of W.buildings.values()) if (b.key === 'R' || b.key === 'C' || b.key === 'I') { tot++; if (W.cov.fire[b.y * W.N + b.x] < 0.15) uncovered++; }
    if (tot > 25 && uncovered / tot > 0.5) this.once('adv_fire', 5, '🔥 Mucha zona sin cobertura de bomberos.', 'warn');
    if (S.money < 800 && S.diff !== 'sandbox') this.once('adv_cash', 3, '💰 Fondos casi agotados. Pide un préstamo o sube impuestos.', 'bad');
  },

  randomEvents() {
    const S = this.S, st = S.stats;
    if (st.pop < 80 || Math.random() > 0.05) return;
    const r = Math.random();
    if (r < 0.4) { const g = Math.round((400 + Math.random() * 1800) * (1 + st.pop / 3000)); S.money += g; this.notify(`🏛️ Subvención del gobierno: +${money(g)}`, 'good'); }
    else if (r < 0.7) { S.festival = 2; this.notify('🎆 ¡Festival ciudadano! La felicidad sube durante unos meses.', 'good'); }
    else { const l = Math.round(150 + Math.random() * 600 + st.pop * 0.3); S.money -= l; this.notify(`🦹 Robo en el ayuntamiento: −${money(l)}`, 'bad'); }
  },

  checkAchievements() {
    const S = this.S;
    for (const a of ACHS) {
      if (S.ach[a.id]) continue;
      let ok = false; try { ok = a.test(S); } catch (e) { }
      if (ok) { S.ach[a.id] = S.year * 12 + S.month; S.money += a.reward; this.notify(`🏆 Logro: ${a.name} (+${money(a.reward)})`, 'good'); if (typeof Snd !== 'undefined') Snd.play('achv'); }
    }
  },
  checkGoals() {
    const S = this.S;
    for (const g of GOALS) {
      if (S.goals[g.id]) continue;
      let ok = false; try { ok = g.test(S); } catch (e) { }
      if (ok) { S.goals[g.id] = 1; S.money += g.reward; this.notify(`✅ Objetivo: ${g.text} (+${money(g.reward)})`, 'good'); if (typeof Snd !== 'undefined') Snd.play('achv'); if (typeof UI !== 'undefined' && UI.refreshGoals) UI.refreshGoals(); }
    }
  },

  /* ---------- contadores ---------- */
  countType(k) { return this.agg && this.agg.byKey[k] || 0; },
  countLevel(k, l) { return this.agg ? this.agg.lvl[k][l - 1] : 0; },
  roadCount() { return this.nRoad; },
  producerCount(t) {
    let n = 0;
    for (const b of W.buildings.values()) if (b.def && b.acc >= 0 && (t === 'P' ? b.def.prodP : b.def.prodW)) n++;
    return n;
  },
  zoneTiles(z) { let n = 0; for (let i = 0; i < W.zone.length; i++) if (W.zone[i] === z) n++; return n; },

  /* ---------- acciones del jugador ---------- */
  previewRoad(tiles, type) {
    let cost = 0, n = 0; const ok = [];
    for (const [x, y] of tiles) { const c = W.roadCost(x, y, type); if (c > 0) { cost += c; n++; ok.push([x, y]); } }
    return { cost, n, tiles: ok };
  },
  buildRoads(tiles, type) {
    const p = this.previewRoad(tiles, type);
    if (!p.n) return { ok: false, reason: 'Nada que construir' };
    if (!this.canAfford(p.cost)) return { ok: false, reason: 'Fondos insuficientes' };
    this.spend(p.cost);
    for (const [x, y] of p.tiles) W.setRoad(x, y, type);
    return { ok: true, cost: p.cost, n: p.n };
  },
  previewZone(tiles, z) {
    const ok = []; for (const [x, y] of tiles) { if (W.canZone(x, y) && W.zone[y * W.N + x] !== z) ok.push([x, y]); }
    return { n: ok.length, cost: ok.length * ZONE_INFO[z].cost, tiles: ok };
  },
  paintZone(tiles, z) {
    const p = this.previewZone(tiles, z);
    if (!p.n) return { ok: false, reason: 'No hay terreno disponible' };
    if (!this.canAfford(p.cost)) return { ok: false, reason: 'Fondos insuficientes' };
    this.spend(p.cost);
    for (const [x, y] of p.tiles) { const i = y * W.N + x; W.zone[i] = z; W.tree[i] = 0; }
    W.version++; W.gver++; W.dirtyMaps = true;
    return { ok: true, cost: p.cost, n: p.n };
  },
  demolish(tiles) {
    let n = 0, blds = 0;
    for (const [x, y] of tiles) {
      const r = W.bulldoze(x, y);
      if (r) { n++; if (r.what === 'building') blds++; }
    }
    if (n) W.dirtyMaps = true;
    return { ok: n > 0, n, blds };
  },
  placeBuilding(key, x, y) {
    const def = BDEFS[key];
    if (!this.unlocked(def.unlock)) return { ok: false, reason: `Se desbloquea con ${fmt(def.unlock)} habitantes` };
    const r = W.canPlace(def, x, y);
    if (!r.ok) return r;
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'Fondos insuficientes' };
    this.spend(def.cost);
    const b = W.addBuilding(key, x, y);
    return { ok: true, b };
  },
  setTax(k, v) { this.S.taxes[k] = clamp(Math.round(v), 0, 20); },
  setFunding(k, v) { this.S.funding[k] = clamp(Math.round(v), 0, 100); W.dirtyMaps = true; },
  toggleOrd(id) { this.S.ord[id] = !this.S.ord[id]; W.dirtyNet = true; W.dirtyMaps = true; },
  takeLoan(amount) {
    const S = this.S;
    if (S.loans.length >= 4) return false;
    S.loans.push({ amount }); S.money += amount; return true;
  },
  repayLoan(i) {
    const S = this.S, l = S.loans[i]; if (!l) return false;
    if (S.money < l.amount) return false;
    S.money -= l.amount; S.loans.splice(i, 1); return true;
  },

  /* ---------- desastres ---------- */
  disaster(kind) {
    const S = this.S, bl = Array.from(W.buildings.values());
    S.disasters++;
    if (kind === 'fire') {
      const c = bl.filter(b => !b.fire && (b.key === 'R' || b.key === 'C' || b.key === 'I' || b.def));
      if (!c.length) return this.notify('No hay edificios que quemar.', 'info');
      this.ignite(pick(c));
    } else if (kind === 'quake') {
      this.shake = 2.2; if (typeof Snd !== 'undefined') Snd.play('quake');
      let n = 0;
      for (const b of bl) {
        if (Math.random() < 0.28) {
          b.hp -= 25 + Math.random() * 60;
          if (b.hp <= 0) { this.destroyBuilding(b, 'quake'); n++; }
          else if (Math.random() < 0.08) this.ignite(b);
        }
      }
      this.notify(`🌋 ¡Terremoto! ${n} edificios colapsaron.`, 'bad');
    } else if (kind === 'meteor') {
      let x, y, tries = 0;
      do { x = 6 + rint(W.N - 12); y = 6 + rint(W.N - 12); tries++; } while (tries < 40 && W.bid[y * W.N + x] === 0);
      this.impacts.push({ t: 1.8, dur: 1.8, x: x + 0.5, y: y + 0.5 });
      this.notify('☄️ ¡Un meteorito se aproxima!', 'bad');
    } else if (kind === 'tornado') {
      const side = rint(4), N = W.N;
      const sx = side === 0 ? 1 : side === 1 ? N - 2 : rint(N), sy = side === 2 ? 1 : side === 3 ? N - 2 : rint(N);
      const ang = Math.atan2(N / 2 - sy, N / 2 - sx) + (Math.random() - 0.5);
      this.tornado = { x: sx, y: sy, ang, life: 26, spin: 0 };
      this.notify('🌪️ ¡Tornado avistado!', 'bad');
    }
  },
  stepDisasters(dt) {
    for (let k = this.impacts.length - 1; k >= 0; k--) {
      const m = this.impacts[k]; m.t -= dt;
      if (m.t <= 0) { this.impacts.splice(k, 1); this.meteorHit(m.x, m.y); }
    }
    const t = this.tornado;
    if (t) {
      t.life -= dt; t.spin += dt * 9;
      t.ang += (Math.random() - 0.5) * dt * 2.2;
      t.x += Math.cos(t.ang) * 1.7 * dt; t.y += Math.sin(t.ang) * 1.7 * dt;
      if (t.x < -2 || t.y < -2 || t.x > W.N + 2 || t.y > W.N + 2 || t.life <= 0) { this.tornado = null; this.notify('🌪️ El tornado se disipó.', 'info'); return; }
      const r = 1.9;
      for (let yy = Math.floor(t.y - r); yy <= Math.ceil(t.y + r); yy++) for (let xx = Math.floor(t.x - r); xx <= Math.ceil(t.x + r); xx++) {
        if (!W.inb(xx, yy) || Math.hypot(xx + 0.5 - t.x, yy + 0.5 - t.y) > r) continue;
        const i = yy * W.N + xx;
        if (W.tree[i] && Math.random() < dt * 4) { W.tree[i] = 0; W.version++; }
        const b = W.bldAt(xx, yy);
        if (b) { b.hp -= 80 * dt; if (b.hp <= 0) { this.notify(`🌪️ El tornado destruyó ${b.def ? b.def.name : ZB[ZONE[b.key]].name[b.lvl - 1]}.`, 'bad', b.cx, b.cy); this.destroyBuilding(b, 'tornado'); } }
        if (W.road[i] && Math.random() < dt * 0.6 && !W.bid[i]) { W.road[i] = 0; W.dirtyNet = true; W.version++; W.gver++; }
      }
    }
  },
  meteorHit(x, y) {
    const R = 3;
    this.shake = 1.4; if (typeof Snd !== 'undefined') Snd.play('boom');
    if (typeof Render !== 'undefined') Render.addFx({ type: 'boom', x, y, t: 0, dur: 1.4 });
    const N = W.N; let n = 0;
    for (let yy = Math.floor(y - R - 1); yy <= Math.ceil(y + R + 1); yy++) for (let xx = Math.floor(x - R - 1); xx <= Math.ceil(x + R + 1); xx++) {
      if (!W.inb(xx, yy)) continue;
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y), i = yy * N + xx;
      if (d <= R) {
        const b = W.bldAt(xx, yy);
        if (b) { this.destroyBuilding(b, 'meteor'); n++; }
        W.tree[i] = 0; W.scorch[i] = 250;
        if (W.road[i] && d < 1.8) { W.road[i] = 0; W.dirtyNet = true; }
      } else if (d <= R + 1.5) { const b = W.bldAt(xx, yy); if (b && Math.random() < 0.5) this.ignite(b); }
    }
    W.version++; W.gver++; W.dirtyMaps = true;
    this.notify(`☄️ Impacto de meteorito: ${n} edificios destruidos.`, 'bad');
  },

  /* ---------- inspección ---------- */
  inspectTile(x, y) {
    if (!W.inb(x, y)) return null;
    const N = W.N, i = y * N + x, b = W.bldAt(x, y);
    const r = {
      x, y, i, terrain: ['Hierba', 'Agua', 'Arena'][W.ter[i]], zone: W.zone[i], road: W.road[i], tree: W.tree[i],
      lv: W.lv[i], pol: W.pol[i], crime: W.crime[i], traf: W.traf[i], b,
      cov: {},
    };
    for (const k of COVS) r.cov[k] = W.cov[k][i];
    return r;
  },
  save() {
    const S = this.S;
    const u8 = a => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
    const blds = [];
    for (const b of W.buildings.values()) blds.push([b.id, b.key, b.x, b.y, b.lvl, b.v, Math.round(b.pop * 10) / 10, Math.round(b.hp), b.fire ? 1 : 0, b.age]);
    return {
      ver: 1, N: W.N, seed: W.seed, style: W.style, S, nextId: W.nextId,
      ter: u8(W.ter), tree: u8(W.tree), road: u8(W.road), zone: u8(W.zone), scorch: u8(W.scorch), blds,
      cam: null,
    };
  },
  load(d) {
    const un = (s, n) => { const t = atob(s), a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = t.charCodeAt(i); return a; };
    W.init(d.N, d.seed, d.style);
    const n = d.N * d.N;
    W.ter.set(un(d.ter, n)); W.tree.set(un(d.tree, n)); W.road.set(un(d.road, n)); W.zone.set(un(d.zone, n));
    if (d.scorch) W.scorch.set(un(d.scorch, n));
    W.buildings = new Map(); W.bid.fill(0);
    // recomputar distancia al agua
    const q = []; W.wdist.fill(255);
    for (let i = 0; i < n; i++) if (W.ter[i] === TER.WATER) { W.wdist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % d.N, y = (i / d.N) | 0, dd = W.wdist[i]; if (dd >= 8) continue;
      for (let k = 0; k < 4; k++) { const a = x + DX[k], b = y + DY[k]; if (!W.inb(a, b)) continue; const j = b * d.N + a; if (W.wdist[j] > dd + 1) { W.wdist[j] = dd + 1; q.push(j); } }
    }
    this.S = d.S;
    const S = this.S;
    S.stats = Object.assign(this.blankStats(), S.stats);
    this.veh = []; this.impacts = []; this.tornado = null; this.shake = 0; this.log = [];
    this._cnt = new Uint16Array(n); this.free = false; this.speedIdx = 1; this.dayAcc = 0;
    for (const r of d.blds) {
      W.nextId = r[0];
      W.addBuilding(r[1], r[2], r[3], { lvl: r[4], v: r[5], pop: r[6], hp: r[7], fire: r[8], age: r[9] });
    }
    W.nextId = d.nextId;
    W.dirtyNet = W.dirtyMaps = true; W.version++;
    this.refreshNetworks(); this.refreshMaps();
    for (const b of W.buildings.values()) if (b.key === 'R') this.evalHappy(b);
  },
};

function S_FUND_OK(S, dept) { return S.funding[dept] > 0; }
