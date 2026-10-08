'use strict';
/* ==========================================================================
   Audio sintetizado con WebAudio (efectos + música ambiental generativa)
   ========================================================================== */
const Snd = {
  ctx: null, master: null, sfxGain: null, musicGain: null,
  sfx: true, music: true, _musicTimer: null, _step: 0, _noiseBuf: null, _last: {},

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfx ? 0.5 : 0; this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.music ? 0.16 : 0; this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 1.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
      this.startMusic();
    } catch (e) { this.ctx = null; }
  },
  setSfx(v) { this.sfx = v; if (this.sfxGain) this.sfxGain.gain.value = v ? 0.5 : 0; },
  setMusic(v) { this.music = v; if (this.musicGain) this.musicGain.gain.value = v ? 0.16 : 0; },

  tone(freq, dur, type, vol, slideTo, delay, dest) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol, freq, delay, q) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this._noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200; f.Q.value = q || 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t); s.stop(t + dur + 0.05);
  },
  play(name) {
    if (!this.ctx || !this.sfx) return;
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < 55) return;
    this._last[name] = now;
    switch (name) {
      case 'click': this.tone(760, 0.05, 'triangle', 0.12); break;
      case 'select': this.tone(520, 0.06, 'sine', 0.14, 700); break;
      case 'road': this.tone(230, 0.09, 'square', 0.07, 170); this.noise(0.08, 0.1, 700); break;
      case 'zone': this.tone(420, 0.1, 'sine', 0.1, 560); break;
      case 'build': this.tone(150, 0.2, 'sawtooth', 0.12, 70); this.noise(0.18, 0.16, 900); this.tone(660, 0.09, 'triangle', 0.1, 880, 0.12); break;
      case 'bulldoze': this.noise(0.28, 0.32, 600); this.tone(110, 0.22, 'square', 0.1, 55); break;
      case 'error': this.tone(190, 0.18, 'sawtooth', 0.12, 120); break;
      case 'coin': this.tone(990, 0.07, 'square', 0.07); this.tone(1480, 0.14, 'square', 0.07, null, 0.07); break;
      case 'achv': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, null, i * 0.09)); break;
      case 'warn': this.tone(330, 0.12, 'triangle', 0.12); this.tone(247, 0.2, 'triangle', 0.12, null, 0.12); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone(i % 2 ? 620 : 840, 0.18, 'square', 0.07, null, i * 0.2); break;
      case 'quake': this.noise(2.2, 0.55, 220, 0, 1.2); this.tone(48, 2, 'sine', 0.3, 30); break;
      case 'boom': this.noise(1.3, 0.6, 500); this.tone(70, 1.2, 'sine', 0.4, 28); break;
    }
  },

  /* ---------- música ambiental generativa ---------- */
  startMusic() {
    if (this._musicTimer) return;
    const prog = [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [4, 7, 11, 14]];   // acordes en semitonos sobre do
    const root = 48; // C3
    const penta = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    const mf = n => 440 * Math.pow(2, (n - 69) / 12);
    this._musicTimer = setInterval(() => {
      if (!this.ctx || !this.music || this.ctx.state !== 'running') return;
      const s = this._step++;
      const chord = prog[Math.floor(s / 16) % prog.length];
      if (s % 16 === 0) {
        chord.forEach((n, i) => this.pad(mf(root + n + (i === 0 ? 0 : 12)), 7.5, 0.5 / (1 + i * 0.35)));
        this.pad(mf(root + chord[0] - 12), 8, 0.6);
      }
      if (s % 2 === 0 && Math.random() < 0.5) {
        const n = root + 24 + penta[Math.floor(Math.random() * penta.length)] + (Math.random() < 0.2 ? 12 : 0);
        this.pluck(mf(n), 1.6, 0.35);
      }
    }, 480);
  },
  pad(freq, dur, vol) {
    const c = this.ctx, t = c.currentTime;
    for (const det of [-6, 6]) {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      f.type = 'lowpass'; f.frequency.value = 700;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * 0.18, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + dur + 0.1);
    }
  },
  pluck(freq, dur, vol) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + dur + 0.1);
  },
};
