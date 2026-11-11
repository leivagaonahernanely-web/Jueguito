// Lógica del juego (sin Three.js): mapa, jugadores, bots, balas, granadas, zona y botín.
import {
  WORLD, PLAYER_SPEED, ADS_SPEED_MULT, BOT_SPEED, PLAYER_RADIUS, BOT_COUNT, HOUSE_COUNT, CRATE_COUNT,
  TREE_COUNT, LOOT_WEAPONS, LOOT_MEDS, LOOT_GRENADES, LOOT_ARMOR, MAX_MEDS, MAX_GRENADES, HEAL_AMOUNT,
  WEAPONS, WEAPON_WEIGHTS, GRENADE, ZONE_PHASES, ZONE_START_RADIUS,
  CHARACTERS, CHARACTER_IDS, SPRINT_MULT, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  AIRDROP_FIRST, AIRDROP_EVERY,
  SKILLS,
} from './config.js';

export const G = {
  state: 'menu',          // 'menu' | 'playing' | 'over'
  player: null,
  bots: [],
  entities: [],
  obstacles: [],          // { shape:'rect'|'circle', kind, x, z, w,d | r, h, color }
  loot: [],               // { id, x, z, kind:'weapon'|'med'|'grenade'|'armor', weapon, lock }
  bullets: [],
  grenades: [],           // { id, x,y,z, vx,vy,vz, t, owner }
  feed: [],
  events: [],             // shot, impact, hit, hurt, kill, explosion, pickup, headshot, reload, heal, throw
  zone: null,
  elapsed: 0,
  nextId: 1,
  place: 0,
  won: false,
  playerName: 'Tú',
  airdrop: null,          // { x, z, ids, t } suministro activo en el mapa (marcador en el minimapa)
  airdropT: 0,            // segundos hasta el próximo suministro
  chests: [],             // arcas con mejor botín junto a las casas
  cars: [],               // carros que se pueden conducir
  radarT: 0,              // segundos restantes del radar del Explorador
};

const HOUSE_COLORS = ['#d7ccc8', '#bcaaa4', '#efebe9', '#ffe0b2', '#c5e1a5', '#b0bec5', '#f8bbd0', '#ffccbc'];

// ---------- Salto en planeador ----------
// La partida empieza en el aire: todos descienden y eligen dónde aterrizar.
const GLIDE_START = 48;   // altura inicial en metros
const GLIDE_FALL = 11;    // descenso en m/s (≈ 4,5 s de vuelo)
const GLIDE_SPEED = 9;    // desplazamiento horizontal en m/s

// ---------- Estilo Free Fire ----------
// Dos armas y muro de hielo (gloo): cobertura desplegable que bloquea balas.
const MAX_GLOO = 3;
const LOOT_GLOO = 10;
const GLOO = { hp: 220, dist: 2.2, w: 3.2, d: 0.5, h: 2.4 };

// ---------- Carros ----------
const CAR = { speed: 13, accel: 9, turn: 1.9, hp: 100 };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function pickWeaponKey() {
  const names = Object.keys(WEAPON_WEIGHTS);
  const total = names.reduce((s, k) => s + WEAPON_WEIGHTS[k], 0);
  let r = Math.random() * total;
  for (const k of names) {
    r -= WEAPON_WEIGHTS[k];
    if (r <= 0) return k;
  }
  return 'pistola';
}


// ---------- Rejilla espacial ----------
// Divide el mapa en celdas para no recorrer todos los obstáculos en cada consulta
// (balas, línea de visión y colisiones preguntan solo las celdas cercanas).
const GRID_CELL = 16;
let grid = null;
let gridW = 0;

function buildGrid() {
  gridW = Math.max(1, Math.ceil(WORLD / GRID_CELL));
  grid = new Array(gridW * gridW);
  for (let i = 0; i < grid.length; i++) grid[i] = [];
  G.obstacles.forEach((o, idx) => {
    const minX = o.shape === 'rect' ? o.x : o.x - o.r;
    const maxX = o.shape === 'rect' ? o.x + o.w : o.x + o.r;
    const minZ = o.shape === 'rect' ? o.z : o.z - o.r;
    const maxZ = o.shape === 'rect' ? o.z + o.d : o.z + o.r;
    const x0 = clamp(Math.floor(minX / GRID_CELL), 0, gridW - 1);
    const x1 = clamp(Math.floor(maxX / GRID_CELL), 0, gridW - 1);
    const z0 = clamp(Math.floor(minZ / GRID_CELL), 0, gridW - 1);
    const z1 = clamp(Math.floor(maxZ / GRID_CELL), 0, gridW - 1);
    for (let gx = x0; gx <= x1; gx++) {
      const base = gx * gridW;
      for (let gz = z0; gz <= z1; gz++) grid[base + gz].push(idx);
    }
  });
}

// Llama fn(o) por cada obstáculo cuyo recuadro toca la zona dada
function forEachNear(minX, minZ, maxX, maxZ, fn) {
  if (!grid) { for (const o of G.obstacles) fn(o); return; }
  const x0 = clamp(Math.floor(minX / GRID_CELL), 0, gridW - 1);
  const x1 = clamp(Math.floor(maxX / GRID_CELL), 0, gridW - 1);
  const z0 = clamp(Math.floor(minZ / GRID_CELL), 0, gridW - 1);
  const z1 = clamp(Math.floor(maxZ / GRID_CELL), 0, gridW - 1);
  for (let gx = x0; gx <= x1; gx++) {
    const base = gx * gridW;
    for (let gz = z0; gz <= z1; gz++) {
      const cell = grid[base + gz];
      for (let k = 0; k < cell.length; k++) {
        const o = G.obstacles[cell[k]];
        if (!o.gone) fn(o);
      }
    }
  }
}

// Preferencias guardadas (seguras también fuera del navegador, p. ej. en pruebas)
export function readPref(key, def) {
  try {
    if (typeof localStorage === 'undefined') return def;
    const all = JSON.parse(localStorage.getItem('br3d') || '{}');
    return all[key] ?? def;
  } catch (_) { return def; }
}

// ---------- Geometría del mapa ----------
export function blockedAt(x, y, z) {
  let hit = false;
  forEachNear(x - 1, z - 1, x + 1, z + 1, (o) => {
    if (hit) return;
    if (o.shape === 'rect') {
      if (y < o.h && x >= o.x && x <= o.x + o.w && z >= o.z && z <= o.z + o.d) hit = true;
    } else if (y < o.h && Math.hypot(x - o.x, z - o.z) < o.r) {
      hit = true;
    }
  });
  return hit;
}

function losClear(x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.ceil(d / 1.2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blockedAt(x1 + (x2 - x1) * t, 1.2, z1 + (z2 - z1) * t)) return false;
  }
  return true;
}

function fitsRect(x, z, w, d, pad) {
  let ok = true;
  forEachNear(x - pad - 1, z - pad - 1, x + w + pad + 1, z + d + pad + 1, (o) => {
    if (!ok) return;
    if (o.shape === 'rect') {
      if (x < o.x + o.w + pad && x + w > o.x - pad && z < o.z + o.d + pad && z + d > o.z - pad) ok = false;
    } else {
      const cx = clamp(o.x, x, x + w), cz = clamp(o.z, z, z + d);
      if (Math.hypot(o.x - cx, o.z - cz) < o.r + pad) ok = false;
    }
  });
  return ok;
}

function fitsCircle(x, z, r, pad) {
  let ok = true;
  forEachNear(x - r - pad - 1, z - r - pad - 1, x + r + pad + 1, z + r + pad + 1, (o) => {
    if (!ok) return;
    if (o.shape === 'rect') {
      const cx = clamp(x, o.x, o.x + o.w), cz = clamp(z, o.z, o.z + o.d);
      if (Math.hypot(x - cx, z - cz) < r + pad) ok = false;
    } else if (Math.hypot(x - o.x, z - o.z) < r + o.r + pad) {
      ok = false;
    }
  });
  return ok;
}

export function genMap() {
  G.obstacles = [];
  grid = null; // la rejilla se reconstruye al terminar el mapa
  let n = 0, t = 0;
  while (n < HOUSE_COUNT && t < 8000) {
    t++;
    const w = rand(7, 13), d = rand(7, 13), h = rand(4.5, 8);
    const x = rand(8, WORLD - 8 - w), z = rand(8, WORLD - 8 - d);
    if (!fitsRect(x, z, w, d, 2.5)) continue;
    G.obstacles.push({ shape: 'rect', kind: 'casa', x, z, w, d, h, color: pick(HOUSE_COLORS) });
    n++;
  }
  n = 0; t = 0;
  while (n < CRATE_COUNT && t < 6000) {
    t++;
    const s = rand(1.4, 2.2);
    const x = rand(4, WORLD - 4 - s), z = rand(4, WORLD - 4 - s);
    if (!fitsRect(x, z, s, s, 1.2)) continue;
    G.obstacles.push({ shape: 'rect', kind: 'caja', x, z, w: s, d: s, h: 1.4, color: '#9c6b3c' });
    n++;
  }
  n = 0; t = 0;
  while (n < TREE_COUNT && t < 6000) {
    t++;
    const r = rand(0.4, 0.55);
    const x = rand(4, WORLD - 4), z = rand(4, WORLD - 4);
    if (!fitsCircle(x, z, r, 1.5)) continue;
    G.obstacles.push({ shape: 'circle', kind: 'arbol', x, z, r, h: 2.4 });
    n++;
  }
  buildGrid();
}


// Punto libre dentro de la zona segura (para que los bots no merodeen fuera y mueran)
function zoneSpot(margin = 14) {
  for (let i = 0; i < 200; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * Math.max(4, G.zone.radius - margin);
    const x = G.zone.cx + Math.cos(ang) * rr;
    const z = G.zone.cz + Math.sin(ang) * rr;
    if (fitsCircle(x, z, PLAYER_RADIUS, 0.3)) return { x, z };
  }
  return { x: G.zone.cx, z: G.zone.cz };
}

function freeSpot(r = PLAYER_RADIUS) {
  for (let i = 0; i < 1000; i++) {
    const x = rand(5, WORLD - 5), z = rand(5, WORLD - 5);
    if (fitsCircle(x, z, r, 0.3)) return { x, z };
  }
  return { x: WORLD / 2, z: WORLD / 2 };
}

// ---------- Entidades ----------
function makeEntity(p, name, isPlayer, colorIdx, charId = 'recluta') {
  const ch = CHARACTERS[charId] || CHARACTERS.recluta;
  return {
    id: G.nextId++, x: p.x, z: p.z, r: PLAYER_RADIUS, name, isPlayer, colorIdx,
    charId, look: ch.look, speedMult: ch.speed, healMult: ch.healMult, medMax: ch.medMax,
    hp: ch.hp, maxHp: ch.hp, stamina: STAMINA_MAX, sprinting: false,
    y: 0, vy: 0, crouch: false,
    armor: 0, alive: true, kills: 0,
    weapon: 'pistola', ammo: WEAPONS.pistola.mag, reloadT: 0,
    meds: 0, grenades: 0, cool: 0, bloom: 0, healT: 0, throwT: 0, shots: 0,
    yaw: 0, pitch: 0, recoilOff: 0, moving: false, walk: 0, flash: 0, ads: false,
    reactT: 0, retreat: false,
    glide: false, dropX: p.x, dropZ: p.z,
    gloo: 0, slots: ['pistola', null], slot: 0, slotAmmo: [WEAPONS.pistola.mag, 0],
    skillCd: 0, skillT: 0, inCar: null,
    lastKiller: null, lastWeapon: '',
    // IA de bots
    target: null, goal: null, thinkT: 0, grenadeT: 0,
    wanderX: p.x, wanderZ: p.z, wanderT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
  };
}

function moveEnt(e, dx, dz) {
  if (dx !== 0 || dz !== 0) e.moving = true;
  e.x += dx;
  e.z += dz;
  resolveCollisions(e);
}

function resolveCollisions(e) {
  e.x = clamp(e.x, e.r, WORLD - e.r);
  e.z = clamp(e.z, e.r, WORLD - e.r);
  forEachNear(e.x - e.r - 1.2, e.z - e.r - 1.2, e.x + e.r + 1.2, e.z + e.r + 1.2, (o) => {
    if (o.shape === 'rect') {
      const cx = clamp(e.x, o.x, o.x + o.w);
      const cz = clamp(e.z, o.z, o.z + o.d);
      const dx = e.x - cx, dz = e.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < e.r * e.r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const p = (e.r - d) / d;
          e.x += dx * p;
          e.z += dz * p;
        } else {
          const left = e.x - o.x, right = o.x + o.w - e.x;
          const up = e.z - o.z, down = o.z + o.d - e.z;
          const m = Math.min(left, right, up, down);
          if (m === left) e.x = o.x - e.r;
          else if (m === right) e.x = o.x + o.w + e.r;
          else if (m === up) e.z = o.z - e.r;
          else e.z = o.z + o.d + e.r;
        }
      }
    } else {
      const dx = e.x - o.x, dz = e.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = e.r + o.r;
      if (d < min && d > 1e-8) {
        const p = (min - d) / d;
        e.x += dx * p;
        e.z += dz * p;
      }
    }
  });
}

function stepToward(e, tx, tz, speed, dt) {
  const dx = tx - e.x, dz = tz - e.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  e.yaw = Math.atan2(dx, dz);
  const s = speed * (e.speedMult || 1);
  moveEnt(e, (dx / len) * s * dt, (dz / len) * s * dt);
}

function normalize(d, noise = 0) {
  const x = d.x + rand(-noise, noise);
  const y = d.y + rand(-noise, noise);
  const z = d.z + rand(-noise, noise);
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function aimDirAt(tx, ty, tz, ex, ey, ez) {
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

// Ángulo vertical real de la mira: lo que apunta el jugador más el retroceso acumulado
export function viewPitch(p) {
  return clamp(p.pitch + p.recoilOff, -0.9, 0.9);
}

// Ayuda de puntería para celular: si el enemigo está casi en la mira y a la vista, se inclina la puntería hacia él
function assistDir(p, dir) {
  const w = WEAPONS[p.weapon];
  let best = null, bestDot = Math.cos(0.07); // ~4 grados
  for (const b of G.bots) {
    if (!b.alive) continue;
    const dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > w.range * 0.85 || d < 0.5) continue;
    // Dirección desde los ojos (altura 1.35) hasta el pecho del enemigo (altura 1.2)
    const vy = 1.2 - 1.35;
    const vl = Math.hypot(dx, vy, dz) || 1;
    const t = { x: dx / vl, y: vy / vl, z: dz / vl };
    const dot = dir.x * t.x + dir.y * t.y + dir.z * t.z;
    if (dot > bestDot && losClear(p.x, p.z, b.x, b.z)) {
      bestDot = dot;
      best = t;
    }
  }
  if (!best) return dir;
  const x = dir.x * 0.5 + best.x * 0.5, y = dir.y * 0.5 + best.y * 0.5, z = dir.z * 0.5 + best.z * 0.5;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function aimDirPlayer(p) {
  const pitch = viewPitch(p);
  const cp = Math.cos(pitch);
  return { x: Math.sin(p.yaw) * cp, y: Math.sin(pitch), z: Math.cos(p.yaw) * cp };
}

export function startReload(e) {
  if (!e.alive || e.reloadT > 0 || e.ammo === WEAPONS[e.weapon].mag) return;
  e.reloadT = WEAPONS[e.weapon].reload;
  G.events.push({ type: 'reload', id: e.id });
}

function fireWeapon(e, dir) {
  if (e.glide) return;
  if (!e.alive || e.cool > 0 || e.reloadT > 0 || e.sprinting) return;
  const w = WEAPONS[e.weapon];
  if (e.ammo <= 0) { startReload(e); return; }
  e.ammo--;
  e.cool = w.rate;
  e.shots++;
  e.bloom = Math.min(1.2, e.bloom + w.bloom);
  if (e.ammo === 0) startReload(e);

  const aimMult = e.ads ? 0.35 : 1;
  const moveMult = e.isPlayer && e.moving ? 1.6 : 1;
  const spread = w.spread * aimMult * moveMult + e.bloom * 0.04 * aimMult;

  const ox = e.x + dir.x * 0.6;
  const oy = 1.35 + dir.y * 0.6;
  const oz = e.z + dir.z * 0.6;
  for (let i = 0; i < w.pellets; i++) {
    const d = normalize(dir, spread);
    G.bullets.push({
      x: ox, y: oy, z: oz,
      vx: d.x * w.speed, vy: d.y * w.speed, vz: d.z * w.speed,
      traveled: 0, range: w.range, dmg: w.dmg, owner: e, weapon: e.weapon,
    });
  }
  // El retroceso sube la mira mientras disparas y se recupera solo al soltar (ver updatePlayer)
  if (e.isPlayer) e.recoilOff = Math.min(0.6, e.recoilOff + w.recoil * (e.ads ? 0.5 : 1));
  G.events.push({ type: 'shot', id: e.id, x: ox, y: oy, z: oz, weapon: e.weapon, dir });
}

export function throwGrenade(e, dir) {
  if (e.glide) return;
  if (!e.alive || e.grenades <= 0 || e.throwT > 0) return;
  e.grenades--;
  e.throwT = 0.45;
  G.grenades.push({
    id: G.nextId++,
    x: e.x + dir.x * 0.5, y: 1.5 + dir.y * 0.5, z: e.z + dir.z * 0.5,
    vx: dir.x * GRENADE.speed, vy: dir.y * GRENADE.speed + 3, vz: dir.z * GRENADE.speed,
    t: GRENADE.fuse, owner: e,
  });
  G.events.push({ type: 'throw', id: e.id });
}

export function useMed(e) {
  if (!e.alive || e.meds <= 0 || e.hp >= e.maxHp || e.healT > 0) return;
  e.meds--;
  e.healT = 1.1;
  G.events.push({ type: 'heal', id: e.id });
  e.hp = Math.min(e.maxHp, e.hp + HEAL_AMOUNT * (e.healMult || 1));
}

function damage(e, amt, src, label = '', head = false) {
  if (!e.alive) return;
  if (e.armor > 0) {
    const a = Math.min(e.armor, amt * 0.6);
    e.armor -= a;
    amt -= a;
  }
  e.hp -= amt;
  e.flash = 0.14;
  e.lastKiller = src ? src.name : '';
  e.lastWeapon = label;
  if (e.isPlayer && src !== e) G.events.push({ type: 'hurt', amt, sx: src ? src.x : null, sz: src ? src.z : null });
  if (src && src.isPlayer && e !== src) G.events.push({ type: 'hit', victim: e.id, head, amt: Math.round(amt) });
  // El bot gira hacia quien le disparó enseguida (como un jugador atento)
  if (!e.isPlayer && e.alive && src && src !== e && src.alive && e.reactT <= 0) {
    e.target = src;
    e.reactT = 0.2;
    e.thinkT = Math.min(e.thinkT, 0.1);
  }
  if (e.hp <= 0) kill(e, src, label);
}

function addFeed(text) {
  G.feed.push({ text, t: G.elapsed });
  if (G.feed.length > 6) G.feed.shift();
}

function kill(e, src, label) {
  e.hp = 0;
  e.alive = false;
  if (e.weapon !== 'pistola') G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'weapon', weapon: e.weapon, lock: 0 });
  for (let i = 0; i < e.meds; i++) {
    G.loot.push({ id: G.nextId++, x: e.x + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8), kind: 'med', lock: 0 });
  }
  for (let i = 0; i < e.grenades; i++) {
    G.loot.push({ id: G.nextId++, x: e.x + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8), kind: 'grenade', lock: 0 });
  }
  if (e.armor > 0) G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'armor', lock: 0 });
  if (e.gloo > 0) G.loot.push({ id: G.nextId++, x: e.x + rand(-0.8, 0.8), z: e.z + rand(-0.8, 0.8), kind: 'gloo', lock: 0 });
  if (e.inCar) { e.inCar.driver = null; e.inCar.speed *= 0.5; e.inCar = null; }
  if (e.isPlayer && e.slots && e.slots[1] && e.slots[1] !== e.weapon) {
    G.loot.push({ id: G.nextId++, x: e.x + rand(-1, 1), z: e.z + rand(-1, 1), kind: 'weapon', weapon: e.slots[1], lock: 1.5 });
  }

  let msg;
  if (src && src !== e) {
    src.kills++;
    msg = `${src.name} ➜ ${e.name}  (${label})`;
  } else {
    msg = `${e.name} eliminado por la zona`;
  }
  addFeed(msg);
  G.events.push({ type: 'kill', victim: e.id, killer: src ? src.id : 0 });
  if (e.isPlayer) endGame(false);
}

function tryPickup(e) {
  if (e.glide) return;
  for (let i = G.loot.length - 1; i >= 0; i--) {
    const it = G.loot[i];
    if (it.lock > 0) continue;
    if (Math.hypot(e.x - it.x, e.z - it.z) > e.r + 1.1) continue;
    if (it.kind === 'med') {
      if (e.meds >= (e.medMax || MAX_MEDS)) continue;
      e.meds++;
    } else if (it.kind === 'grenade') {
      if (e.grenades >= MAX_GRENADES) continue;
      e.grenades++;
    } else if (it.kind === 'armor') {
      if (e.armor >= (e.isPlayer ? 100 : 50)) continue;
      e.armor = Math.min(100, e.armor + 50);
    } else if (it.kind === 'gloo') {
      if (e.gloo >= MAX_GLOO) continue;
      e.gloo++;
    } else {
      const want = it.weapon;
      if (e.isPlayer && e.slots) {
        // Dos ranuras como en Free Fire: llena la libre, recarga si es la misma,
        // y si están las dos ocupadas suelta la actual en el suelo
        if (want === e.weapon) {
          e.ammo = WEAPONS[want].mag;
          e.slotAmmo[e.slot] = WEAPONS[want].mag;
          e.reloadT = 0;
        } else if (e.slots[1 - e.slot] === want) {
          e.slotAmmo[1 - e.slot] = WEAPONS[want].mag;
        } else if (e.slots[1 - e.slot] === null) {
          e.slots[1 - e.slot] = want;
          e.slotAmmo[1 - e.slot] = WEAPONS[want].mag;
        } else {
          G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'weapon', weapon: e.weapon, lock: 1.5 });
          e.slots[e.slot] = want;
          e.weapon = want;
          e.slotAmmo[e.slot] = WEAPONS[want].mag;
          e.ammo = WEAPONS[want].mag;
          e.reloadT = 0;
        }
      } else {
        // Bots: una sola arma, siempre buscan una mejor
        const cur = e.weapon;
        const better = WEAPONS[want].rank > WEAPONS[cur].rank;
        if (!better) continue;
        G.loot.push({ id: G.nextId++, x: e.x, z: e.z, kind: 'weapon', weapon: cur, lock: 1.5 });
        e.weapon = want;
        e.ammo = WEAPONS[want].mag;
        e.reloadT = 0;
      }
    }
    G.loot.splice(i, 1);
    if (e.isPlayer) G.events.push({ type: 'pickup', kind: it.kind, weapon: it.weapon });
  }
}

// ---------- Granadas ----------
function updateGrenades(dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    g.vy -= 15 * dt;
    const n = 4;
    for (let s = 0; s < n; s++) {
      const px = g.x, pz = g.z;
      g.x += (g.vx * dt) / n;
      g.y += (g.vy * dt) / n;
      g.z += (g.vz * dt) / n;
      if (blockedAt(g.x, g.y, g.z)) {
        if (!blockedAt(g.x, g.y, pz)) { g.z = pz; g.vz *= -0.35; }
        else if (!blockedAt(px, g.y, g.z)) { g.x = px; g.vx *= -0.35; }
        else { g.x = px; g.z = pz; g.vx *= -0.3; g.vz *= -0.3; }
      }
      if (g.y < 0.12) {
        g.y = 0.12;
        g.vy = -g.vy * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
    }
    g.t -= dt;
    if (g.t <= 0) {
      explode(g);
      G.grenades.splice(i, 1);
    }
  }
}

function explode(g) {
  G.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z, radius: GRENADE.radius });
  for (const e of G.entities) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - g.x, e.z - g.z, 0.9 - g.y);
    if (d < GRENADE.radius) {
      const amt = GRENADE.dmg * (1 - d / GRENADE.radius) * (1 - d / GRENADE.radius * 0.3);
      damage(e, amt, g.owner, 'Granada');
    }
  }
  for (const o of G.obstacles) {
    if (!o.gloo || o.gone) continue;
    const cx = o.x + o.w / 2, cz = o.z + o.d / 2;
    const d = Math.hypot(cx - g.x, cz - g.z);
    if (d < GRENADE.radius + 1.5) {
      o.hp -= GRENADE.dmg * (1 - d / (GRENADE.radius + 1.5));
      if (o.hp <= 0) { o.gone = true; G.events.push({ type: 'glooBreak', x: cx, z: cz }); }
    }
  }
}

// ---------- Zona ----------
function zoneDps() {
  return ZONE_PHASES[Math.min(G.zone.phase, ZONE_PHASES.length - 1)].dps;
}

function updateZone(dt) {
  const z = G.zone;
  if (z.phase >= ZONE_PHASES.length) return;
  const ph = ZONE_PHASES[z.phase];
  z.t += dt;
  if (z.state === 'hold') {
    if (z.t >= ph.hold) {
      z.state = 'shrink';
      z.t = 0;
      z.from = z.radius;
      z.fromCx = z.cx;
      z.fromCz = z.cz;
      // El centro de la próxima zona cae en un punto distinto cada partida,
      // dentro del círculo actual y siempre dentro del mapa
      const nr = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)].radius;
      const maxOff = Math.max(0, z.radius - nr) * 0.9;
      const ang = Math.random() * Math.PI * 2;
      const off = Math.sqrt(Math.random()) * maxOff;
      z.tx = clamp(z.cx + Math.cos(ang) * off, nr + 4, WORLD - nr - 4);
      z.tz = clamp(z.cz + Math.sin(ang) * off, nr + 4, WORLD - nr - 4);
    }
  } else {
    const k = Math.min(1, z.t / ph.shrink);
    z.radius = z.from + (ph.radius - z.from) * k;
    z.cx = z.fromCx + (z.tx - z.fromCx) * k;
    z.cz = z.fromCz + (z.tz - z.fromCz) * k;
    if (k >= 1) {
      z.phase++;
      z.state = 'hold';
      z.t = 0;
      z.radius = ph.radius;
    }
  }
}

export function zoneText() {
  if (!G.zone) return '';
  if (G.zone.phase >= ZONE_PHASES.length) return 'Zona final';
  const ph = ZONE_PHASES[G.zone.phase];
  return G.zone.state === 'hold'
    ? `Zona cierra en ${Math.ceil(ph.hold - G.zone.t)}s`
    : `Cerrando zona: ${Math.ceil(ph.shrink - G.zone.t)}s`;
}

// ---------- Balas ----------
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    const step = Math.hypot(b.vx, b.vy, b.vz) * dt;
    const n = Math.max(1, Math.ceil(step / 0.5));
    let gone = false;
    for (let s = 0; s < n && !gone; s++) {
      b.x += (b.vx * dt) / n;
      b.y += (b.vy * dt) / n;
      b.z += (b.vz * dt) / n;
      b.traveled += step / n;
      if (b.traveled > b.range || b.y < 0 || b.x < 0 || b.z < 0 || b.x > WORLD || b.z > WORLD) {
        G.events.push({ type: 'impact', x: b.x, y: Math.max(0, b.y), z: b.z, ground: true });
        gone = true;
        break;
      }
      const hitObs = hitObstacle(b.x, b.y, b.z);
      if (hitObs) {
        if (hitObs.gloo && !hitObs.gone) {
          hitObs.hp -= b.dmg;
          if (hitObs.hp <= 0) {
            hitObs.gone = true;
            G.events.push({ type: 'glooBreak', x: hitObs.x + hitObs.w / 2, z: hitObs.z + hitObs.d / 2 });
          }
        }
        G.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, ground: false });
        gone = true;
        break;
      }
      for (const e of G.entities) {
        if (!e.alive || e === b.owner) continue;
        // La altura del golpe se mide desde los pies del enemigo (saltar o agacharse cambia la zona)
        const ry = b.y - (e.y || 0);
        const top = e.crouch ? 1.25 : 1.85;
        if (Math.hypot(b.x - e.x, b.z - e.z) < e.r + 0.15 && ry > 0 && ry < top) {
          const head = ry > top - 0.35;
          const label = WEAPONS[b.weapon].name;
          damage(e, b.dmg * (head ? 1.8 : 1), b.owner, label, head);
          if (head && b.owner.isPlayer) G.events.push({ type: 'headshot' });
          G.events.push({ type: 'impact', x: b.x, y: b.y, z: b.z, ground: false, flesh: true });
          gone = true;
          break;
        }
      }
    }
    if (gone) G.bullets.splice(i, 1);
  }
}

// ---------- Jugador ----------
function updatePlayer(dt, input) {
  const p = G.player;
  if (!p.alive) return;
  p.yaw += input.dyaw;
  p.pitch = clamp(p.pitch + input.dpitch, -0.9, 0.9);
  p.ads = !!input.ads;

  // Al volante: el carro se maneja con el joystick, sin disparar ni curarse
  if (p.inCar) {
    const car = p.inCar;
    p.throttle = input.forward;
    p.steer = input.strafe;
    p.yaw = car.yaw;
    if (input.gloo) throwGloo(p); // desde el carro sí se puede tirar muro
    return;
  }
  p.throttle = 0;
  p.steer = 0;

  // Planeador: se dirige con el joystick hacia el punto de aterrizaje, sin disparar
  if (p.glide) {
    let fwd = input.forward, str = input.strafe;
    const m = Math.hypot(fwd, str);
    if (m > 1) { fwd /= m; str /= m; }
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = -fz, rz = fx;
    moveEnt(p, (fx * fwd + rx * str) * GLIDE_SPEED * dt, (fz * fwd + rz * str) * GLIDE_SPEED * dt);
    return;
  }

  let fwd = input.forward, str = input.strafe;
  const m = Math.hypot(fwd, str);
  if (m > 1) { fwd /= m; str /= m; }
  // Sprint: solo hacia adelante, sin apuntar y con resistencia; no se puede disparar mientras corres
  // Agacharse: más lento y con la cabeza más baja; no se puede correr agachado
  p.crouch = !!input.crouch;
  // Salto: impulso hacia arriba y gravedad (la altura se usa para los disparos y el render)
  if (input.jump && p.y <= 0 && !p.crouch) p.vy = 5.6;
  if (p.y > 0 || p.vy > 0) {
    p.vy -= 16 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; }
  }
  const autoRun = readPref('autoSprint', false) && fwd > 0.55;
  const sprinting = (!!input.sprint || autoRun) && fwd > 0.3 && !p.ads && !p.crouch && p.stamina > 0;
  if (sprinting) {
    p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
  } else {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
  }
  p.sprinting = sprinting && p.stamina > 0;
  const speed = PLAYER_SPEED * p.speedMult * (p.ads ? ADS_SPEED_MULT : 1) * (p.crouch ? 0.6 : 1) * (p.sprinting ? SPRINT_MULT : 1) * (p.skillT > 0 && p.charId === 'recluta' ? 1.5 : 1);
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const rx = -fz, rz = fx;
  // Aceleración suave: la velocidad sube y baja en unos pasos en vez de saltar de golpe
  const tx = (fx * fwd + rx * str) * speed;
  const tz = (fz * fwd + rz * str) * speed;
  const k = Math.min(1, dt * 11);
  p.velX = (p.velX ?? 0) + (tx - (p.velX ?? 0)) * k;
  p.velZ = (p.velZ ?? 0) + (tz - (p.velZ ?? 0)) * k;
  moveEnt(p, p.velX * dt, p.velZ * dt);

  // Recuperación del retroceso: vuelve a la mira original cuando dejas de disparar
  if (!input.fire) p.recoilOff = Math.max(0, p.recoilOff - dt * (p.ads ? 2.4 : 1.6));
  if (input.fire) fireWeapon(p, input.assist ? assistDir(p, aimDirPlayer(p)) : aimDirPlayer(p));
  if (input.reload) startReload(p);
  if (input.heal) useMed(p);
  if (input.grenade) throwGrenade(p, aimDirPlayer(p));
  if (input.swap) swapWeapon(p);
  if (input.gloo) throwGloo(p);
  if (input.skill) useSkill(p);
  tryPickup(p);
}

// ---------- Bots ----------
function updateBot(b, dt) {
  if (b.glide) {
    stepToward(b, b.dropX, b.dropZ, GLIDE_SPEED, dt);
    return;
  }
  if (b.reactT > 0) b.reactT -= dt;
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.thinkT = rand(0.2, 0.35);
    if (b.target && (!b.target.alive || !losClear(b.x, b.z, b.target.x, b.target.z))) b.target = null;
    if (!b.target) {
      let best = 60;
      for (const e of G.entities) {
        if (e === b || !e.alive) continue;
        const d = Math.hypot(b.x - e.x, b.z - e.z);
        if (d < best && losClear(b.x, b.z, e.x, e.z)) {
          best = d;
          b.target = e;
        }
      }
      if (b.target && b.target !== (b.lastTarget || null)) {
        // Nuevo enemigo: tarda un momento en reaccionar (como un jugador real)
        b.reactT = rand(0.35, 0.8) * (b.charId === 'medico' ? 1.1 : 1);
        b.lastTarget = b.target;
      }
    }
    b.goal = null;
    if (!b.target) {
      const w = WEAPONS[b.weapon];
      if (w.rank < 4 || b.meds < 2) {
        let bestL = 40;
        for (const it of G.loot) {
          if (it.lock > 0) continue;
          if (Math.hypot(it.x - G.zone.cx, it.z - G.zone.cz) > G.zone.radius - 6) continue;
          const d = Math.hypot(b.x - it.x, b.z - it.z);
          if (d < bestL) { bestL = d; b.goal = it; }
        }
      }
    }
  }
  if (b.goal && !G.loot.includes(b.goal)) b.goal = null;
  if (b.hp < b.maxHp * 0.5 && b.meds > 0 && !b.target) useMed(b);

  const w = WEAPONS[b.weapon];
  const outsideZone = Math.hypot(b.x - G.zone.cx, b.z - G.zone.cz) > G.zone.radius - 6;

  if (b.target && b.target.alive) {
    const t = b.target;
    const d = Math.hypot(b.x - t.x, b.z - t.z);
    b.yaw = Math.atan2(t.x - b.x, t.z - b.z);
    // Retirada: herido y sin botiquines, se aleja del enemigo mientras puede
    b.retreat = b.hp < b.maxHp * 0.3 && b.meds === 0;
    if (b.retreat) {
      stepToward(b, b.x + (b.x - t.x), b.z + (b.z - t.z), BOT_SPEED * 1.15, dt);
      b.yaw = Math.atan2(t.x - b.x, t.z - b.z);
    } else if (d > w.range * 0.5) {
      stepToward(b, t.x, t.z, BOT_SPEED, dt);
    } else {
      if (Math.random() < dt * 0.6) b.strafe *= -1;
      const perp = b.yaw + (Math.PI / 2) * b.strafe;
      moveEnt(b, Math.cos(perp) * 2.4 * dt, Math.sin(perp) * 2.4 * dt);
    }
    // Muro de hielo cuando están heridos (cobertura estilo Free Fire)
    if (b.gloo > 0 && b.hp < b.maxHp * 0.55 && d < 35 && Math.random() < dt * 0.9) throwGloo(b);
    // Granadas contra enemigos a media distancia
    b.grenadeT -= dt;
    if (b.grenades > 0 && d > 12 && d < 24 && b.grenadeT <= 0 && Math.random() < dt * 0.4) {
      b.grenadeT = 6;
      const dir = aimDirAt(t.x, 0.9, t.z, b.x, 1.4, b.z);
      throwGrenade(b, { x: dir.x, y: 0.35, z: dir.z });
    }
    if (d < w.range * 0.85 && b.reactT <= 0) {
      const noise = w.pellets > 1 ? 0.03 : 0.075 + d * 0.0009;
      fireWeapon(b, normalize(aimDirAt(t.x, 1.0, t.z, b.x, 1.35, b.z), noise));
    }
  } else if (outsideZone) {
    stepToward(b, G.zone.cx, G.zone.cz, BOT_SPEED, dt);
  } else if (b.goal) {
    stepToward(b, b.goal.x, b.goal.z, BOT_SPEED * 1.05, dt);
  } else {
    if (b.ammo < w.mag * 0.3) startReload(b);
    b.wanderT -= dt;
    if (b.wanderT <= 0 || Math.hypot(b.x - b.wanderX, b.z - b.wanderZ) < 1.5) {
      const s = zoneSpot();
      b.wanderX = s.x;
      b.wanderZ = s.z;
      b.wanderT = rand(3, 6);
    }
    stepToward(b, b.wanderX, b.wanderZ, BOT_SPEED * 0.6, dt);
  }
  tryPickup(b);
}

// ---------- Partida ----------
export function startMatch(name = 'Tú', charId = 'recluta') {
  G.nextId = 1;
  G.playerName = name || 'Tú';
  genMap();
  G.bots = [];
  G.loot = [];
  G.bullets = [];
  G.grenades = [];
  G.feed = [];
  G.events = [];
  G.elapsed = 0;
  G.won = false;
  G.place = 0;

  const ps = freeSpot();
  G.player = makeEntity(ps, G.playerName, true, 0, CHARACTERS[charId] ? charId : 'recluta');
  G.player.grenades = 1;
  G.player.gloo = 2;
  G.player.y = GLIDE_START;
  G.player.glide = true;
  G.airdrop = null;
  G.airdropT = AIRDROP_FIRST;
  for (let i = 0; i < BOT_COUNT; i++) {
    const s = freeSpot();
    const bot = CHARACTER_IDS[(Math.random() * CHARACTER_IDS.length) | 0];
    const b = makeEntity(s, `Bot ${i + 1}`, false, 1 + (i % 7), bot);
    b.y = GLIDE_START;
    b.glide = true;
    if (Math.random() < 0.45) b.gloo = 1;
    G.bots.push(b);
  }
  G.entities = [G.player, ...G.bots];

  const addLoot = (kind, count, extra = {}) => {
    for (let i = 0; i < count; i++) {
      const s = freeSpot(0.6);
      G.loot.push({ id: G.nextId++, x: s.x, z: s.z, kind, lock: 0, ...extra });
    }
  };
  for (let i = 0; i < LOOT_WEAPONS; i++) {
    const s = freeSpot(0.6);
    G.loot.push({ id: G.nextId++, x: s.x, z: s.z, kind: 'weapon', weapon: pickWeaponKey(), lock: 0 });
  }
  addLoot('med', LOOT_MEDS);
  addLoot('grenade', LOOT_GRENADES);
  addLoot('armor', LOOT_ARMOR);
  addLoot('gloo', LOOT_GLOO);
  spawnCars();
  G.radarT = 0;

  // Arcas doradas junto a las casas: mejor botín para quien llegue primero
  G.chests = [];
  const chests = G.obstacles.filter((o) => o.shape === 'rect' && o.kind === 'casa');
  for (const o of chests) {
    if (Math.random() > 0.55) continue;
    for (let tries = 0; tries < 8; tries++) {
      const side = (Math.random() * 4) | 0;
      const px = side === 0 ? o.x - 1.7 : side === 1 ? o.x + o.w + 1.7 : o.x + Math.random() * o.w;
      const pz = side === 2 ? o.z - 1.7 : side === 3 ? o.z + o.d + 1.7 : o.z + Math.random() * o.d;
      if (blockedAt(px, 0.5, pz)) continue;
      G.chests.push({ id: G.nextId++, x: px, z: pz, open: false });
      break;
    }
  }

  G.zone = {
    phase: 0, state: 'hold', t: 0,
    radius: ZONE_START_RADIUS, from: ZONE_START_RADIUS,
    cx: WORLD / 2, cz: WORLD / 2, fromCx: WORLD / 2, fromCz: WORLD / 2,
    tx: WORLD / 2, tz: WORLD / 2,
  };
  // Cada bot elige su punto de aterrizaje: cerca de botín o adentro de la zona
  for (const b of G.bots) {
    const lootSpot = G.loot.length && Math.random() < 0.7 ? pick(G.loot) : null;
    const dest = lootSpot || zoneSpot(20);
    b.dropX = dest.x + rand(-6, 6);
    b.dropZ = dest.z + rand(-6, 6);
  }

  G.state = 'playing';
}

// ---------- Suministros aéreos ----------
function spawnAirdrop() {
  const s = freeSpot(1.2);
  const ids = [];
  const add = (kind, extra = {}) => {
    const id = G.nextId++;
    ids.push(id);
    G.loot.push({ id, x: s.x + rand(-1.5, 1.5), z: s.z + rand(-1.5, 1.5), kind, lock: 0, ...extra });
  };
  add('weapon', { weapon: 'francotirador' });
  add('weapon', { weapon: 'rifle' });
  add('med');
  add('armor');
  add('grenade');
  G.airdrop = { x: s.x, z: s.z, ids, t: 90 };
  G.airdropT = AIRDROP_EVERY;
  addFeed('📦 ¡Suministro aéreo en el mapa!');
  G.events.push({ type: 'airdrop', x: s.x, z: s.z });
}

function updateAirdrops(dt) {
  if (G.airdropT > 0) {
    G.airdropT -= dt;
    if (G.airdropT <= 0) spawnAirdrop();
  }
  if (G.airdrop) {
    G.airdrop.t -= dt;
    const left = G.loot.some((it) => G.airdrop.ids.includes(it.id));
    if (G.airdrop.t <= 0 || !left) G.airdrop = null;
  }
}

function endGame(won) {
  if (G.state !== 'playing') return;
  G.state = 'over';
  G.won = won;
  G.place = won ? 1 : G.bots.filter((b) => b.alive).length + 1;
}

// ---------- Arcas con mejor botín ----------
function updateChests(dt) {
  for (const c of G.chests) {
    if (c.open) continue;
    let opener = null;
    for (const e of G.entities) {
      if (!e.alive || e.glide) continue;
      if (Math.hypot(e.x - c.x, e.z - c.z) < 1.4) { opener = e; break; }
    }
    if (!opener) continue;
    c.open = true;
    // Botín de calidad: arma buena + suministro extra, a veces un tercer objeto
    const goodWeapons = Object.keys(WEAPONS).filter((k) => k !== 'pistola');
    const gx = () => c.x + rand(-1.2, 1.2);
    const gz = () => c.z + rand(-1.2, 1.2);
    G.loot.push({ id: G.nextId++, x: gx(), z: gz(), kind: 'weapon', weapon: pick(goodWeapons), lock: 0 });
    G.loot.push({ id: G.nextId++, x: gx(), z: gz(), kind: pick(['med', 'med', 'grenade', 'armor']), lock: 0 });
    if (Math.random() < 0.35) G.loot.push({ id: G.nextId++, x: gx(), z: gz(), kind: 'med', lock: 0 });
    G.events.push({ type: 'chest', x: c.x, z: c.z });
  }
}

// Devuelve el obstáculo que ocupa ese punto (las balas lo usan para dañar el muro de hielo)
function hitObstacle(x, y, z) {
  let hit = null;
  forEachNear(x - 1, z - 1, x + 1, z + 1, (o) => {
    if (hit) return;
    if (o.shape === 'rect') {
      if (y < o.h && x >= o.x && x <= o.x + o.w && z >= o.z && z <= o.z + o.d) hit = o;
    } else if (y < o.h) {
      const dx = x - o.x, dz = z - o.z;
      if (dx * dx + dz * dz <= o.r * o.r) hit = o;
    }
  });
  return hit;
}

// Registra un obstáculo nuevo en la rejilla espacial (los muros se crean durante la partida)
function addObstacleToGrid(o) {
  if (!grid) return;
  const idx = G.obstacles.length - 1;
  const x0 = clamp(Math.floor(o.x / GRID_CELL), 0, gridW - 1);
  const x1 = clamp(Math.floor((o.x + o.w) / GRID_CELL), 0, gridW - 1);
  const z0 = clamp(Math.floor(o.z / GRID_CELL), 0, gridW - 1);
  const z1 = clamp(Math.floor((o.z + o.d) / GRID_CELL), 0, gridW - 1);
  for (let gx = x0; gx <= x1; gx++) {
    const base = gx * gridW;
    for (let gz = z0; gz <= z1; gz++) grid[base + gz].push(idx);
  }
}

// Muro de hielo: se despliega frente al personaje y bloquea balas y movimiento
export function throwGloo(e) {
  if (!e.alive || e.glide || e.gloo <= 0) return false;
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  const alongX = Math.abs(fx) < Math.abs(fz); // miro sobre todo en Z: la pared cruza en X
  const w = alongX ? GLOO.w : GLOO.d;
  const d = alongX ? GLOO.d : GLOO.w;
  let dist = GLOO.dist, cx = 0, cz = 0, placed = false;
  while (dist >= 0.9) {
    cx = e.x + fx * dist;
    cz = e.z + fz * dist;
    const pts = alongX
      ? [[cx, cz], [cx - w * 0.42, cz], [cx + w * 0.42, cz]]
      : [[cx, cz], [cx, cz - d * 0.42], [cx, cz + d * 0.42]];
    if (!pts.some((pt) => blockedAt(pt[0], 1.2, pt[1]))) { placed = true; break; }
    dist -= 0.65;
  }
  if (!placed) return false;
  const o = {
    shape: 'rect', kind: 'gloo', x: cx - w / 2, z: cz - d / 2, w, d, h: GLOO.h,
    color: 0x7fd0ff, gloo: true, hp: GLOO.hp, maxHp: GLOO.hp,
  };
  G.obstacles.push(o);
  addObstacleToGrid(o);
  e.gloo--;
  G.events.push({ type: 'gloo', x: cx, z: cz });
  return true;
}

// Habilidad del personaje estilo Free Fire, con enfriamiento
export function useSkill(e) {
  if (!e.alive || e.glide || e.skillCd > 0) return false;
  const sk = SKILLS[e.charId];
  if (!sk) return false;
  e.skillCd = sk.cd;
  e.skillT = sk.dur;
  if (e.charId === 'tanque') e.armor = Math.min(100, e.armor + 50);
  if (e.charId === 'medico') e.hp = Math.min(e.maxHp, e.hp + 45);
  if (e.charId === 'explorador') G.radarT = sk.dur;
  G.events.push({ type: 'skill', charId: e.charId });
  return true;
}

// Carros: uno por punto abierto del mapa; mientras están estacionados bloquean el paso
function spawnCars() {
  G.cars = [];
  const colors = [0xd32f2f, 0x1976d2, 0xf9a825];
  for (let i = 0; i < 3; i++) {
    let cx = 0, cz = 0, ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      cx = rand(25, WORLD - 25);
      cz = rand(25, WORLD - 25);
      ok = !blockedAt(cx, 1, cz) && !blockedAt(cx - 2, 1, cz) && !blockedAt(cx + 2, 1, cz)
        && !blockedAt(cx, 1, cz - 1.5) && !blockedAt(cx, 1, cz + 1.5);
    }
    if (!ok) continue;
    const car = { id: G.nextId++, x: cx, z: cz, yaw: Math.random() * Math.PI * 2, speed: 0, driver: null };
    car.obs = { shape: 'rect', kind: 'car', x: cx - 1.7, z: cz - 1, w: 3.4, d: 2, h: 1.5, color: colors[i % 3] };
    G.obstacles.push(car.obs);
    addObstacleToGrid(car.obs);
    G.cars.push(car);
  }
}

// Subir o bajar del carro más cercano
export function enterExitCar(e) {
  if (!e.alive || e.glide) return;
  if (e.inCar) {
    const car = e.inCar;
    car.speed *= 0.3;
    car.driver = null;
    e.inCar = null;
    car.obs.x = car.x - 1.7;
    car.obs.z = car.z - 1;
    car.obs.gone = false;
    e.x = car.x - Math.sin(car.yaw) * 2;
    e.z = car.z - Math.cos(car.yaw) * 2;
    G.events.push({ type: 'swap' });
    return;
  }
  let best = null, bestD = 3.4;
  for (const car of G.cars) {
    if (car.driver) continue;
    const d = Math.hypot(e.x - car.x, e.z - car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) return;
  e.inCar = best;
  best.driver = e;
  best.obs.gone = true;
  G.events.push({ type: 'swap' });
}

// Conducción: acelera y gira con el joystick; atropella a quien se cruce
function updateCars(dt) {
  for (const car of G.cars) {
    const drv = car.driver;
    if (drv && drv.alive && drv.inCar === car) {
      car.speed = clamp(car.speed + drv.throttle * CAR.accel * dt, -4, CAR.speed);
      if (Math.abs(car.speed) > 0.2) car.yaw += drv.steer * CAR.turn * dt * (car.speed >= 0 ? 1 : -1);
      const nx = car.x + Math.sin(car.yaw) * car.speed * dt;
      const nz = car.z + Math.cos(car.yaw) * car.speed * dt;
      if (blockedAt(nx + Math.sin(car.yaw) * 1.7, 1, nz + Math.cos(car.yaw) * 1.7)) {
        car.speed = 0;
      } else {
        car.x = clamp(nx, 2, WORLD - 2);
        car.z = clamp(nz, 2, WORLD - 2);
      }
      drv.x = car.x;
      drv.z = car.z;
      drv.moving = Math.abs(car.speed) > 0.6;
      // Atropello: el caos es parte del estilo
      if (Math.abs(car.speed) > 6) {
        for (const e of G.entities) {
          if (!e.alive || e === drv) continue;
          if (Math.hypot(e.x - car.x, e.z - car.z) < 1.9) {
            damage(e, 55, drv, 'Atropello');
            car.speed *= 0.85;
          }
        }
      }
    } else {
      car.driver = null;
      car.speed *= Math.max(0, 1 - dt * 2.5);
    }
  }
}

// Cambiar de arma entre las dos ranuras (tecla X o el botón táctil)
export function swapWeapon(e) {
  if (!e.alive || !e.slots || !e.slots[1] || e.glide) return;
  e.slotAmmo[e.slot] = e.ammo;
  e.slot = 1 - e.slot;
  e.weapon = e.slots[e.slot];
  e.ammo = e.slotAmmo[e.slot];
  e.reloadT = 0;
  G.events.push({ type: 'swap' });
}

function checkWin() {
  if (G.state === 'playing' && G.player.alive && G.bots.every((b) => !b.alive)) endGame(true);
}

export function update(dt, input) {
  G.elapsed += dt;
  G.entities = [G.player, ...G.bots];

  for (const e of G.entities) {
    e.moving = false;
    if (e.glide) {
      e.y -= GLIDE_FALL * dt;
      if (e.y <= 0) { e.y = 0; e.vy = 0; e.glide = false; }
    }
    if (e.skillCd > 0) e.skillCd -= dt;
    if (e.skillT > 0) e.skillT -= dt;
    if (e.cool > 0) e.cool -= dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.healT > 0) e.healT -= dt;
    if (e.throwT > 0) e.throwT -= dt;
    e.bloom = Math.max(0, e.bloom - dt * 2.4);
    if (e.reloadT > 0) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) {
        e.reloadT = 0;
        e.ammo = WEAPONS[e.weapon].mag;
      }
    }
  }
  for (const it of G.loot) if (it.lock > 0) it.lock -= dt;

  updateZone(dt);
  for (const e of G.entities) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - G.zone.cx, e.z - G.zone.cz) > G.zone.radius) damage(e, zoneDps() * dt, null, 'Zona');
  }

  updatePlayer(dt, input);
  for (const b of G.bots) if (b.alive) updateBot(b, dt);
  updateAirdrops(dt);
  updateChests(dt);
  updateCars(dt);
  if (G.radarT > 0) G.radarT -= dt;
  updateBullets(dt);
  updateGrenades(dt);

  for (const e of G.entities) if (e.moving) e.walk += dt * 9 * (e.sprinting ? 1.5 : 1);

  G.feed = G.feed.filter((f) => G.elapsed - f.t < 6);
  checkWin();
}
