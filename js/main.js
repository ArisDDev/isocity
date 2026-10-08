'use strict';
/* ==========================================================================
   Juego: bucle principal, entrada de ratón/teclado, guardado y pantalla de título
   ========================================================================== */
const Game = {
  mode: 'title', last: 0, showFps: false, autosave: true, fpsCap: 0,
  keys: {}, ptrs: new Map(), pan: null, drag: null, pinch: null, hover: null, spaceDown: false, _driftT: 0,

  setShowFps(v) { this.showFps = v; try { localStorage.setItem('isocity_showfps', v ? '1' : '0'); } catch (e) { } },
  setFpsCap(n) { this.fpsCap = n; try { localStorage.setItem('isocity_fpscap', String(n)); } catch (e) { } },
  init() {
    Render.init($('#view'));
    try { const f = localStorage.getItem('isocity_fpscap'); this.fpsCap = f !== null ? +f : (Render.quality === 'low' ? 30 : 0); } catch (e) { this.fpsCap = 0; }
    try { this.showFps = localStorage.getItem('isocity_showfps') === '1'; } catch (e) { }
    UI.init();
    this.bindInput();
    Sim.onMonth = () => { if (this.mode === 'play' && Sim.S.month === 11 && this.autosave) this.saveSlot(0, true); };
    this.demoCity();
    this.showTitle();
    requestAnimationFrame(t => { this.last = t; this.loop(t); });
  },

  /* ---------- bucle ---------- */
  loop(ts) {
    requestAnimationFrame(t => this.loop(t));
    let dt = (ts - this.last) / 1000; this.last = ts;
    if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 0.08);
    if (this.mode === 'play') {
      this.keyPan(dt);
      Sim.frame(dt, true);
    } else {
      this._driftT += dt;
      Cam.x += Math.cos(this._driftT * 0.07) * 9 * dt; Cam.y += Math.sin(this._driftT * 0.05) * 5 * dt;
      Sim.frame(dt, false);
    }
    this._drawAcc = (this._drawAcc || 0) + dt;
    if (!this.fpsCap || ts - (this._lastDraw || 0) >= 1000 / this.fpsCap - 4) { Render.draw(this._drawAcc); this._drawAcc = 0; this._lastDraw = ts; }
    UI.update(dt);
    if (this.showFps) { const f = $('#fps'); if (f) f.textContent = Render.stats.fps + ' fps'; }
    const f = $('#fps'); if (f) f.style.display = this.showFps ? 'block' : 'none';
  },

  /* ---------- nueva partida / título ---------- */
  newGame(opts) {
    Snd.init();
    Sim.reset(opts);
    this.resetCamera();
    this.mode = 'play';
    const t = $('#title'); if (t) t.remove();
    UI.showHud(true); UI.setTool(BASIC_TOOLS[0]); UI.cat = null; UI.renderFlyout(); UI.refreshToolbarState();
    Sim.checkUnlocks(); UI.refreshGoals(); UI.refreshHud();
    Sim.notify(`🏙️ ¡Bienvenido a ${Sim.S.name}! Empieza trazando unas calles.`, 'good');
    try { if (!localStorage.getItem('isocity_seen')) { localStorage.setItem('isocity_seen', '1'); UI.showHelp(); } } catch (e) { }
  },
  resetCamera() {
    Cam.rot = 0; Cam.zoom = UI.isCompact() ? 0.7 : (W.N >= 90 ? 0.75 : 0.95);
    Render.centerOn(W.start.x + 0.5, W.start.y + 0.5);
  },
  showTitle() {
    this.mode = 'title';
    UI.showHud(false); UI.closeModal(true);
    const old = $('#title'); if (old) old.remove();
    const has = this.listSlots().some(s => s.meta);
    const t = el('div', { id: 'title' }, el('div', { class: 'tcard' },
      el('div', { class: 'logo' }, el('span', {}, 'Iso'), 'City'),
      el('p', { class: 'tag' }, 'Construye, gestiona y haz crecer tu ciudad isométrica'),
      el('button', { class: 'btn big primary', onclick: () => { Snd.init(); Snd.play('click'); UI.showNewGame(true); } }, '🏙️ Nueva ciudad'),
      has ? el('button', { class: 'btn big', onclick: () => { Snd.init(); this.continueLast(); } }, '▶ Continuar') : null,
      el('button', { class: 'btn big', onclick: () => { Snd.init(); UI.showSaves(); } }, '💾 Cargar partida'),
      el('button', { class: 'btn big', onclick: () => { Snd.init(); UI.showHelp(); } }, '❓ Cómo jugar'),
      el('p', { class: 'foot' }, 'Todos los gráficos y sonidos se generan por código.')));
    document.body.append(t);
  },
  toTitle() {
    if (this.mode === 'play') this.saveSlot(0, true);
    this.demoCity(); this.showTitle();
  },
  continueLast() {
    const slots = this.listSlots().filter(s => s.meta);
    if (!slots.length) return;
    slots.sort((a, b) => (b.meta.ts || 0) - (a.meta.ts || 0));
    this.loadSlot(slots[0].slot);
  },

  /* ---------- ciudad de demostración para el fondo del título ---------- */
  demoCity() {
    Sim.reset({ name: 'Demo', size: 56, seed: (Math.random() * 1e9) | 0, style: 'island', diff: 'sandbox' });
    Sim.free = true;
    const N = W.N, cx = W.start.x, cy = W.start.y, rnd = Math.random;
    const land = (x, y) => W.inb(x, y) && W.ter[y * N + x] !== TER.WATER;
    for (let g = -16; g <= 16; g += 4) for (let k = -18; k <= 18; k++) {
      const typ = g === 0 ? 2 : 1;
      if (land(cx + k, cy + g)) W.setRoad(cx + k, cy + g, typ);
      if (land(cx + g, cy + k)) W.setRoad(cx + g, cy + k, typ);
    }
    for (let y = cy - 18; y <= cy + 18; y++) for (let x = cx - 18; x <= cx + 18; x++) {
      if (!land(x, y)) continue;
      const i = y * N + x;
      if (W.road[i] || W.bid[i]) continue;
      let adj = false;
      for (let d = 0; d < 4; d++) if (W.roadAt(x + DX[d], y + DY[d])) adj = true;
      if (!adj || rnd() < 0.12) continue;
      const dist = Math.hypot(x - cx, y - cy) / 17;
      let key = 'R';
      if (dist < 0.4 && rnd() < 0.8) key = 'C'; else if (x > cx + 5 && y < cy - 2 && rnd() < 0.85) key = 'I'; else if (dist > 0.7 && rnd() < 0.2) key = 'C';
      const lvl = clamp(Math.round(3.2 - dist * 3 + (rnd() - 0.5) * 1.4), 1, 3);
      W.zone[i] = ZONE[key];
      const b = W.addBuilding(key, x, y, { lvl, v: (rnd() * 8) | 0 });
      if (key === 'R') b.pop = ZB[1].cap[lvl - 1] * 0.9;
    }
    const spots = [['coal', 2], ['solar', 1], ['wind', 5], ['pump', 1], ['police', 1], ['fire', 1], ['clinic', 1], ['hospital', 1], ['school', 1], ['university', 1], ['park2', 3], ['park1', 8], ['stadium', 1], ['recycle', 1], ['metro', 1], ['bus', 3]];
    for (const [key, n] of spots) {
      const def = BDEFS[key];
      for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 400; tries++) {
          const x = cx + ((rnd() * 40) | 0) - 20, y = cy + ((rnd() * 40) | 0) - 20;
          if (!W.canPlace(def, x, y).ok) continue;
          const fake = { x, y, w: def.w, h: def.h };
          if (W.adjacentRoad(fake) < 0) continue;
          W.addBuilding(key, x, y); break;
        }
      }
    }
    Sim.refreshNetworks(); Sim.refreshMaps();
    for (const b of W.buildings.values()) if (b.key === 'R') Sim.evalHappy(b);
    Sim.aggregate();
    Cam.rot = 0; Cam.zoom = 0.8; Render.centerOn(cx + 0.5, cy + 0.5);
    Render.overlay = 'none'; Render.preview = null; Render.selected = null;
    for (const b of W.buildings.values()) if (b.key === 'C' || b.key === 'I') b.emp = 5;
    Sim.speedIdx = 1;
    $('#selOverlay').value = 'none';
  },

  /* ---------- guardado ---------- */
  slotKey(n) { return 'isocity_slot' + n; },
  listSlots() {
    const out = [];
    for (let n = 0; n <= 3; n++) {
      let meta = null;
      try { const s = localStorage.getItem(this.slotKey(n)); if (s) meta = JSON.parse(s).meta; } catch (e) { }
      out.push({ slot: n, auto: n === 0, name: n === 0 ? '⟳ Autoguardado' : 'Ranura ' + n, meta });
    }
    return out;
  },
  saveSlot(n, silent) {
    if (this.mode !== 'play') return;
    try {
      const data = Sim.save(); data.cam = { x: Cam.x, y: Cam.y, zoom: Cam.zoom, rot: Cam.rot };
      const S = Sim.S, meta = { city: S.name, date: Sim.dateStr(), pop: S.stats.pop, money: S.diff === 'sandbox' ? '∞' : money(S.money), ts: Date.now() };
      localStorage.setItem(this.slotKey(n), JSON.stringify({ meta, data }));
      if (!silent) Snd.play('coin');
    } catch (e) { UI.toast('No se pudo guardar (almacenamiento lleno).', 'bad'); }
  },
  loadSlot(n) {
    try {
      const s = JSON.parse(localStorage.getItem(this.slotKey(n)));
      this.loadData(s.data);
    } catch (e) { console.error(e); UI.toast('No se pudo cargar la partida.', 'bad'); }
  },
  loadData(data) {
    Sim.load(data);
    if (data.cam) { Cam.x = data.cam.x; Cam.y = data.cam.y; Cam.zoom = data.cam.zoom; Cam.rot = data.cam.rot; } else this.resetCamera();
    Render.overlay = 'none'; $('#selOverlay').value = 'none';
    this.mode = 'play';
    const t = $('#title'); if (t) t.remove();
    UI.closeModal(true);
    UI.showHud(true); UI.setTool(BASIC_TOOLS[0]); UI.cat = null; UI.renderFlyout(); UI.refreshToolbarState();
    UI.refreshGoals(); UI.refreshHud();
    Sim.notify('💾 Partida cargada.', 'good');
  },
  exportFile() {
    if (this.mode !== 'play') return;
    const data = Sim.save(); data.cam = { x: Cam.x, y: Cam.y, zoom: Cam.zoom, rot: Cam.rot };
    const blob = new Blob([JSON.stringify({ data })], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `isocity_${Sim.S.name.replace(/\W+/g, '_')}.json` });
    document.body.append(a); a.click(); a.remove();
  },
  importFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { try { const j = JSON.parse(r.result); this.loadData(j.data || j); } catch (e) { UI.toast('Archivo no válido.', 'bad'); } };
    r.readAsText(file);
  },

  /* ---------- cámara ---------- */
  zoomAt(mx, my, f) {
    const before = Render.screenToWorld(mx, my);
    Cam.zoom = clamp(Cam.zoom * f, 0.3, 2.4);
    const after = Render.screenToWorld(mx, my);
    const [bx, by] = Render.proj(before[0], before[1]), [ax, ay] = Render.proj(after[0], after[1]);
    Cam.x += bx - ax; Cam.y += by - ay;
    Render.clampCam();
  },
  zoomBy(f) { this.zoomAt(Render.wpx / 2, Render.hpx / 2, f); Snd.play('click'); },
  keyPan(dt) {
    if (UI.modalOpen) return;
    const k = this.keys, sp = (k.ShiftLeft || k.ShiftRight ? 1500 : 760) / Cam.zoom * dt;
    let dx = 0, dy = 0;
    if (k.KeyA || k.ArrowLeft) dx -= 1; if (k.KeyD || k.ArrowRight) dx += 1;
    if (k.KeyW || k.ArrowUp) dy -= 1; if (k.KeyS || k.ArrowDown) dy += 1;
    if (dx || dy) { Cam.x += dx * sp; Cam.y += dy * sp * 0.6; Render.clampCam(); }
  },
  updateCursor() {
    const k = UI.tool.kind;
    Render.canvas.style.cursor = k === 'hand' ? 'grab' : k === 'query' ? 'help' : 'crosshair';
  },

  /* ---------- entrada ---------- */
  bindInput() {
    const cv = Render.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('pointercancel', e => this.onUp(e));
    cv.addEventListener('wheel', e => { e.preventDefault(); if (this.mode === 'play' && !UI.modalOpen) this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys = {}; });
    // en móvil el sistema puede cerrar la app en segundo plano: guardar al salir
    const bg = () => { if (this.mode === 'play' && this.autosave) this.saveSlot(0, true); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bg(); });
    window.addEventListener('pagehide', bg);
    const unlock = () => { Snd.init(); if (Snd.ctx && Snd.ctx.state === 'running') ['touchend', 'click', 'pointerdown'].forEach(t => document.removeEventListener(t, unlock, true)); };
    ['touchend', 'click', 'pointerdown'].forEach(t => document.addEventListener(t, unlock, true));
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
    document.addEventListener('touchmove', e => { if (e.touches.length > 1 && e.target === Render.canvas) e.preventDefault(); }, { passive: false });
  },
  TOUCH_LIFT: 54,
  /** En táctil el punto de acción se sitúa por encima del dedo para poder verlo. */
  liftOf(e) {
    if (e.pointerType !== 'touch') return 0;
    const k = UI.tool.kind;
    return (k === 'road' || k === 'zone' || k === 'bulldoze' || k === 'build') ? this.TOUCH_LIFT : 0;
  },
  tileAt(e) {
    const [x, y] = Render.screenToTile(e.clientX, e.clientY - this.liftOf(e));
    return W.inb(x, y) ? { x, y } : null;
  },
  onDown(e) {
    if (this.mode !== 'play' || UI.modalOpen) return;
    Snd.init();
    document.body.classList.remove('mini-open');
    try { Render.canvas.setPointerCapture(e.pointerId); } catch (err) { }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.drag = null; this.pan = null; Render.preview = null; return;
    }
    if (e.button === 1 || e.button === 2) { this.pan = { x: e.clientX, y: e.clientY, cx: Cam.x, cy: Cam.y, moved: false, btn: e.button }; return; }
    if (e.button !== 0) return;
    const tool = UI.tool;
    const touch = e.pointerType === 'touch';
    if (touch && tool.kind === 'query') { this.pan = { x: e.clientX, y: e.clientY, cx: Cam.x, cy: Cam.y, moved: false, btn: 0, tap: e }; return; }   // toque = consultar, arrastre = mover
    if (tool.kind === 'hand') { this.pan = { x: e.clientX, y: e.clientY, cx: Cam.x, cy: Cam.y, moved: false, btn: 0 }; Render.canvas.style.cursor = 'grabbing'; return; }
    const t = this.tileAt(e); this.hover = t;
    if (!t) return;
    switch (tool.kind) {
      case 'query': UI.inspect(t.x, t.y); Snd.play('select'); break;
      case 'road': case 'zone': case 'bulldoze': this.drag = { start: t, tool }; this.updatePreview(e); break;
      case 'build':
        if (touch) { this.drag = { touchBuild: true, tool }; this.updatePreview(e); }   // se construye al soltar
        else { this.placeAt(t); this.drag = { paint: true, last: t, tool }; }
        break;
    }
  },
  onMove(e) {
    const p = this.ptrs.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.mode !== 'play') return;
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch.d > 0) this.zoomAt(cx, cy, d / this.pinch.d);
      Cam.x -= (cx - this.pinch.cx) / Cam.zoom; Cam.y -= (cy - this.pinch.cy) / Cam.zoom; Render.clampCam();
      this.pinch.d = d; this.pinch.cx = cx; this.pinch.cy = cy; return;
    }
    if (this.pan) {
      const dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.pan.moved = true;
      Cam.x = this.pan.cx - dx / Cam.zoom; Cam.y = this.pan.cy - dy / Cam.zoom; Render.clampCam();
      return;
    }
    const over = e.target === Render.canvas || this.drag;
    if (!over || UI.modalOpen) { if (this.hover) { this.hover = null; Render.preview = null; UI.cursorTip(''); UI.tip(''); } return; }
    const t = this.tileAt(e); this.hover = t;
    if (t && this.drag && this.drag.paint && UI.tool.kind === 'build') {
      const def = BDEFS[UI.tool.key];
      if (def.w === 1 && def.h === 1 && (t.x !== this.drag.last.x || t.y !== this.drag.last.y)) { this.drag.last = t; this.placeAt(t, true); }
    }
    this.updatePreview(e);
    if (t && !this.drag) this.hoverInfo(t);
  },
  onUp(e) {
    this.ptrs.delete(e.pointerId);
    if (this.pinch && this.ptrs.size < 2) {
      this.pinch = null;
      if (this.ptrs.size === 1) { const q = [...this.ptrs.values()][0]; this.pan = { x: q.x, y: q.y, cx: Cam.x, cy: Cam.y, moved: true, btn: 0 }; }   // el dedo restante sigue moviendo el mapa
      return;
    }
    if (this.mode !== 'play') return;
    if (this.pan) {
      const p = this.pan; this.pan = null;
      if (p.tap && !p.moved && e.type === 'pointerup') { const t = this.tileAt(e); if (t) { UI.inspect(t.x, t.y); Snd.play('select'); } }
      if (p.btn === 2 && !p.moved) { if (!UI.isBasic(UI.tool) || UI.tool.kind !== 'hand') { UI.setTool(BASIC_TOOLS[0]); UI.cat = null; UI.renderFlyout(); UI.refreshToolbarState(); } }
      this.updateCursor(); return;
    }
    if (this.drag) {
      const d = this.drag; this.drag = null;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const cancelled = e.type === 'pointercancel' || (e.pointerType === 'touch' && over && over !== Render.canvas);   // soltar sobre la interfaz cancela
      if (!cancelled) {
        if (d.touchBuild) { if (this.hover) this.placeAt(this.hover); }
        else if (!d.paint) this.commitDrag(d);
      }
    }
    if (e.pointerType === 'touch') { this.hover = null; Render.preview = null; UI.cursorTip(''); UI.tip(''); }
    else this.updatePreview(e);
  },
  onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (e.code !== 'Escape') return; }
    this.keys[e.code] = down;
    if (e.code === 'Space') this.spaceDown = down;
    if (!down || this.mode !== 'play') return;
    if (e.code === 'Escape') {
      if (UI.modalOpen) UI.closeModal();
      else if (UI.tool.kind !== 'hand' || UI.cat) { UI.setTool(BASIC_TOOLS[0]); UI.cat = null; UI.renderFlyout(); UI.refreshToolbarState(); }
      else if (UI.selTarget) UI.closeInspector();
      else UI.showMenu();
      return;
    }
    if (UI.modalOpen) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); Sim.speedIdx = Sim.speedIdx === 0 ? 1 : 0; UI.updateSpeed(); break;
      case 'Digit1': Sim.speedIdx = 1; UI.updateSpeed(); break;
      case 'Digit2': Sim.speedIdx = 2; UI.updateSpeed(); break;
      case 'Digit3': Sim.speedIdx = 3; UI.updateSpeed(); break;
      case 'KeyQ': Render.rotate(-1); break;
      case 'KeyE': Render.rotate(1); break;
      case 'KeyB': UI.setTool(BASIC_TOOLS[2]); break;
      case 'KeyX': UI.setTool(BASIC_TOOLS[1]); break;
      case 'KeyH': UI.setTool(BASIC_TOOLS[0]); break;
      case 'KeyV': { const sel = $('#selOverlay'); sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; Render.overlay = sel.value; UI.tip(sel.value === 'none' ? '' : 'Vista: ' + sel.options[sel.selectedIndex].text); break; }
      case 'Equal': case 'NumpadAdd': this.zoomBy(1.2); break;
      case 'Minus': case 'NumpadSubtract': this.zoomBy(1 / 1.2); break;
      case 'F1': e.preventDefault(); UI.showHelp(); break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); break;
    }
  },

  /** Botón "Atrás" de la app Android: devuelve true si cerró/canceló algo. */
  onBack() {
    if (UI.modalOpen) { UI.closeModal(); return true; }
    if (this.mode !== 'play') return false;
    if (document.body.classList.contains('mini-open')) { document.body.classList.remove('mini-open'); return true; }
    if (UI.selTarget) { UI.closeInspector(); return true; }
    if (UI.tool.kind !== 'hand' || UI.cat) { UI.setTool(BASIC_TOOLS[0]); UI.cat = null; UI.renderFlyout(); UI.refreshToolbarState(); return true; }
    UI.showMenu(); return true;
  },

  /* ---------- herramientas ---------- */
  lineTiles(a, b) {
    const out = [];
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) { const s = Math.sign(b.x - a.x) || 1; for (let x = a.x; x !== b.x + s; x += s) out.push([x, a.y]); }
    else { const s = Math.sign(b.y - a.y) || 1; for (let y = a.y; y !== b.y + s; y += s) out.push([a.x, y]); }
    return out;
  },
  rectTiles(a, b) {
    const out = [], x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
    return out;
  },
  footprintAt(def, t) { return { x: t.x - ((def.w - 1) >> 1), y: t.y - ((def.h - 1) >> 1) }; },
  placeAt(t, quiet) {
    const key = UI.tool.key, def = BDEFS[key], p = this.footprintAt(def, t);
    const r = Sim.placeBuilding(key, p.x, p.y);
    if (r.ok) {
      Snd.play('build');
      Render.addFx({ type: 'dust', x: r.b.cx, y: r.b.cy, t: 0, dur: 0.9, seed: Math.random() * 6, big: Math.sqrt(def.w * def.h) * 0.8 });
      if (Sim.S.diff !== 'sandbox') Render.addFx({ type: 'ring', x: r.b.cx, y: r.b.cy, t: 0, dur: 0.6, col: '#6dffb0' });
    } else if (!quiet) { UI.toast(r.reason, 'warn'); Snd.play('error'); }
  },
  commitDrag(d) {
    const t = this.hover; if (!t) return;
    const tool = d.tool; let r = null;
    if (tool.kind === 'road') {
      const tiles = this.lineTiles(d.start, t);
      r = Sim.buildRoads(tiles, tool.road);
      if (r.ok) { Snd.play('road'); for (const [x, y] of tiles.slice(0, 40)) Render.addFx({ type: 'dust', x: x + 0.5, y: y + 0.5, t: 0, dur: 0.5, seed: Math.random() * 6, big: 0.5 }); }
    } else if (tool.kind === 'zone') {
      r = Sim.paintZone(this.rectTiles(d.start, t), tool.zone);
      if (r.ok) Snd.play('zone');
    } else if (tool.kind === 'bulldoze') {
      const tiles = this.rectTiles(d.start, t);
      const bl = new Set(); for (const [x, y] of tiles) { const b = W.bldAt(x, y); if (b) bl.add(b); }
      r = Sim.demolish(tiles);
      if (r.ok) { Snd.play('bulldoze'); for (const b of bl) Render.addFx({ type: 'dust', x: b.cx, y: b.cy, t: 0, dur: 0.9, seed: Math.random() * 6, big: Math.sqrt(b.w * b.h), col: '#b9ae98' }); }
    }
    if (r && !r.ok) { if (r.reason === 'Nada que construir' || r.reason === 'No hay terreno disponible') UI.tip(r.reason); else { UI.toast(r.reason, 'warn'); Snd.play('error'); } }
  },
  updatePreview(e) {
    const tool = UI.tool, t = this.hover, x = e ? e.clientX : 0, y = e ? e.clientY - this.liftOf(e) - (e && e.pointerType === 'touch' ? 20 : 0) : 0;
    if (!t || this.mode !== 'play') { Render.preview = null; UI.cursorTip(''); return; }
    switch (tool.kind) {
      case 'hand': Render.preview = null; UI.cursorTip(''); break;
      case 'query': Render.preview = { hover: t }; UI.cursorTip(''); break;
      case 'road': {
        const tiles = this.drag ? this.lineTiles(this.drag.start, t) : [[t.x, t.y]];
        const p = Sim.previewRoad(tiles, tool.road), ok = new Set(p.tiles.map(([a, b]) => b * W.N + a));
        Render.preview = { tiles: tiles.map(([a, b]) => ({ x: a, y: b, ok: ok.has(b * W.N + a) || W.road[b * W.N + a] >= tool.road })) };
        UI.cursorTip(`${ROADS[tool.road].name} · ${p.n} tramo${p.n === 1 ? '' : 's'} · ${money(p.cost)}`, Sim.canAfford(p.cost), x, y);
        break;
      }
      case 'zone': {
        const tiles = this.drag ? this.rectTiles(this.drag.start, t) : [[t.x, t.y]];
        const p = Sim.previewZone(tiles, tool.zone), ok = new Set(p.tiles.map(([a, b]) => b * W.N + a));
        Render.preview = { tiles: tiles.map(([a, b]) => ({ x: a, y: b, ok: ok.has(b * W.N + a) })).filter(o => o.ok || !this.drag || tiles.length < 400) };
        UI.cursorTip(`${ZNAME[tool.zone]} · ${p.n} casilla${p.n === 1 ? '' : 's'} · ${money(p.cost)}`, Sim.canAfford(p.cost), x, y);
        break;
      }
      case 'bulldoze': {
        const tiles = this.drag ? this.rectTiles(this.drag.start, t) : [[t.x, t.y]];
        const list = tiles.filter(([a, b]) => { const i = b * W.N + a; return W.bid[i] || W.road[i] || W.zone[i] || W.tree[i]; }).map(([a, b]) => ({ x: a, y: b, ok: true }));
        Render.preview = { tiles: list, col: 'rgba(255,90,60,0.42)', stroke: 'rgba(255,140,90,0.95)', hover: this.drag ? null : t };
        UI.cursorTip(list.length ? `Demoler ${list.length} elemento${list.length > 1 ? 's' : ''}` : '', true, x, y);
        break;
      }
      case 'build': {
        const def = BDEFS[tool.key], p = this.footprintAt(def, t), r = W.canPlace(def, p.x, p.y);
        const unl = Sim.unlocked(def.unlock), aff = Sim.canAfford(def.cost);
        const ok = r.ok && unl && aff;
        Render.preview = { ghost: { key: tool.key, x: p.x, y: p.y, ok } };
        UI.cursorTip(!r.ok ? r.reason : !unl ? `Requiere ${fmt(def.unlock)} habitantes` : !aff ? `Fondos insuficientes (${money(def.cost)})` : `${def.name} · ${money(def.cost)}`, ok, x, y);
        break;
      }
    }
  },
  hoverInfo(t) {
    const i = Sim.inspectTile(t.x, t.y); if (!i) return;
    const parts = [`(${t.x}, ${t.y})`];
    if (i.b) parts.push(bName(i.b)); else if (i.road) parts.push(ROADS[i.road].name); else parts.push(i.terrain + (i.tree ? ' con árboles' : ''));
    if (i.zone && !i.b) parts.push('Zona ' + ZNAME[i.zone].toLowerCase());
    parts.push(`Valor ${Math.round(i.lv)}`);
    if (i.pol > 0.05) parts.push(`Contam. ${pct(i.pol)}`);
    if (i.crime > 0.2) parts.push(`Crimen ${pct(i.crime)}`);
    UI.tip(parts.join(' · '));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
