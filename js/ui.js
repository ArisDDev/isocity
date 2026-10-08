'use strict';
/* ==========================================================================
   Interfaz de usuario: HUD, barra de herramientas, ventanas y minimapa
   ========================================================================== */
const $ = s => document.querySelector(s);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
function bName(b) { return b.def ? b.def.name : ZB[ZONE[b.key]].name[b.lvl - 1]; }
function pct(v) { return Math.round(v * 100) + '%'; }
function setText(e, v) { if (e && e.textContent !== v) e.textContent = v; }

const BASIC_TOOLS = [
  { kind: 'hand', name: 'Mover', icon: '✋', desc: 'Arrastra para desplazar el mapa. También puedes usar el botón derecho o WASD.', key: 'H' },
  { kind: 'query', name: 'Consultar', icon: '🔍', desc: 'Haz clic en un edificio o terreno para ver sus datos.', key: 'X' },
  { kind: 'bulldoze', name: 'Demoler', icon: '🧨', desc: 'Arrastra para demoler edificios, calles, zonas y árboles.', key: 'B' },
];
const OVERLAYS = [
  ['none', '🗺️ Vista normal'], ['power', '⚡ Electricidad'], ['water', '💧 Agua'], ['pollution', '🏭 Contaminación'], ['crime', '🦹 Crimen'],
  ['lv', '💲 Valor del suelo'], ['traffic', '🚗 Tráfico'], ['happy', '😊 Felicidad'], ['police', '🚓 Cobertura policial'], ['fire', '🚒 Cobertura de bomberos'],
  ['health', '🏥 Cobertura sanitaria'], ['edu', '🎓 Cobertura educativa'], ['rec', '🌳 Cobertura de ocio'], ['transit', '🚌 Transporte'], ['garbage', '♻️ Reciclaje'],
];

const HUD_HTML = `
<div id="topbar" class="panel">
  <div class="tb city"><div class="cname" id="cName">—</div><div class="csub"><span id="cLevel"></span><span class="dot"> · </span><span id="cDate"></span></div></div>
  <div class="tb stat" title="Fondos de la ciudad"><div class="ico">💰</div><div class="val"><b id="vMoney">$0</b><small id="vNet">—</small></div></div>
  <div class="tb stat" title="Población y empleo"><div class="ico">👥</div><div class="val"><b id="vPop">0</b><small id="vJobs">—</small></div></div>
  <div class="tb stat" title="Felicidad media"><div class="ico" id="vHappyIco">🙂</div><div class="val"><b id="vHappy">50%</b><small>Felicidad</small></div></div>
  <div class="tb stat mini" title="Electricidad: producción / consumo"><div class="ico">⚡</div><div class="val"><b id="vPwr">—</b></div></div>
  <div class="tb stat mini" title="Agua: producción / consumo"><div class="ico">💧</div><div class="val"><b id="vWtr">—</b></div></div>
  <div class="tb rci" title="Demanda de zonas: Residencial, Comercial, Industrial">
    <div class="bar r"><i id="dR"></i><span>R</span></div><div class="bar c"><i id="dC"></i><span>C</span></div><div class="bar i"><i id="dI"></i><span>I</span></div>
  </div>
  <div class="spacer"></div>
  <div class="tb speed" id="speedCtl">
    <button data-s="0" title="Pausa (Espacio)">⏸</button><button data-s="1" title="Velocidad x1 (1)">▶</button><button data-s="2" title="Velocidad x3 (2)">⏩</button><button data-s="3" title="Velocidad x8 (3)">⏭</button>
  </div>
  <div class="tb btns">
    <button id="bBudget" title="Presupuesto e impuestos"><span>💵</span><em>Presupuesto</em></button>
    <button id="bStats" title="Estadísticas"><span>📊</span><em>Estadísticas</em></button>
    <button id="bOrd" title="Ordenanzas"><span>📜</span><em>Ordenanzas</em></button>
    <button id="bAch" title="Logros"><span>🏆</span><em>Logros</em></button>
    <button id="bMenu" title="Menú (Esc)"><span>☰</span><em>Menú</em></button>
  </div>
</div>
<div id="goals" class="panel">
  <div class="ph" id="goalsHead"><span>📋 Objetivos</span><span id="goalsCount"></span><button class="x" id="goalsToggle" title="Contraer">–</button></div>
  <div id="goalsList"></div>
</div>
<div id="sidecol">
  <div class="panel" id="minipanel">
    <canvas id="minimap" width="220" height="116"></canvas>
    <div class="mini-btns">
      <button id="bRotL" title="Rotar a la izquierda (Q)">⟲</button><button id="bRotR" title="Rotar a la derecha (E)">⟳</button>
      <button id="bZoomOut" title="Alejar (−)">−</button><button id="bZoomIn" title="Acercar (+)">＋</button>
      <button id="bNight" title="Ciclo día/noche">🌙</button><button id="bMusic" title="Sonido y música">🎵</button>
      <button id="bLog" title="Historial de avisos">🔔</button><button id="bDis" title="Desastres">🌪️</button>
    </div>
    <select id="selOverlay" title="Vistas de datos (V)"></select>
  </div>
  <div class="panel hidden" id="inspector"></div>
</div>
<div id="viewbtns">
  <button id="vbRotL" title="Rotar">⟲</button><button id="vbRotR" title="Rotar">⟳</button><button id="vbZin" title="Acercar">＋</button><button id="vbZout" title="Alejar">−</button><button id="vbMap" title="Minimapa y vistas">🗺️</button>
</div>
<div id="toasts"></div>
<div id="bottombar">
  <div id="toolinfo" class="panel hidden"></div>
  <div id="flyout" class="panel hidden"></div>
  <div id="toolbar" class="panel"></div>
</div>
<div id="hoverInfo"></div>
<div id="cursorTip" class="hidden"></div>
`;

const UI = {
  tool: BASIC_TOOLS[0], cat: null, modalOpen: false, _acc: 0, _miniAcc: 0, _miniVer: -1, _miniImg: null,
  pausedByModal: false, goalsCollapsed: false, selTarget: null, _modalClose: null,

  init() {
    $('#hud').innerHTML = HUD_HTML;
    const sel = $('#selOverlay');
    OVERLAYS.forEach(([v, n]) => sel.append(el('option', { value: v }, n)));
    sel.addEventListener('change', () => { Render.overlay = sel.value; Snd.play('click'); this.tip(sel.value === 'none' ? '' : 'Vista: ' + sel.options[sel.selectedIndex].text); });
    this.buildToolbar();
    $('#speedCtl').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      Sim.speedIdx = this.isCompact() ? (Sim.speedIdx + 1) % 4 : +b.dataset.s;   // en móvil un solo botón recorre las velocidades
      Snd.play('click'); this.updateSpeed();
    });
    $('#vbRotL').onclick = () => { Render.rotate(-1); Snd.play('click'); };
    $('#vbRotR').onclick = () => { Render.rotate(1); Snd.play('click'); };
    $('#vbZin').onclick = () => Game.zoomBy(1.25);
    $('#vbZout').onclick = () => Game.zoomBy(1 / 1.25);
    $('#vbMap').onclick = () => { document.body.classList.toggle('mini-open'); Snd.play('click'); };
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 250));
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => this.measure()); ro.observe($('#topbar')); ro.observe($('#toolbar')); }
    this.layout();
    $('#bBudget').onclick = () => this.showBudget();
    $('#bStats').onclick = () => this.showStats();
    $('#bOrd').onclick = () => this.showOrds();
    $('#bAch').onclick = () => this.showAch();
    $('#bMenu').onclick = () => this.showMenu();
    $('#bRotL').onclick = () => { Render.rotate(-1); Snd.play('click'); };
    $('#bRotR').onclick = () => { Render.rotate(1); Snd.play('click'); };
    $('#bZoomIn').onclick = () => Game.zoomBy(1.2);
    $('#bZoomOut').onclick = () => Game.zoomBy(1 / 1.2);
    $('#bNight').onclick = () => { Render.nightOn = !Render.nightOn; $('#bNight').classList.toggle('off', !Render.nightOn); Snd.play('click'); };
    $('#bMusic').onclick = () => {
      Snd.init();
      const on = !(Snd.sfx || Snd.music); Snd.setSfx(on); Snd.setMusic(on);
      $('#bMusic').classList.toggle('off', !on); $('#bMusic').textContent = on ? '🎵' : '🔇'; Snd.play('click');
    };
    $('#bLog').onclick = () => this.showLog();
    $('#bDis').onclick = () => this.showDisasters();
    $('#goalsToggle').onclick = () => this.setGoalsCollapsed(!this.goalsCollapsed);
    $('#goalsHead').addEventListener('click', e => { if (this.isCompact() && e.target.id !== 'goalsToggle') this.setGoalsCollapsed(!this.goalsCollapsed); });
    const mm = $('#minimap');
    let drag = false;
    const go = e => { const r = mm.getBoundingClientRect(); const [px, py] = this.minimapToWorld((e.clientX - r.left) * mm.width / r.width, (e.clientY - r.top) * mm.height / r.height); Render.centerOn(clamp(px, 0, W.N), clamp(py, 0, W.N)); };
    mm.addEventListener('pointerdown', e => { drag = true; mm.setPointerCapture(e.pointerId); go(e); });
    mm.addEventListener('pointermove', e => { if (drag) go(e); });
    mm.addEventListener('pointerup', () => drag = false);
    this.updateSpeed();
  },

  showHud(v) { $('#hud').classList.toggle('hidden', !v); if (v) setTimeout(() => this.measure(), 0); },

  /* ---------- adaptación a móvil / pantallas pequeñas ---------- */
  isCompact() { return document.body.classList.contains('compact'); },
  layout() {
    const w = window.innerWidth, h = window.innerHeight, b = document.body.classList;
    const compact = Math.min(w, h) < 600 || w < 820;
    const touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
    b.toggle('compact', compact); b.toggle('portrait', h >= w); b.toggle('landscape', h < w); b.toggle('touch', touch);
    if (compact && !this._compactInit) { this._compactInit = true; this.setGoalsCollapsed(true); }
    if (!compact) b.remove('mini-open');
    this.measure();
  },
  measure() {
    const tb = $('#topbar'), bt = $('#toolbar'), s = document.documentElement.style;
    if (tb && tb.offsetHeight) s.setProperty('--tbh', (tb.offsetHeight + 14) + 'px');
    if (bt && bt.offsetHeight) s.setProperty('--tbarh', bt.offsetHeight + 'px');
  },
  setGoalsCollapsed(v) {
    this.goalsCollapsed = v; $('#goals').classList.toggle('collapsed', v); $('#goalsToggle').textContent = v ? '+' : '–';
  },

  /* ---------- barra de herramientas ---------- */
  buildToolbar() {
    const tb = $('#toolbar'); tb.innerHTML = '';
    this.catBtns = {};
    for (const t of BASIC_TOOLS) {
      const b = el('button', { class: 'tbtn basic', title: `${t.name} (${t.key})`, onclick: () => { this.setTool(t); Snd.play('click'); } }, el('div', { class: 'ti' }, t.icon), el('span', {}, t.name));
      b.dataset.tool = t.kind; tb.append(b); this.catBtns[t.kind] = b;
    }
    tb.append(el('div', { class: 'sep' }));
    for (const c of CATS) {
      const first = c.items[0];
      const iconEl = el('div', { class: 'ti' });
      const b = el('button', { class: 'tbtn', title: c.name, onclick: () => { this.toggleCat(c.id); Snd.play('click'); } }, iconEl, el('span', {}, c.name));
      b.dataset.cat = c.id; tb.append(b); this.catBtns[c.id] = b;
      c.iconEl = iconEl;
    }
    this.refreshCatIcons();
  },
  refreshCatIcons() {
    for (const c of CATS) {
      if (c.iconEl.firstChild) continue;
      try {
        const it = c.items[0];
        const cv = Sprites.icon(it, 40); cv.style.width = cv.style.height = '34px';
        c.iconEl.append(cv);
      } catch (e) { c.iconEl.textContent = c.icon; }
    }
  },
  toggleCat(id) {
    this.cat = this.cat === id ? null : id;
    this.renderFlyout();
    this.refreshToolbarState();
  },
  itemInfo(it) {
    if (it.kind === 'road') { const r = ROADS[it.road]; return { name: r.name, cost: r.cost, unlock: r.unlock, desc: r.desc, lines: [`Mantenimiento ${money(r.upkeep)}/mes por tramo`, `Capacidad de tráfico: ${r.cap}`, 'Arrastra para trazar una línea. Sobre el agua se construyen puentes (×4).'] }; }
    if (it.kind === 'zone') { const z = ZONE_INFO[it.zone]; return { name: z.name, cost: z.cost, unlock: 0, desc: z.desc, lines: ['Se cobra por casilla. Arrastra para pintar un área.', 'Los edificios crecen solos si hay carretera adyacente, electricidad y agua.'] }; }
    const d = BDEFS[it.key], l = [];
    l.push(`Mantenimiento ${money(d.upkeep)}/mes`);
    if (d.prodP) l.push(`⚡ Produce ${d.prodP} de electricidad`);
    if (d.prodW) l.push(`💧 Produce ${d.prodW} de agua`);
    if (d.useP) l.push(`Consume ${d.useP} ⚡`); if (d.useW) l.push(`Consume ${d.useW} 💧`);
    if (d.cover) for (const k in d.cover) l.push(`Radio de acción: ${d.cover[k]} casillas`);
    if (d.pol) l.push(`Contaminación: ${d.pol > 5 ? 'alta' : 'baja'}`);
    if (d.jobs) l.push(`Empleos: ${d.jobs}`);
    if (d.needWater) l.push('Debe colocarse junto al agua');
    l.push(`Tamaño ${d.w}×${d.h}`);
    return { name: d.name, cost: d.cost, unlock: d.unlock, desc: d.desc, lines: l };
  },
  renderFlyout() {
    const fl = $('#flyout');
    const c = CATS.find(c => c.id === this.cat);
    document.body.classList.toggle('flyout-open', !!c);
    if (!c) { fl.classList.add('hidden'); $('#toolinfo').classList.add('hidden'); return; }
    fl.classList.remove('hidden'); fl.innerHTML = '';
    for (const it of c.items) {
      const info = this.itemInfo(it), locked = !Sim.unlocked(info.unlock);
      const cv = Sprites.icon(it, 60); cv.style.width = cv.style.height = '52px';
      const card = el('button', { class: 'card' + (locked ? ' locked' : '') },
        cv, el('div', { class: 'nm' }, info.name), el('div', { class: 'cs' }, locked ? `🔒 ${fmt(info.unlock)} hab.` : money(info.cost)));
      card.addEventListener('click', () => {
        if (locked) { this.toast(`🔒 ${info.name}: se desbloquea con ${fmt(info.unlock)} habitantes.`, 'warn'); Snd.play('error'); return; }
        this.setTool(it); Snd.play('select');
      });
      card.addEventListener('mouseenter', () => this.showToolInfo(info, locked));
      card.addEventListener('mouseleave', () => this.showToolInfo(!this.isBasic(this.tool) ? this.itemInfo(this.tool) : null));
      card._it = it; fl.append(card);
    }
    this.markCards();
  },
  markCards() {
    const t = this.tool;
    document.querySelectorAll('#flyout .card').forEach(cd => {
      const it = cd._it; let on = false;
      if (t && it && it.kind === t.kind) on = it.kind === 'road' ? it.road === t.road : it.kind === 'zone' ? it.zone === t.zone : it.key === t.key;
      cd.classList.toggle('active', on);
    });
  },
  showToolInfo(info, locked) {
    const ti = $('#toolinfo');
    if (!info) { ti.classList.add('hidden'); return; }
    ti.classList.remove('hidden');
    const price = locked ? `<b>🔒 ${fmt(info.unlock)} hab.</b>` : (info.cost != null ? `<b>${money(info.cost)}</b>` : '');
    ti.innerHTML = `<div class="tn">${info.name} ${price}</div><div class="td">${info.desc}</div>` +
      (info.lines ? '<ul>' + info.lines.map(l => `<li>${l}</li>`).join('') + '</ul>' : '');
  },
  isBasic(t) { return t.kind === 'hand' || t.kind === 'query' || t.kind === 'bulldoze'; },
  toolCat(t) {
    return CATS.find(c => c.items.some(it => it.kind === t.kind && (it.kind === 'road' ? it.road === t.road : it.kind === 'zone' ? it.zone === t.zone : it.key === t.key)));
  },
  refreshToolbarState() {
    const t = this.tool, basic = this.isBasic(t), tc = basic ? null : this.toolCat(t);
    for (const k in this.catBtns) {
      const b = this.catBtns[k];
      if (b.classList.contains('basic')) b.classList.toggle('active', basic && k === t.kind);
      else b.classList.toggle('active', k === this.cat || (tc && k === tc.id));
    }
  },
  setTool(t) {
    this.tool = t;
    const basic = this.isBasic(t);
    if (basic) { this.cat = null; $('#flyout').classList.add('hidden'); document.body.classList.remove('flyout-open'); }
    this.refreshToolbarState(); this.markCards();
    if (!basic) this.showToolInfo(this.itemInfo(t));
    else if (t.kind !== 'hand') this.showToolInfo({ name: t.name, cost: null, desc: t.desc, lines: null, unlock: 0 });
    else this.showToolInfo(null);
    if (t.kind !== 'query') this.closeInspector();
    Render.preview = null; this.cursorTip('');
    Game.updateCursor();
  },
  tip(text) { setText($('#hoverInfo'), text || ''); },

  /* ---------- avisos ---------- */
  toast(text, kind) {
    const box = $('#toasts'); if (!box) return;
    for (const c of box.children) if (c.textContent === text) return;
    const t = el('div', { class: 'toast ' + (kind || 'info') }, text);
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, kind === 'bad' ? 7000 : 5200);
    if (kind === 'bad') Snd.play('warn'); else if (kind === 'warn') Snd.play('warn'); else if (kind === 'good') Snd.play('coin');
  },
  cursorTip(text, ok, x, y) {
    const t = $('#cursorTip');
    if (!text) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden'); t.classList.toggle('bad', ok === false);
    setText(t, text);
    t.style.left = Math.min(x + 18, window.innerWidth - 220) + 'px'; t.style.top = Math.max(60, y - 34) + 'px';
  },

  /* ---------- actualización periódica ---------- */
  update(dt) {
    this._acc += dt; this._miniAcc += dt;
    if (this._acc > 0.25) { this._acc = 0; this.refreshHud(); }
    if (this._miniAcc > 0.15) { this._miniAcc = 0; this.drawMinimap(); }
  },
  refreshHud() {
    const S = Sim.S; if (!S) return;
    const st = S.stats;
    setText($('#cName'), S.name); setText($('#cLevel'), Sim.cityLevel()); setText($('#cDate'), Sim.dateStr());
    const m = $('#vMoney'); setText(m, S.diff === 'sandbox' ? '∞ Sandbox' : money(S.money)); m.classList.toggle('neg', S.money < 0);
    const net = S.budget ? S.budget.net : 0;
    const n = $('#vNet'); setText(n, S.budget ? `${net >= 0 ? '+' : '−'}${money(Math.abs(net)).replace('-', '')}/mes` : 'sin datos'); n.className = net >= 0 ? 'pos' : 'neg';
    setText($('#vPop'), fmt(st.pop));
    setText($('#vJobs'), st.pop > 5 ? `${this.isCompact() ? 'Desemp.' : 'Desempleo'} ${pct(st.unemp)}` : (this.isCompact() ? 'Sin hab.' : 'Sin habitantes'));
    const h = Math.round(st.happiness);
    setText($('#vHappy'), h + '%');
    setText($('#vHappyIco'), h >= 80 ? '😄' : h >= 62 ? '🙂' : h >= 45 ? '😐' : h >= 28 ? '😟' : '😡');
    const pr = st.pDemand > 0 ? Math.min(1, st.pSupply / st.pDemand) : (st.pSupply > 0 ? 1 : 0), wr = st.wDemand > 0 ? Math.min(1, st.wSupply / st.wDemand) : (st.wSupply > 0 ? 1 : 0);
    const pe = $('#vPwr'), we = $('#vWtr');
    setText(pe, `${fmt(st.pSupply)}/${fmt(st.pDemand)}`); pe.className = pr < 0.999 && st.pDemand > 0 ? 'neg' : '';
    setText(we, `${fmt(st.wSupply)}/${fmt(st.wDemand)}`); we.className = wr < 0.999 && st.wDemand > 0 ? 'neg' : '';
    for (const k of ['R', 'C', 'I']) {
      const d = S.demand[k], i = $('#d' + k);
      i.style.height = Math.abs(d) * 50 + '%'; i.style.top = d >= 0 ? (50 - d * 50) + '%' : '50%';
      i.className = d >= 0 ? 'up' : 'down';
    }
    this.updateSpeed();
    if (this.selTarget) this.refreshInspector();
  },
  updateSpeed() {
    document.querySelectorAll('#speedCtl button').forEach(b => b.classList.toggle('active', +b.dataset.s === Sim.speedIdx));
  },

  /* ---------- objetivos ---------- */
  refreshGoals() {
    const S = Sim.S; if (!S) return;
    const list = $('#goalsList'); list.innerHTML = '';
    let done = 0, shown = 0;
    for (const g of GOALS) {
      const d = !!S.goals[g.id]; if (d) done++;
      if (d) continue;
      if (shown >= 3) continue;
      shown++;
      list.append(el('div', { class: 'goal' }, el('span', { class: 'chk' }, '○'), el('span', { class: 'gt' }, g.text), el('span', { class: 'gr' }, '+' + money(g.reward))));
    }
    if (done === GOALS.length) list.append(el('div', { class: 'goal done' }, '🎉 ¡Todos los objetivos completados!'));
    setText($('#goalsCount'), `${done}/${GOALS.length}`);
  },

  /* ---------- inspector ---------- */
  inspect(x, y) {
    const info = Sim.inspectTile(x, y);
    if (!info) return this.closeInspector();
    this.selTarget = { x, y };
    Render.selected = info.b || null;
    this.refreshInspector();
  },
  closeInspector() { this.selTarget = null; Render.selected = null; $('#inspector').classList.add('hidden'); },
  refreshInspector() {
    const t = this.selTarget; if (!t) return;
    const insp = $('#inspector');
    const info = Sim.inspectTile(t.x, t.y);
    let b = info.b;
    if (Render.selected && !W.buildings.has(Render.selected.id)) { Render.selected = null; }
    if (b && Render.selected !== b) Render.selected = b;
    const bar = (label, v, col, txt) => `<div class="irow"><span>${label}</span><div class="ib"><i style="width:${clamp(v, 0, 1) * 100}%;background:${col}"></i></div><em>${txt !== undefined ? txt : pct(v)}</em></div>`;
    const row = (l, v) => `<div class="irow2"><span>${l}</span><b>${v}</b></div>`;
    let h = '';
    if (b) {
      const d = b.def, z = !d;
      h += `<div class="ih"><b>${bName(b)}</b><button class="x" id="inClose">✕</button></div>`;
      let status = '✅ Operativo';
      if (b.fire) status = '🔥 ¡En llamas!'; else if (b.acc < 0) status = '🚧 Sin acceso a carretera'; else if (!b.pw) status = '⚡ Sin electricidad'; else if (!b.wt) status = '💧 Sin agua';
      h += row('Estado', status);
      if (z) {
        h += row('Nivel', b.lvl + ' / 3');
        if (b.key === 'R') { h += row('Residentes', `${Math.round(b.pop)} / ${ZB[1].cap[b.lvl - 1]}`); h += bar('Felicidad', b.happy / 100, b.happy > 60 ? '#5ee08a' : b.happy > 35 ? '#ffc857' : '#ff6b6b'); }
        else h += row('Empleos', `${Math.round(b.emp)} / ${ZB[ZONE[b.key]].jobs[b.lvl - 1]}`);
      } else {
        h += row('Mantenimiento', money(d.upkeep * (d.dept ? Sim.S.funding[d.dept] / 100 : 1)) + '/mes');
        if (d.prodP) h += row('Producción', `⚡ ${d.prodP}`);
        if (d.prodW) h += row('Producción', `💧 ${d.prodW}`);
        if (d.jobs) h += row('Empleos', d.jobs);
        if (d.dept) h += row('Financiación', Sim.S.funding[d.dept] + '%');
      }
      h += row('Electricidad', Sim.consP(b) ? `${Sim.consP(b).toFixed(1)} · ${b.pw ? '✔' : '✘'}` : '—');
      h += row('Agua', Sim.consW(b) ? `${Sim.consW(b).toFixed(1)} · ${b.wt ? '✔' : '✘'}` : '—');
      if (b.hp < 100) h += bar('Integridad', b.hp / 100, '#ffc857');
    } else {
      h += `<div class="ih"><b>${info.road ? ROADS[info.road].name : info.zone ? ZONE_INFO[info.zone].name : info.terrain}</b><button class="x" id="inClose">✕</button></div>`;
      h += row('Posición', `${info.x}, ${info.y}`);
      h += row('Terreno', info.terrain + (info.tree ? ' (árboles)' : ''));
      if (info.road) h += row('Tráfico', pct(clamp(info.traf, 0, 1)));
    }
    h += '<div class="isep"></div>';
    h += bar('Valor del suelo', info.lv / 100, '#4fd1c5', Math.round(info.lv));
    h += bar('Contaminación', info.pol, '#b8860b');
    h += bar('Crimen', info.crime, '#e4572e');
    h += `<div class="isep"></div><div class="isub">Cobertura de servicios</div>`;
    const names = { police: '🚓 Policía', fire: '🚒 Bomberos', health: '🏥 Salud', edu: '🎓 Educación', rec: '🌳 Ocio', garbage: '♻️ Reciclaje', transit: '🚌 Transporte' };
    for (const k of COVS) h += bar(names[k], info.cov[k], '#5aa9ff');
    if (b) h += `<button class="danger" id="inDemo">🧨 Demoler</button>`;
    if (insp.dataset.sig !== h) { insp.innerHTML = h; insp.dataset.sig = h; }
    insp.classList.remove('hidden');
    const c = $('#inClose'); if (c) c.onclick = () => this.closeInspector();
    const dm = $('#inDemo'); if (dm) dm.onclick = () => { Sim.demolish([[b.x, b.y]]); Snd.play('bulldoze'); this.closeInspector(); };
  },

  /* ---------- minimapa ---------- */
  minimapToWorld(mx, my) {
    const cv = $('#minimap'), N = W.N, k = cv.width / (N * Math.SQRT2);
    const dx = mx - cv.width / 2, dy = (my - cv.height / 2) * 2;
    const ang = -(Math.PI / 4 + Cam.rot * Math.PI / 2), cs = Math.cos(ang), sn = Math.sin(ang);
    const rx = (dx * cs - dy * sn) / k, ry = (dx * sn + dy * cs) / k;
    return [rx + N / 2, ry + N / 2];
  },
  drawMinimap() {
    const cv = $('#minimap'); if (!cv || !W.ter) return;
    const N = W.N, ctx = cv.getContext('2d');
    if (!this._miniCv || this._miniCv.width !== N) { this._miniCv = document.createElement('canvas'); this._miniCv.width = this._miniCv.height = N; this._miniImg = this._miniCv.getContext('2d').createImageData(N, N); this._miniVer = -1; }
    if (this._miniVer !== W.version || this._miniSig !== Sim.S.totalDays) {
      this._miniVer = W.version; this._miniSig = Sim.S.totalDays;
      const d = this._miniImg.data;
      for (let i = 0; i < N * N; i++) {
        let c = [60, 130, 195]; const t = W.ter[i];
        if (t === TER.GRASS) c = W.tree[i] ? [52, 120, 62] : [92, 160, 80]; else if (t === TER.SAND) c = [214, 198, 140];
        const z = W.zone[i];
        if (z === 1) c = [80, 175, 110]; else if (z === 2) c = [90, 140, 210]; else if (z === 3) c = [205, 175, 70];
        if (W.road[i]) c = [70, 74, 82];
        const bid = W.bid[i];
        if (bid) {
          const b = W.buildings.get(bid);
          if (b) { c = b.key === 'R' ? [60, 220, 120] : b.key === 'C' ? [70, 150, 255] : b.key === 'I' ? [255, 210, 60] : [240, 240, 245]; if (b.fire) c = [255, 70, 30]; }
        }
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      this._miniCv.getContext('2d').putImageData(this._miniImg, 0, 0);
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    const k = cv.width / (N * Math.SQRT2);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4 + Cam.rot * Math.PI / 2); ctx.scale(k, k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._miniCv, -N / 2, -N / 2);
    // área visible
    const v = Render.view;
    if (v) {
      const pts = [[v.vx0, v.vy0], [v.vx1, v.vy0], [v.vx1, v.vy1], [v.vx0, v.vy1]].map(([sx, sy]) => Render.unproj(sx, sy));
      ctx.beginPath();
      pts.forEach(([px, py], n) => { const x = px - N / 2, y = py - N / 2; n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6 / k * 0.6; ctx.stroke();
    }
    ctx.restore();
  },

  /* ---------- ventanas modales ---------- */
  modal(title, body, opts = {}) {
    this.closeModal(true);
    const root = $('#modalRoot');
    const win = el('div', { class: 'modal', style: `width:${opts.width || 560}px` },
      el('div', { class: 'mh' }, el('b', {}, title), opts.noClose ? null : el('button', { class: 'x', onclick: () => this.closeModal() }, '✕')),
      el('div', { class: 'mb' }, body));
    const wrap = el('div', { class: 'modal-wrap' }, win);
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap && !opts.sticky) this.closeModal(); });
    root.append(wrap); this.modalOpen = true; this._modalClose = opts.onClose || null;
    if (opts.pause && Sim.speedIdx !== 0) { this.pausedByModal = Sim.speedIdx; Sim.speedIdx = 0; this.updateSpeed(); }
    Snd.play('click');
    return win;
  },
  closeModal(silent) {
    const root = $('#modalRoot'); if (!root) return;
    const had = this.modalOpen; root.innerHTML = ''; this.modalOpen = false;
    if (this.pausedByModal) { Sim.speedIdx = this.pausedByModal; this.pausedByModal = false; this.updateSpeed(); }
    if (this._modalClose) { const f = this._modalClose; this._modalClose = null; f(); }
    if (had && !silent) Snd.play('click');
  },
  confirm(title, text, okLabel, cb) {
    const body = el('div', {}, el('p', { class: 'ptext' }, text), el('div', { class: 'btnrow' },
      el('button', { class: 'btn', onclick: () => this.closeModal() }, 'Cancelar'),
      el('button', { class: 'btn primary', onclick: () => { this.closeModal(); cb(); } }, okLabel || 'Aceptar')));
    this.modal(title, body, { width: 420 });
  },

  /* ---------- presupuesto ---------- */
  showBudget() {
    const S = Sim.S;
    const body = el('div', { class: 'budget' });
    const sum = el('div', { class: 'bsum' });
    const upd = () => {
      const b = Sim.calcBudget();
      const r = (l, v, cls) => `<div class="brow ${cls || ''}"><span>${l}</span><b>${money(v)}</b></div>`;
      let h = `<div class="bcol"><h5>Ingresos / mes</h5>${r('🏠 Residencial', b.revR)}${r('🏪 Comercial', b.revC)}${r('🏭 Industrial', b.revI)}${r('Total', b.rev, 'tot')}</div>`;
      h += `<div class="bcol"><h5>Gastos / mes</h5>`;
      for (const k in DEPTS) if (b.dep[k] > 0) h += r(`${DEPTS[k].icon} ${DEPTS[k].name}`, b.dep[k]);
      h += r('⚡ Energía', b.power) + r('💧 Agua', b.water) + r('🛣️ Carreteras', b.roads);
      if (b.other) h += r('Otros', b.other);
      if (b.interest) h += r('🏦 Intereses', b.interest);
      if (b.ord) h += r('📜 Ordenanzas', b.ord);
      h += r('Total', b.exp, 'tot') + '</div>';
      h += `<div class="bnet ${b.net >= 0 ? 'pos' : 'neg'}">Balance mensual: <b>${b.net >= 0 ? '+' : '−'}${money(Math.abs(b.net)).replace('-', '')}</b></div>`;
      sum.innerHTML = h;
    };
    const slider = (label, min, max, val, onchange, suffix) => {
      const v = el('b', {}, val + suffix);
      const inp = el('input', { type: 'range', min, max, value: val, step: 1 });
      inp.addEventListener('input', () => { onchange(+inp.value); v.textContent = inp.value + suffix; upd(); });
      return el('div', { class: 'srow' }, el('span', {}, label), inp, v);
    };
    body.append(el('h4', {}, '💹 Impuestos'));
    for (const [k, n] of [['R', '🏠 Residencial'], ['C', '🏪 Comercial'], ['I', '🏭 Industrial']]) body.append(slider(n, 0, 20, S.taxes[k], v => Sim.setTax(k, v), '%'));
    body.append(el('p', { class: 'hint' }, 'Impuestos altos reducen la felicidad y la demanda de nuevas zonas. 9% es el nivel neutral.'));
    body.append(el('h4', {}, '🏛️ Financiación de servicios'));
    for (const k in DEPTS) body.append(slider(`${DEPTS[k].icon} ${DEPTS[k].name}`, 0, 100, S.funding[k], v => Sim.setFunding(k, v), '%'));
    body.append(el('h4', {}, '📈 Resumen'), sum);
    // préstamos
    const loans = el('div', { class: 'loans' });
    const drawLoans = () => {
      loans.innerHTML = '';
      if (!S.loans.length) loans.append(el('p', { class: 'hint' }, 'No tienes préstamos. Interés: 0,8% mensual.'));
      S.loans.forEach((l, i) => loans.append(el('div', { class: 'loan' }, el('span', {}, `Préstamo ${money(l.amount)}`), el('em', {}, `interés ${money(l.amount * 0.008)}/mes`),
        el('button', { class: 'btn sm', onclick: () => { if (Sim.repayLoan(i)) { Snd.play('coin'); drawLoans(); upd(); } else this.toast('No tienes fondos suficientes para saldar el préstamo.', 'warn'); } }, 'Saldar'))));
      const row = el('div', { class: 'btnrow left' });
      for (const a of [5000, 20000, 50000]) row.append(el('button', { class: 'btn sm', onclick: () => { if (Sim.takeLoan(a)) { Snd.play('coin'); drawLoans(); upd(); } else this.toast('Ya tienes el máximo de 4 préstamos.', 'warn'); } }, `Pedir ${money(a)}`));
      loans.append(row);
    };
    body.append(el('h4', {}, '🏦 Banco'), loans);
    drawLoans(); upd();
    this.modal('Presupuesto de la ciudad', body, { width: 640 });
  },

  /* ---------- estadísticas ---------- */
  showStats() {
    const S = Sim.S, h = S.hist;
    const body = el('div', { class: 'stats' });
    const tabs = el('div', { class: 'tabs' });
    const cv = el('canvas', { class: 'chart' });
    const legend = el('div', { class: 'legend' });
    const sets = {
      'Población': [{ d: h.pop, c: '#5ee08a', l: 'Habitantes' }, { d: h.jobs, c: '#5aa9ff', l: 'Empleos' }],
      'Finanzas': [{ d: h.money, c: '#ffc857', l: 'Fondos' }],
      'Balance': [{ d: h.net, c: '#4fd1c5', l: 'Balance mensual' }],
      'Felicidad': [{ d: h.happy, c: '#ff8fab', l: 'Felicidad %' }],
      'Demanda': [{ d: h.dR, c: '#5ee08a', l: 'Residencial' }, { d: h.dC, c: '#5aa9ff', l: 'Comercial' }, { d: h.dI, c: '#ffc857', l: 'Industrial' }],
      'Desempleo': [{ d: h.unemp.map(v => v * 100), c: '#ff6b6b', l: 'Desempleo %' }],
    };
    let cur = 'Población';
    const draw = () => {
      lineChart(cv, sets[cur].map(s => ({ data: s.d, color: s.c })));
      legend.innerHTML = sets[cur].map(s => `<span><i style="background:${s.c}"></i>${s.l}</span>`).join('');
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.textContent === cur));
    };
    for (const k in sets) tabs.append(el('button', { onclick: () => { cur = k; draw(); Snd.play('click'); } }, k));
    body.append(tabs, cv, legend);
    const st = S.stats;
    const info = el('div', { class: 'kpis' });
    const kp = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
    info.innerHTML = kp('Población', fmt(st.pop)) + kp('Población activa', fmt(st.workforce)) + kp('Empleos', fmt(st.jobs)) + kp('Desempleo', pct(st.unemp)) +
      kp('Felicidad', Math.round(st.happiness) + '%') + kp('Contaminación', pct(st.pol)) + kp('Crimen', pct(st.crime)) + kp('Atascos', pct(st.jam)) +
      kp('Educación media', pct(st.eduIdx)) + kp('Edificios', fmt(W.buildings.size)) + kp('Calles', fmt(Sim.roadCount())) + kp('Año', S.year);
    body.append(info);
    this.modal('Estadísticas', body, { width: 680 });
    requestAnimationFrame(draw);
  },

  /* ---------- ordenanzas ---------- */
  showOrds() {
    const S = Sim.S, body = el('div', { class: 'ords' });
    const render = () => {
      body.innerHTML = '';
      for (const o of ORDS) {
        const on = !!S.ord[o.id], cost = o.base + o.perCap * S.stats.pop;
        body.append(el('div', { class: 'ord' + (on ? ' on' : '') }, el('div', { class: 'oi' }, o.icon),
          el('div', { class: 'ot' }, el('b', {}, o.name), el('span', {}, o.desc), el('em', {}, `Coste ≈ ${money(cost)}/mes`)),
          el('button', { class: 'btn sm' + (on ? ' primary' : ''), onclick: () => { Sim.toggleOrd(o.id); Snd.play('click'); render(); } }, on ? 'Activa' : 'Activar')));
      }
    };
    render();
    this.modal('Ordenanzas municipales', body, { width: 560 });
  },

  /* ---------- logros ---------- */
  showAch() {
    const S = Sim.S, body = el('div', { class: 'achs' });
    for (const a of ACHS) {
      const d = !!S.ach[a.id];
      body.append(el('div', { class: 'ach' + (d ? ' done' : '') }, el('div', { class: 'ai' }, d ? a.icon : '🔒'), el('div', { class: 'at' }, el('b', {}, a.name), el('span', {}, a.desc), el('em', {}, `Recompensa ${money(a.reward)}`))));
    }
    this.modal(`Logros (${Object.keys(S.ach).length}/${ACHS.length})`, body, { width: 620 });
  },

  showLog() {
    const body = el('div', { class: 'logbox' });
    if (!Sim.log.length) body.append(el('p', { class: 'hint' }, 'Todavía no hay avisos.'));
    for (const l of Sim.log) body.append(el('div', { class: 'logrow ' + l.kind }, el('em', {}, l.t), el('span', {}, l.text)));
    this.modal('Historial de avisos', body, { width: 560 });
  },

  showDisasters() {
    const body = el('div', { class: 'dis' }, el('p', { class: 'ptext' }, 'Pon a prueba tu ciudad. ¡Los desastres destruyen edificios y no se pueden deshacer!'));
    const defs = [['fire', '🔥', 'Incendio', 'Prende un edificio al azar.'], ['quake', '🌋', 'Terremoto', 'Daña edificios en toda la ciudad.'], ['meteor', '☄️', 'Meteorito', 'Un impacto devastador en una zona.'], ['tornado', '🌪️', 'Tornado', 'Barre calles y edificios a su paso.']];
    for (const [k, ic, n, d] of defs) body.append(el('button', { class: 'disbtn', onclick: () => { this.closeModal(); Sim.disaster(k); } }, el('span', {}, ic), el('div', {}, el('b', {}, n), el('em', {}, d))));
    this.modal('Desastres', body, { width: 460 });
  },

  bankrupt() {
    const body = el('div', {}, el('p', { class: 'ptext' }, 'Llevas meses en números rojos y los acreedores han tomado el control. Puedes seguir jugando, pero tendrás que sanear las cuentas: sube impuestos, demuele servicios caros o pide un préstamo.'),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn', onclick: () => this.closeModal() }, 'Seguir jugando'), el('button', { class: 'btn primary', onclick: () => { this.closeModal(); this.showNewGame(); } }, 'Nueva ciudad')));
    this.modal('💸 Bancarrota', body, { width: 460, sticky: true });
  },

  /* ---------- menú / guardado ---------- */
  showMenu() {
    const body = el('div', { class: 'menu' });
    const mkBtn = (t, f, cls) => el('button', { class: 'btn big ' + (cls || ''), onclick: f }, t);
    const short = (t, f) => el('button', { class: 'btn', onclick: f }, t);
    body.append(el('div', { class: 'menu-short only-compact' },
      short('💵 Presupuesto', () => this.showBudget()), short('📊 Estadísticas', () => this.showStats()),
      short('📜 Ordenanzas', () => this.showOrds()), short('🏆 Logros', () => this.showAch()),
      short('🔔 Avisos', () => this.showLog()), short('🌪️ Desastres', () => this.showDisasters())));
    body.append(
      mkBtn('▶ Continuar', () => this.closeModal(), 'primary'),
      mkBtn('🏙️ Nueva ciudad', () => this.showNewGame()),
      mkBtn('💾 Guardar / Cargar', () => this.showSaves()),
      mkBtn('⚙️ Opciones', () => this.showOptions()),
      mkBtn('❓ Cómo jugar', () => this.showHelp()),
      mkBtn('🏠 Pantalla de título', () => { this.closeModal(); Game.toTitle(); }));
    this.modal('Menú', body, { width: 340, pause: true });
  },
  showOptions() {
    const body = el('div', { class: 'opts' });
    const chk = (label, val, f) => { const i = el('input', { type: 'checkbox' }); i.checked = val; i.addEventListener('change', () => f(i.checked)); return el('label', { class: 'chk' }, i, el('span', {}, label)); };
    body.append(
      chk('Efectos de sonido', Snd.sfx, v => { Snd.init(); Snd.setSfx(v); }),
      chk('Música ambiental', Snd.music, v => { Snd.init(); Snd.setMusic(v); }),
      chk('Ciclo día / noche', Render.nightOn, v => { Render.nightOn = v; }),
      chk('Lluvia ocasional', Render.weatherOn, v => { Render.weatherOn = v; }),
      chk('Mostrar FPS', Game.showFps, v => Game.setShowFps(v)),
      chk('Autoguardado cada año', Game.autosave, v => { Game.autosave = v; }));
    const qSel = el('select', {}, el('option', { value: 'high' }, 'Alta'), el('option', { value: 'medium' }, 'Media'), el('option', { value: 'low' }, 'Baja (equipos lentos / batería)'));
    qSel.value = Render.quality;
    qSel.addEventListener('change', () => { Render.setQuality(qSel.value); Snd.play('click'); });
    const fSel = el('select', {}, el('option', { value: 'auto' }, 'Automático'), el('option', { value: '60' }, '60 fps'), el('option', { value: '30' }, '30 fps (ahorra batería)'), el('option', { value: '0' }, 'Sin límite'));
    fSel.value = Game.fpsCap;
    fSel.addEventListener('change', () => { Game.setFpsCap(fSel.value); Snd.play('click'); });
    body.prepend(el('label', { class: 'fld' }, el('span', {}, 'Límite de fps'), fSel));
    body.prepend(el('label', { class: 'fld' }, el('span', {}, 'Calidad gráfica'), qSel));
    const de = document.documentElement;
    if (document.fullscreenEnabled || de.webkitRequestFullscreen) {
      body.append(el('button', { class: 'btn', style: 'margin-top:10px;width:100%', onclick: () => {
        const on = document.fullscreenElement || document.webkitFullscreenElement;
        try { on ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (de.requestFullscreen || de.webkitRequestFullscreen).call(de); } catch (e) { }
      } }, '⛶ Pantalla completa'));
    }
    this.modal('Opciones', body, { width: 380, pause: true });
  },
  showSaves() {
    const body = el('div', { class: 'saves' });
    const render = () => {
      body.innerHTML = '';
      for (const s of Game.listSlots()) {
        const m = s.meta;
        body.append(el('div', { class: 'slot' }, el('div', { class: 'st' }, el('b', {}, s.name), el('span', {}, m ? `${m.city} · ${m.date} · ${fmt(m.pop)} hab. · ${m.money}` : 'Vacío')),
          s.auto ? null : el('button', { class: 'btn sm', onclick: () => { Game.saveSlot(s.slot); this.toast('💾 Partida guardada.', 'good'); render(); } }, 'Guardar'),
          el('button', { class: 'btn sm primary' + (m ? '' : ' dis'), onclick: () => { if (m) { this.closeModal(); Game.loadSlot(s.slot); } } }, 'Cargar')));
      }
      if (!window.AndroidApp) body.append(el('div', { class: 'btnrow left' },
        el('button', { class: 'btn sm', onclick: () => Game.exportFile() }, '⬇ Exportar a archivo'),
        el('label', { class: 'btn sm' }, 'Importar archivo', el('input', { type: 'file', accept: '.json', style: 'display:none', onchange: e => Game.importFile(e.target.files[0]) }))));
    };
    render();
    this.modal('Guardar / Cargar', body, { width: 520, pause: true });
  },
  showHelp() {
    const body = el('div', { class: 'help' });
    body.innerHTML = `
      <h4>🎮 Controles</h4>
      <ul>
        <li><b>Mover cámara:</b> botón derecho o central arrastrando, <kbd>W A S D</kbd> / flechas, o la herramienta ✋</li>
        <li><b>Zoom:</b> rueda del ratón o <kbd>+</kbd> / <kbd>−</kbd> &nbsp; <b>Rotar vista:</b> <kbd>Q</kbd> / <kbd>E</kbd></li>
        <li><b>Construir:</b> elige una categoría abajo y haz clic. Calles y zonas se trazan <b>arrastrando</b>.</li>
        <li><b>Atajos:</b> <kbd>Espacio</kbd> pausa · <kbd>1 2 3</kbd> velocidad · <kbd>B</kbd> demoler · <kbd>X</kbd> consultar · <kbd>V</kbd> cambiar vista de datos · <kbd>Esc</kbd> cancelar</li>
      </ul>
      <h4>📱 Controles táctiles</h4>
      <ul>
        <li><b>Un dedo:</b> usa la herramienta elegida (con ✋ mueve el mapa). El cursor se sitúa algo por encima del dedo para que veas dónde actuará.</li>
        <li><b>Edificios:</b> toca y arrastra para ver la vista previa y suelta para construir. Suelta sobre la barra inferior para cancelar.</li>
        <li><b>Calles y zonas:</b> arrastra el dedo para trazarlas. <b>Dos dedos:</b> pellizca para el zoom y arrastra para mover.</li>
        <li>Los botones laterales rotan la vista, hacen zoom y abren el minimapa (🗺️) con las vistas de datos.</li>
      </ul>
      <h4>🏗️ Cómo crecer</h4>
      <ol>
        <li>Traza <b>calles</b> y coloca una fuente de <b>electricidad</b> y de <b>agua</b> junto a ellas.</li>
        <li>Pinta zonas <b>residenciales</b>, <b>comerciales</b> e <b>industriales</b> pegadas a las calles. Mira las barras R/C/I: indican qué hace falta.</li>
        <li>Equilibra <b>empleos</b> y <b>habitantes</b>. Sin empleos la gente se va; sin viviendas las empresas no encuentran trabajadores.</li>
        <li>Construye <b>policía, bomberos, escuelas, hospitales y parques</b> para subir la felicidad y el valor del suelo (y así los edificios evolucionan a niveles 2 y 3).</li>
        <li>Mantén las cuentas sanas en el <b>Presupuesto</b>. Separa la industria de las viviendas por la contaminación.</li>
        <li>Usa las <b>vistas de datos</b> del minimapa para localizar problemas (energía, crimen, tráfico…).</li>
      </ol>
      <p class="hint">Se desbloquean nuevos edificios al aumentar la población. ¡Cuidado con los desastres!</p>`;
    this.modal('Cómo jugar', body, { width: 640 });
  },

  showNewGame(fromTitle) {
    const rndName = pick(CITY_NAMES);
    const body = el('div', { class: 'newgame' });
    const f = (label, node) => el('label', { class: 'fld' }, el('span', {}, label), node);
    const name = el('input', { type: 'text', value: rndName, maxlength: 24 });
    const size = el('select', {}, el('option', { value: 48 }, 'Pequeño (48×48)'), el('option', { value: 64, selected: true }, 'Mediano (64×64)'), el('option', { value: 96 }, 'Grande (96×96)'));
    const style = el('select', {}, el('option', { value: 'island' }, '🏝️ Isla'), el('option', { value: 'coast' }, '🌊 Costa'), el('option', { value: 'lakes' }, '🏞️ Lagos'));
    const diff = el('select', {}, ...Object.entries(DIFFS).map(([k, d]) => el('option', { value: k, selected: k === 'normal' }, `${d.name}${k === 'sandbox' ? ' (dinero ilimitado)' : ' · ' + money(d.money)}`)));
    const seed = el('input', { type: 'text', placeholder: 'Aleatoria' });
    body.append(f('Nombre de la ciudad', name), f('Tamaño del mapa', size), f('Terreno', style), f('Dificultad', diff), f('Semilla (opcional)', seed),
      el('div', { class: 'btnrow' }, fromTitle ? el('button', { class: 'btn', onclick: () => this.closeModal() }, 'Atrás') : el('button', { class: 'btn', onclick: () => this.closeModal() }, 'Cancelar'),
        el('button', { class: 'btn primary', onclick: () => { this.closeModal(); Game.newGame({ name: name.value.trim() || rndName, size: +size.value, style: style.value, diff: diff.value, seed: seed.value.trim() ? strSeed(seed.value.trim()) : (Math.random() * 1e9) | 0 }); } }, '🏙️ Fundar ciudad')));
    this.modal('Nueva ciudad', body, { width: 440, sticky: !!fromTitle });
  },
};

/* ---------- gráfico de líneas ---------- */
function lineChart(cv, series) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600, h = cv.clientHeight || 240;
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  c.clearRect(0, 0, w, h);
  const padL = 52, padR = 12, padT = 12, padB = 24;
  let mn = Infinity, mx = -Infinity, n = 0;
  for (const s of series) { for (const v of s.data) { mn = Math.min(mn, v); mx = Math.max(mx, v); } n = Math.max(n, s.data.length); }
  c.font = '11px Segoe UI, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.55)'; c.strokeStyle = 'rgba(255,255,255,0.1)';
  if (n < 2) { c.textAlign = 'center'; c.fillText('Aún no hay suficientes datos (avanza algunos meses)', w / 2, h / 2); return; }
  if (mn === mx) { mn -= 1; mx += 1; }
  if (mn > 0 && mn / mx < 0.6 && mx > 5) mn = 0;
  const range = mx - mn; mx += range * 0.08; if (mn !== 0) mn -= range * 0.08;
  c.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = mn + (mx - mn) * i / 4, y = padT + (h - padT - padB) * (1 - i / 4);
    c.beginPath(); c.moveTo(padL, y); c.lineTo(w - padR, y); c.stroke();
    c.fillText(Math.abs(v) < 5 && mx - mn < 10 ? v.toFixed(2) : fmt(v), padL - 6, y + 4);
  }
  c.textAlign = 'center';
  c.fillText(`Últimos ${n} meses`, (padL + w - padR) / 2, h - 6);
  for (const s of series) {
    c.beginPath(); c.strokeStyle = s.color; c.lineWidth = 2; c.lineJoin = 'round';
    s.data.forEach((v, i) => { const x = padL + (w - padL - padR) * i / (n - 1), y = padT + (h - padT - padB) * (1 - (v - mn) / (mx - mn)); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
  }
}
