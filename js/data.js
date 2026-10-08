'use strict';
/* ==========================================================================
   IsoCity - datos y utilidades base
   ========================================================================== */

const TW = 64, TH = 32;          // tamaño lógico de un tile isométrico (rombo)
const SPR = 2;                   // supermuestreo de sprites
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const TER = { GRASS: 0, WATER: 1, SAND: 2 };
const ZONE = { NONE: 0, R: 1, C: 2, I: 3 };
const ZKEY = ['', 'R', 'C', 'I'];
const ZNAME = ['', 'Residencial', 'Comercial', 'Industrial'];
const DAY_LEN = 0.3;             // segundos reales por día de juego a velocidad x1
const FIRE_BURN_DAYS = 120;      // días de juego que tarda en consumirse un edificio en llamas (≈36 s a velocidad x1)
const FIRE_SPREAD = 0.009;       // probabilidad diaria de que el fuego salte a cada edificio vecino (sin bomberos)
const SPEEDS = [0, 1, 3, 8];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function money(n) { return (n < 0 ? '-$' : '$') + fmt(Math.abs(n)); }
function rint(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rint(arr.length)]; }

/* ---------------- Carreteras ---------------- */
const ROADS = {
  1: { id: 'street', name: 'Calle', cost: 10, upkeep: 0.5, cap: 4, speed: 1.25, unlock: 0, desc: 'Vía básica de doble sentido. Barata, capacidad limitada.' },
  2: { id: 'avenue', name: 'Avenida', cost: 30, upkeep: 1.6, cap: 9, speed: 1.9, unlock: 400, desc: 'Vía ancha con mediana. El doble de capacidad y más rápida.' },
};

/* ---------------- Edificios de zona (niveles 1-3) ---------------- */
const ZB = {
  1: { name: ['Casa', 'Edificio de apartamentos', 'Torre residencial'], cap: [6, 20, 64], useP: [1, 3, 9], useW: [1, 3, 9] },
  2: { name: ['Tienda', 'Centro comercial', 'Torre de oficinas'], jobs: [4, 14, 44], useP: [2, 5, 14], useW: [1, 3, 8] },
  3: { name: ['Almacén', 'Fábrica', 'Complejo industrial'], jobs: [6, 18, 42], useP: [4, 9, 20], useW: [2, 5, 12], pol: [2.0, 4.5, 8] },
};
const LVL_LV = { 1: [0, 38, 56], 2: [0, 40, 58], 3: [0, 26, 42] };   // valor del suelo mínimo por nivel y tipo de zona
const LVL_MULT = [1, 1.3, 1.7];

/* ---------------- Servicios e infraestructuras ---------------- */
const BDEFS = {
  wind: { name: 'Turbina eólica', cat: 'power', w: 1, h: 1, cost: 450, upkeep: 8, prodP: 8, jobs: 1, unlock: 0, noise: 0.1, desc: 'Energía limpia y barata, pero produce poca potencia.' },
  solar: { name: 'Central solar', cat: 'power', w: 2, h: 2, cost: 1900, upkeep: 20, prodP: 26, jobs: 4, unlock: 250, desc: 'Paneles solares. Sin contaminación y mantenimiento bajo.' },
  coal: { name: 'Central de carbón', cat: 'power', w: 3, h: 3, cost: 5200, upkeep: 110, prodP: 130, jobs: 30, pol: 14, unlock: 120, desc: 'Mucha potencia a bajo coste, pero contamina mucho.' },
  nuclear: { name: 'Central nuclear', cat: 'power', w: 4, h: 4, cost: 24000, upkeep: 520, prodP: 700, jobs: 80, pol: 1, unlock: 6000, desc: 'Enorme producción eléctrica sin humo. Coste elevadísimo.' },

  well: { name: 'Pozo de agua', cat: 'water', w: 1, h: 1, cost: 300, upkeep: 6, prodW: 12, jobs: 0, unlock: 0, desc: 'Extrae agua subterránea. Caudal pequeño; funciona en cualquier sitio.' },
  pump: { name: 'Estación de bombeo', cat: 'water', w: 2, h: 2, cost: 1600, upkeep: 32, prodW: 110, useP: 2, jobs: 6, needWater: true, unlock: 200, desc: 'Bombea agua de mar/lago. Debe tocar el agua.' },
  wplant: { name: 'Planta potabilizadora', cat: 'water', w: 3, h: 3, cost: 5400, upkeep: 95, prodW: 380, useP: 6, jobs: 20, needWater: true, unlock: 2500, desc: 'Gran caudal de agua tratada. Debe tocar el agua.' },

  police: { name: 'Comisaría', cat: 'safety', w: 2, h: 2, cost: 1300, upkeep: 55, dept: 'police', cover: { police: 11 }, useP: 3, useW: 1, jobs: 14, unlock: 120, desc: 'Reduce el crimen en su radio de acción.' },
  fire: { name: 'Estación de bomberos', cat: 'safety', w: 2, h: 2, cost: 1300, upkeep: 55, dept: 'fire', cover: { fire: 12 }, useP: 3, useW: 2, jobs: 14, unlock: 120, desc: 'Previene y apaga incendios. Envía camiones.' },

  clinic: { name: 'Clínica', cat: 'health', w: 2, h: 2, cost: 1500, upkeep: 65, dept: 'health', cover: { health: 10 }, useP: 3, useW: 2, jobs: 12, unlock: 250, desc: 'Atención sanitaria básica.' },
  hospital: { name: 'Hospital', cat: 'health', w: 3, h: 3, cost: 5200, upkeep: 210, dept: 'health', cover: { health: 18 }, useP: 8, useW: 5, jobs: 60, unlock: 1200, desc: 'Gran cobertura sanitaria.' },

  school: { name: 'Escuela', cat: 'edu', w: 2, h: 2, cost: 1600, upkeep: 65, dept: 'edu', cover: { edu: 10 }, str: 0.65, useP: 3, useW: 2, jobs: 14, unlock: 300, desc: 'Educa a los ciudadanos. Necesaria para edificios de nivel 3.' },
  university: { name: 'Universidad', cat: 'edu', w: 3, h: 3, cost: 6500, upkeep: 260, dept: 'edu', cover: { edu: 20 }, str: 1.0, useP: 9, useW: 4, jobs: 50, unlock: 2500, desc: 'Educación superior de amplio alcance.' },

  park1: { name: 'Parque pequeño', cat: 'rec', w: 1, h: 1, cost: 220, upkeep: 3, dept: 'rec', cover: { rec: 4 }, str: 0.8, jobs: 0, unlock: 0, desc: 'Un poco de verde: sube la felicidad y el valor del suelo.' },
  park2: { name: 'Parque con estanque', cat: 'rec', w: 2, h: 2, cost: 900, upkeep: 12, dept: 'rec', cover: { rec: 7 }, str: 0.9, jobs: 1, useW: 1, unlock: 200, desc: 'Parque grande con fuente y estanque.' },
  stadium: { name: 'Estadio', cat: 'rec', w: 3, h: 3, cost: 9500, upkeep: 320, dept: 'rec', cover: { rec: 20 }, str: 1.0, useP: 12, useW: 3, jobs: 40, unlock: 3500, desc: 'Ocio masivo para toda la ciudad.' },

  recycle: { name: 'Centro de reciclaje', cat: 'service', w: 2, h: 2, cost: 2400, upkeep: 85, dept: 'garbage', cover: { garbage: 14 }, useP: 5, useW: 1, jobs: 16, unlock: 500, desc: 'Recoge la basura y reduce la contaminación.' },
  bus: { name: 'Parada de autobús', cat: 'service', w: 1, h: 1, cost: 160, upkeep: 4, dept: 'transit', cover: { transit: 7 }, str: 0.7, jobs: 0, unlock: 400, desc: 'Reduce el tráfico privado en su entorno.' },
  metro: { name: 'Estación de metro', cat: 'service', w: 2, h: 2, cost: 4800, upkeep: 140, dept: 'transit', cover: { transit: 16 }, str: 1.0, useP: 6, jobs: 20, unlock: 2000, desc: 'Transporte masivo: menos tráfico y mayor valor del suelo.' },
};
for (const k in BDEFS) BDEFS[k].key = k;

const DEPTS = {
  police: { name: 'Policía', icon: '🚓' },
  fire: { name: 'Bomberos', icon: '🚒' },
  health: { name: 'Sanidad', icon: '🏥' },
  edu: { name: 'Educación', icon: '🎓' },
  rec: { name: 'Parques y ocio', icon: '🌳' },
  garbage: { name: 'Reciclaje', icon: '♻️' },
  transit: { name: 'Transporte', icon: '🚌' },
};
const COVS = ['police', 'fire', 'health', 'edu', 'rec', 'garbage', 'transit'];

/* ---------------- Barra de herramientas ---------------- */
const CATS = [
  { id: 'roads', name: 'Carreteras', icon: '🛣️', items: [{ kind: 'road', road: 1 }, { kind: 'road', road: 2 }] },
  { id: 'zones', name: 'Zonas', icon: '🏘️', items: [{ kind: 'zone', zone: 1 }, { kind: 'zone', zone: 2 }, { kind: 'zone', zone: 3 }] },
  { id: 'power', name: 'Energía', icon: '⚡', items: ['wind', 'solar', 'coal', 'nuclear'].map(k => ({ kind: 'build', key: k })) },
  { id: 'water', name: 'Agua', icon: '💧', items: ['well', 'pump', 'wplant'].map(k => ({ kind: 'build', key: k })) },
  { id: 'safety', name: 'Seguridad', icon: '🛡️', items: ['police', 'fire'].map(k => ({ kind: 'build', key: k })) },
  { id: 'health', name: 'Sanidad', icon: '🏥', items: ['clinic', 'hospital'].map(k => ({ kind: 'build', key: k })) },
  { id: 'edu', name: 'Educación', icon: '🎓', items: ['school', 'university'].map(k => ({ kind: 'build', key: k })) },
  { id: 'rec', name: 'Ocio', icon: '🌳', items: ['park1', 'park2', 'stadium'].map(k => ({ kind: 'build', key: k })) },
  { id: 'service', name: 'Servicios', icon: '🚌', items: ['recycle', 'bus', 'metro'].map(k => ({ kind: 'build', key: k })) },
];

const ZONE_INFO = {
  1: { name: 'Zona residencial', color: '#3fbf6a', desc: 'Viviendas para tus ciudadanos. Necesitan carretera, electricidad y agua.', cost: 5 },
  2: { name: 'Zona comercial', color: '#4a90e2', desc: 'Tiendas y oficinas: empleos y bienes para los vecinos.', cost: 6 },
  3: { name: 'Zona industrial', color: '#e0b12a', desc: 'Fábricas y almacenes: muchos empleos, pero contaminan.', cost: 6 },
};

const CITY_LEVELS = [
  { pop: 0, name: 'Asentamiento' }, { pop: 100, name: 'Aldea' }, { pop: 500, name: 'Pueblo' },
  { pop: 2000, name: 'Ciudad' }, { pop: 8000, name: 'Gran ciudad' }, { pop: 25000, name: 'Metrópolis' },
  { pop: 80000, name: 'Megalópolis' },
];

/* ---------------- Ordenanzas ---------------- */
const ORDS = [
  { id: 'energy', icon: '💡', name: 'Ahorro energético', desc: '−15% de consumo eléctrico.', base: 0, perCap: 0.15 },
  { id: 'water', icon: '🚰', name: 'Ahorro de agua', desc: '−15% de consumo de agua.', base: 0, perCap: 0.12 },
  { id: 'green', icon: '🌱', name: 'Campaña verde', desc: '−25% de contaminación.', base: 0, perCap: 0.2 },
  { id: 'night', icon: '🌙', name: 'Patrullas nocturnas', desc: '−20% de crimen (−2 de felicidad).', base: 60, perCap: 0.1 },
  { id: 'tourism', icon: '📣', name: 'Publicidad turística', desc: 'Más demanda comercial.', base: 150, perCap: 0 },
  { id: 'scholar', icon: '🎓', name: 'Becas escolares', desc: '+30% de efecto educativo.', base: 0, perCap: 0.18 },
  { id: 'health', icon: '💉', name: 'Campañas de salud', desc: '+25% de cobertura sanitaria.', base: 0, perCap: 0.15 },
];

/* ---------------- Dificultad ---------------- */
const DIFFS = {
  easy: { name: 'Fácil', money: 50000, rev: 1.3 },
  normal: { name: 'Normal', money: 25000, rev: 1.0 },
  hard: { name: 'Difícil', money: 12000, rev: 0.8 },
  sandbox: { name: 'Sandbox', money: 2000000, rev: 1.2 },
};

/* ---------------- Logros ---------------- */
const ACHS = [
  { id: 'pop100', icon: '🏡', name: 'Primeros vecinos', desc: 'Alcanza 100 habitantes.', reward: 500, test: s => s.stats.pop >= 100 },
  { id: 'pop500', icon: '🏘️', name: 'Un pueblo en marcha', desc: 'Alcanza 500 habitantes.', reward: 1500, test: s => s.stats.pop >= 500 },
  { id: 'pop2000', icon: '🏙️', name: 'Ciudad de verdad', desc: 'Alcanza 2.000 habitantes.', reward: 4000, test: s => s.stats.pop >= 2000 },
  { id: 'pop10000', icon: '🌆', name: 'Gran urbe', desc: 'Alcanza 10.000 habitantes.', reward: 12000, test: s => s.stats.pop >= 10000 },
  { id: 'pop50000', icon: '🌃', name: 'Megalópolis', desc: 'Alcanza 50.000 habitantes.', reward: 40000, test: s => s.stats.pop >= 50000 },
  { id: 'rich', icon: '💰', name: 'Tesoro municipal', desc: 'Ten $100.000 en caja.', reward: 5000, test: s => s.money >= 100000 },
  { id: 'happy', icon: '😄', name: 'Ciudad feliz', desc: '80% de felicidad con más de 500 habitantes.', reward: 5000, test: s => s.stats.pop > 500 && s.stats.happiness >= 80 },
  { id: 'jobs', icon: '👷', name: 'Pleno empleo', desc: 'Desempleo menor al 3% con más de 800 habitantes.', reward: 4000, test: s => s.stats.pop > 800 && s.stats.unemp < 0.03 },
  { id: 'edu', icon: '📚', name: 'Ciudad culta', desc: 'Construye una universidad.', reward: 3000, test: s => Sim.countType('university') > 0 },
  { id: 'green', icon: '🍃', name: 'Energía limpia', desc: 'Más de 5 turbinas o centrales solares y ninguna central de carbón.', reward: 3000, test: s => (Sim.countType('wind') + Sim.countType('solar') >= 5) && Sim.countType('coal') === 0 },
  { id: 'sky', icon: '🏢', name: 'Rascacielos', desc: 'Ten 5 torres comerciales de nivel 3.', reward: 5000, test: s => Sim.countLevel('C', 3) >= 5 },
  { id: 'survive', icon: '🛡️', name: 'Superviviente', desc: 'Sobrevive a un desastre.', reward: 2000, test: s => s.disasters >= 1 },
];

/* ---------------- Objetivos guiados ---------------- */
const GOALS = [
  { id: 'g_road', text: 'Construye 12 tramos de calle', reward: 300, test: s => Sim.roadCount() >= 12 },
  { id: 'g_power', text: 'Construye una fuente de energía junto a una calle', reward: 300, test: s => Sim.producerCount('P') >= 1 },
  { id: 'g_water', text: 'Construye un pozo o una bomba de agua', reward: 300, test: s => Sim.producerCount('W') >= 1 },
  { id: 'g_R', text: 'Zonifica una zona residencial junto a la calle', reward: 200, test: s => Sim.zoneTiles(1) >= 8 },
  { id: 'g_C', text: 'Zonifica una zona comercial', reward: 200, test: s => Sim.zoneTiles(2) >= 4 },
  { id: 'g_I', text: 'Zonifica una zona industrial', reward: 200, test: s => Sim.zoneTiles(3) >= 4 },
  { id: 'g_pop', text: 'Alcanza 100 habitantes', reward: 600, test: s => s.stats.pop >= 100 },
  { id: 'g_safe', text: 'Construye una comisaría y un cuartel de bomberos', reward: 600, test: s => Sim.countType('police') > 0 && Sim.countType('fire') > 0 },
  { id: 'g_pop2', text: 'Alcanza 500 habitantes', reward: 1500, test: s => s.stats.pop >= 500 },
  { id: 'g_edu', text: 'Construye una escuela', reward: 800, test: s => Sim.countType('school') > 0 },
  { id: 'g_cash', text: 'Cierra un mes con superávit', reward: 600, test: s => s.stats.pop > 50 && s.stats.net > 0 },
  { id: 'g_pop3', text: 'Alcanza 2.000 habitantes', reward: 4000, test: s => s.stats.pop >= 2000 },
];

const CITY_NAMES = ['Nueva Aurora', 'Puerto Sol', 'Valle Verde', 'Costa Dorada', 'Montealto', 'Villa Esperanza', 'Río Claro', 'Santa Brisa', 'Isla Faro', 'Alta Marea', 'Cerro Luna', 'Bahía Azul'];
